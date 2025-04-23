"""Web-related tools for searching and browser automation."""

import asyncio
import uuid
import aiohttp
from typing import Optional
from bs4 import BeautifulSoup
from browser_use import Agent, Browser, BrowserConfig, Controller, ActionResult

async def fetch_url_content(url: str) -> str:
    """Fetches and processes content from a specific URL.
    
    Args:
        url: The URL to fetch content from.
        
    Returns:
        Processed content from the URL or error message.
    """
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                if response.status != 200:
                    return f"Error: Failed to fetch URL (status code: {response.status})"
                
                content = await response.text()
                soup = BeautifulSoup(content, 'html.parser')
                
                # Remove script and style elements
                for script in soup(["script", "style"]):
                    script.decompose()
                
                # Get text content
                text = soup.get_text()
                
                # Clean up whitespace
                lines = (line.strip() for line in text.splitlines())
                chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
                text = ' '.join(chunk for chunk in chunks if chunk)
                
                # Truncate if too long
                words = text.split()
                if len(words) > 1000:
                    text = " ".join(words[:1000]) + "..."
                
                return f"Content from {url}:\n{text}"
    except Exception as e:
        return f"Error fetching URL {url}: {str(e)}"

async def perform_web_search(query: str, url: Optional[str] = None, num_results: int = 3) -> str:
    """Performs a web search using Tavily API or fetches content from a specific URL.
    
    Args:
        query: The search query (used if url is None).
        url: Optional specific URL to fetch content from.
        num_results: Number of results for search query (default 3, ignored if url is provided).
        
    Returns:
        String with results or error message.
    """
    # If URL is provided, fetch its content directly
    if url:
        print(f"[Server Tool] Fetching content from URL: {url}")
        return await fetch_url_content(url)
    
    # Otherwise, perform a search
    from .base import tavily_client  # Import here to avoid circular imports

    print(f"[Server Tool] Tavily search for: '{query}' (num_results={num_results})")
    if not tavily_client:
        return "Error: Tavily API key not configured."

    try:
        response = await asyncio.to_thread(
            tavily_client.search, 
            query=query, 
            search_depth="basic", 
            max_results=num_results
        )
        
        results = response.get('results', [])
        if not results:
            return f"No results found for '{query}'."
        
        output = f"Search results for '{query}':\n"
        for result in results:
            output += f"- Title: {result.get('title', 'N/A')}\n"
            output += f"  URL: {result.get('url', 'N/A')}\n"
            content = result.get('content', 'N/A')
            if content != 'N/A':
                words = content.split()
                if len(words) > 1000:
                    truncated_content = " ".join(words[:1000]) + "..."
                else:
                    truncated_content = content
                output += f"  Content: {truncated_content}\n\n"
            else:
                 output += f"  Content: N/A\n\n"
        return output.strip()

    except Exception as e:
        print(f"[Server Tool Error] Tavily search failed: {e}")
        return f"Error: Tavily search failed - {e}"

# --- Browser User Function ---
async def execute_browser_task(task: str, websocket, websocket_id: str, pending_questions_dict: dict) -> str:
    """Executes a browsing task using browser_use.Agent with websocket interaction.

    Args:
        task: The string describing the task for the agent.
        websocket: The WebSocket connection object for the specific client.
        websocket_id: A unique identifier for the websocket connection.
        pending_questions_dict: A shared dictionary to manage pending questions futures.

    Returns:
        String containing the result from the agent or an error message.
    """
    from .base import llm  # Import here to avoid circular imports

    print(f"[Server Tool] Browser agent task started for websocket {websocket_id}: '{task}'")
    if not llm:
        print("[Server Tool Error] OpenAI API key not configured. Browser tool cannot run.")
        return "Error: OpenAI API key not configured. Browser tool cannot run."
    if not Agent or not Controller or not ActionResult:
         print("[Server Tool Error] Failed to import required browser_use components.")
         return "Error: Failed to import required browser_use components."

    browser = None
    try:
        controller = Controller()

        @controller.action('Ask user for information or permission to proceed')
        async def ask_human_via_websocket(question: str) -> ActionResult:
            request_id = str(uuid.uuid4())
            future = asyncio.Future()

            if websocket_id not in pending_questions_dict:
                pending_questions_dict[websocket_id] = {}
            pending_questions_dict[websocket_id][request_id] = future

            try:
                message = {'type': 'agent_question', 'request_id': request_id, 'question': question}
                print(f"[Server Tool - ask_human] Sending question (req_id: {request_id}) to websocket {websocket_id}: {question}")
                await websocket.send_json(message) 

                answer = await asyncio.wait_for(future, timeout=300.0)
                print(f"[Server Tool - ask_human] Received answer (req_id: {request_id}) from websocket {websocket_id}: {answer}")
                return ActionResult(extracted_content=str(answer))
            except asyncio.TimeoutError:
                print(f"[Server Tool Error - ask_human] Timeout waiting for answer (req_id: {request_id}) from websocket {websocket_id}")
                return ActionResult(extracted_content="Error: User did not respond in time.")
            except Exception as e:
                print(f"[Server Tool Error - ask_human] Error during ask_human (req_id: {request_id}): {e}")
                if not future.done():
                    future.set_exception(e)
                return ActionResult(extracted_content=f"Error: Failed to get user input - {e}")
            finally:
                if websocket_id in pending_questions_dict and request_id in pending_questions_dict[websocket_id]:
                    del pending_questions_dict[websocket_id][request_id]
                    if not pending_questions_dict[websocket_id]:
                        del pending_questions_dict[websocket_id]

        async def send_step_update_to_client(agent):
            try:
                thoughts = agent.state.history.model_thoughts()[-1] if agent.state.history.model_thoughts() else "No thoughts recorded yet."
                actions = agent.state.history.model_actions()[-1] if agent.state.history.model_actions() else "No action recorded yet."
                urls = agent.state.history.urls()[-1] if agent.state.history.urls() else "No URL visited yet."

                action_details = "N/A"
                if actions and hasattr(actions, 'action_name') and hasattr(actions, 'action_arguments'):
                   action_details = f"Action: {actions.action_name}, Args: {actions.action_arguments}"

                update_data = {
                    'thoughts': str(thoughts),
                    'action': action_details,
                    'url': str(urls)
                }
                message = {'type': 'agent_step_update', 'data': update_data}
                print(f"[Server Tool - hook] Sending step update to websocket {websocket_id}")
                await websocket.send_json(message)
            except Exception as e:
                print(f"[Server Tool Error - hook] Failed to send step update to websocket {websocket_id}: {e}")

        print(f"[Server Tool] Initializing Browser for websocket {websocket_id}")
        browser = Browser(
            config=BrowserConfig(
                browser_binary_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            )
        )

        print(f"[Server Tool] Initializing Agent for websocket {websocket_id}")
        agent = Agent(
            task=task, 
            llm=llm,
            controller=controller
        )

        print(f"[Server Tool] Running agent.run() for websocket {websocket_id}")
        result = await agent.run(on_step_end=send_step_update_to_client) 
        
        print(f"[Server Tool] Browser agent finished task for websocket {websocket_id}: '{task}'")
        return str(result)

    except ImportError:
         print("[Server Tool Error] Failed to import browser_use components.")
         return "Error: Failed to import browser_use components."
    except Exception as e:
        print(f"[Server Tool Error] Browser agent failed for websocket {websocket_id}: {e}")
        return f"Error: Browser agent failed - {e}"
    finally:
        if browser:
            print(f"[Server Tool] Closing browser for websocket {websocket_id}")
            await browser.close()
        if websocket_id in pending_questions_dict:
            print(f"[Server Tool] Cleaning up pending questions for websocket {websocket_id} on exit.")
            for request_id, future in pending_questions_dict.get(websocket_id, {}).items():
                if not future.done():
                    future.cancel("Browser agent task terminated unexpectedly.")
            del pending_questions_dict[websocket_id]

# --- Tool Schemas ---
SEARCH_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "search",
        "description": "Search the web for information or fetch content from a specific URL.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query string. Required if url is not provided.",
                },
                "url": {
                    "type": "string",
                    "description": "Optional specific URL to fetch content from. If provided, the query parameter is ignored.",
                },
                "num_results": {
                    "type": "integer",
                    "description": "(Optional) The maximum number of search results to return (default is 3, ignored if url is provided).",
                },
            },
            "required": ["query"],
        },
    }
}

BROWSER_USER_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "browser_user",
        "description": "Perform a complex web browsing task based on a given objective using an autonomous agent. Use this for tasks requiring interaction with websites, filling forms, or synthesizing information from multiple pages.",
        "parameters": {
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "The detailed task or objective for the browsing agent to accomplish (e.g., 'Find the current price of Bitcoin on Binance and Coinbase', 'Summarize the latest news about AI regulation').",
                },
            },
            "required": ["task"],
        },
    }
} 