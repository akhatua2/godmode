import asyncio
import subprocess
import os # For reading env vars
import uuid # For unique IDs
from dotenv import load_dotenv # For reading env vars
from tavily import TavilyClient # Import Tavily client
from langchain_openai import ChatOpenAI  # Import directly from langchain_openai
from browser_use import Agent, Browser, BrowserConfig, Controller, ActionResult
from app.config import (
    TAVILY_API_KEY,
    OPENAI_API_KEY,
    DEFAULT_MODEL,
    PLANNER_MODEL,
    CHROME_PATH
)

# --- Load Env Vars and Initialize Clients ---
load_dotenv()
tavily_api_key = os.getenv("TAVILY_API_KEY")
if not tavily_api_key:
    print("[WARN] TAVILY_API_KEY not found in environment variables. Search tool will not work.")
    tavily_client = None
else:
    tavily_client = TavilyClient(api_key=tavily_api_key)

openai_api_key = os.getenv("OPENAI_API_KEY")
if not openai_api_key:
    print("[WARN] OPENAI_API_KEY not found in environment variables. Browser tool will not work.")
    llm = None
else:
    # Initialize the LLM globally for the browser tool
    llm = ChatOpenAI(model="gpt-4.1-mini", openai_api_key=openai_api_key) 
    planner_llm = ChatOpenAI(model='o3-mini', openai_api_key=openai_api_key)
# --- End Init ---

async def run_bash_command(command: str) -> str:
    """Describes the function to run a bash command (execution happens client-side).

    Args:
        command: The bash command string to execute.
        
    Returns:
        A string containing the standard output or error from the client-side execution.
    """
    # Execution logic is removed/commented out as it happens client-side.
    print(f"[Tool Definition] run_bash_command with command: {command}")
    # raise NotImplementedError("Tool execution happens client-side.")
    # Returning a placeholder description might be sufficient if this function is never called server-side.
    return "Placeholder: Tool execution is handled by the client."

# --- Client-Side File Read Tool ---
async def read_file(file_path: str) -> str:
    """Describes the function to read a file (execution happens client-side).

    Args:
        file_path: The path to the file to be read on the client's machine.

    Returns:
        A placeholder string indicating client-side execution.
    """
    print(f"[Tool Definition] read_file for path: {file_path}")
    return "Placeholder: Tool execution is handled by the client."
# --- End File Read ---

# --- Client-Side File Edit Tool ---
async def edit_file(file_path: str, string_to_replace: str, new_string: str) -> str:
    """Describes the function to replace text in a file (execution happens client-side).

    Args:
        file_path: The path to the file to be edited on the client's machine.
        string_to_replace: The exact string to find and replace in the file.
        new_string: The string to replace the found string with.

    Returns:
        A placeholder string indicating client-side execution.
    """
    print(f"[Tool Definition] edit_file for path: {file_path}")
    # Be cautious about logging content in a real application
    # print(f"Content: {content[:100]}...") # Log truncated content
    return "Placeholder: Tool execution is handled by the client."
# --- End File Edit ---

# --- Updated Function for Server-Side Search using Tavily --- 
async def perform_web_search(query: str, num_results: int = 3) -> str:
    """Performs a web search using Tavily API and returns summarized results.
    Args: query, num_results (default 3).
    Returns: String with summarized results or error.
    """
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
            # --- Truncate content --- 
            if content != 'N/A':
                words = content.split()
                if len(words) > 1000:
                    truncated_content = " ".join(words[:1000]) + "..."
                else:
                    truncated_content = content
                output += f"  Content: {truncated_content}\n\n"
            else:
                 output += f"  Content: N/A\n\n"
            # --- End truncation --- 
        return output.strip()

    except Exception as e:
        print(f"[Server Tool Error] Tavily search failed: {e}")
        return f"Error: Tavily search failed - {e}"
# --- End Updated Function --- 

# --- Updated Tool: Browser User ---
# Updated signature to accept websocket and shared state
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
    print(f"[Server Tool] Browser agent task started for websocket {websocket_id}: '{task}'")
    if not llm:
        print("[Server Tool Error] OpenAI API key not configured. Browser tool cannot run.")
        return "Error: OpenAI API key not configured. Browser tool cannot run."
    if not Agent or not Controller or not ActionResult:
         print("[Server Tool Error] Failed to import required browser_use components.")
         return "Error: Failed to import required browser_use components."

    browser = None # Initialize browser to None for finally block
    try:
        # --- Define Nested Action for Asking User ---
        controller = Controller()

        @controller.action('Ask user for information or permission to proceed')
        async def ask_human_via_websocket(question: str) -> ActionResult:
            request_id = str(uuid.uuid4())
            future = asyncio.Future()

            # Store future before sending question
            if websocket_id not in pending_questions_dict:
                pending_questions_dict[websocket_id] = {}
            pending_questions_dict[websocket_id][request_id] = future

            try:
                message = {'type': 'agent_question', 'request_id': request_id, 'question': question}
                print(f"[Server Tool - ask_human] Sending question (req_id: {request_id}) to websocket {websocket_id}: {question}")
                # Assuming websocket object has send_json method
                await websocket.send_json(message) 

                # Wait for the answer with a timeout
                answer = await asyncio.wait_for(future, timeout=300.0) # 5 minute timeout
                print(f"[Server Tool - ask_human] Received answer (req_id: {request_id}) from websocket {websocket_id}: {answer}")
                return ActionResult(extracted_content=str(answer))
            except asyncio.TimeoutError:
                print(f"[Server Tool Error - ask_human] Timeout waiting for answer (req_id: {request_id}) from websocket {websocket_id}")
                # Future is automatically cancelled on timeout, just need to clean up dict
                return ActionResult(extracted_content="Error: User did not respond in time.")
            except Exception as e:
                print(f"[Server Tool Error - ask_human] Error during ask_human (req_id: {request_id}): {e}")
                # Future might still exist, try to cancel
                if not future.done():
                    future.set_exception(e)
                return ActionResult(extracted_content=f"Error: Failed to get user input - {e}")
            finally:
                # Always clean up the pending question entry
                if websocket_id in pending_questions_dict and request_id in pending_questions_dict[websocket_id]:
                    del pending_questions_dict[websocket_id][request_id]
                    if not pending_questions_dict[websocket_id]: # Remove user dict if empty
                        del pending_questions_dict[websocket_id]

        # --- Define Nested Hook for Step Updates ---
        async def send_step_update_to_client(agent):
            try:
                # Safely access history elements
                thoughts = agent.state.history.model_thoughts()[-1] if agent.state.history.model_thoughts() else "No thoughts recorded yet."
                actions = agent.state.history.model_actions()[-1] if agent.state.history.model_actions() else "No action recorded yet."
                urls = agent.state.history.urls()[-1] if agent.state.history.urls() else "No URL visited yet."

                # Extract action details if available
                action_details = "N/A"
                if actions and hasattr(actions, 'action_name') and hasattr(actions, 'action_arguments'):
                   action_details = f"Action: {actions.action_name}, Args: {actions.action_arguments}"

                update_data = {
                    'thoughts': str(thoughts), # Ensure string representation
                    'action': action_details,
                    'url': str(urls)
                }
                message = {'type': 'agent_step_update', 'data': update_data}
                print(f"[Server Tool - hook] Sending step update to websocket {websocket_id}")
                await websocket.send_json(message)
            except Exception as e:
                # Log error but don't crash the agent
                print(f"[Server Tool Error - hook] Failed to send step update to websocket {websocket_id}: {e}")

        # --- Instantiate and Run the Agent ---
        print(f"[Server Tool] Initializing Browser for websocket {websocket_id}")
        browser = Browser(
            config=BrowserConfig(
                browser_binary_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', # macOS path
                # Consider adding headless=True for server environments if UI isn't needed
            )
        )

        print(f"[Server Tool] Initializing Agent for websocket {websocket_id}")
        agent = Agent(
            task=task, 
            llm=llm, 
            # planner_llm=planner_llm,
            # browser=browser, 
            controller=controller # Pass the controller with the custom action
        )

        print(f"[Server Tool] Running agent.run() for websocket {websocket_id}")
        # Run the agent with the step update hook
        result = await agent.run(on_step_end=send_step_update_to_client) 
        
        print(f"[Server Tool] Browser agent finished task for websocket {websocket_id}: '{task}'")
        return str(result) # Ensure result is string

    except ImportError:
         print("[Server Tool Error] Failed to import browser_use components.")
         return "Error: Failed to import browser_use components."
    except Exception as e:
        print(f"[Server Tool Error] Browser agent failed for websocket {websocket_id}: {e}")
        return f"Error: Browser agent failed - {e}"
    finally:
        # Ensure browser is closed if it was initialized
        if browser:
            print(f"[Server Tool] Closing browser for websocket {websocket_id}")
            await browser.close()
        # Clean up any lingering questions for this websocket_id on error/exit
        if websocket_id in pending_questions_dict:
            print(f"[Server Tool] Cleaning up pending questions for websocket {websocket_id} on exit.")
            # Cancel any pending futures for this specific websocket
            for request_id, future in pending_questions_dict.get(websocket_id, {}).items():
                if not future.done():
                    future.cancel("Browser agent task terminated unexpectedly.")
            del pending_questions_dict[websocket_id]

# --- End Browser User ---

# Tool definition for OpenAI API
RUN_BASH_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "run_bash_command",
        "description": "Execute a bash command on the user's machine and return the standard output or standard error. Use this tool when you need to interact with the local file system, run scripts, or get system information.",
        "parameters": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The bash command string to execute (e.g., 'ls -la', 'pwd', 'echo hello').",
                },
            },
            "required": ["command"],
        },
    }
}

# New tool schema: ask_user
ASK_USER_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "ask_user",
        "description": "Ask the user a clarifying question when unsure how to proceed or need more information.",
        "parameters": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "The question to ask the user.",
                },
            },
            "required": ["question"],
        },
    }
}

# New tool schema: terminate
TERMINATE_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "terminate",
        "description": "Terminate the current interaction or task, for example, when the goal is achieved or the user asks to stop.",
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "(Optional) The reason for termination.",
                },
            },
            # No required parameters
            "required": [], 
        },
    }
}

# --- New Tool Schema: search ---
SEARCH_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "search",
        "description": "Search the web for information based on a query string.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query string.",
                },
                "num_results": {
                    "type": "integer", # Use integer for number of results
                    "description": "(Optional) The maximum number of search results to return (default is 3).",
                },
            },
            "required": ["query"],
        },
    }
}
# --- End search schema --- 

# --- File Read Tool Schema ---
READ_FILE_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "read_file",
        "description": "Read the content of a specified file on the user's machine.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "The path to the file to read (e.g., 'documents/report.txt', '/Users/name/project/config.yaml').",
                },
            },
            "required": ["file_path"],
        },
    }
}
# --- End File Read Schema ---

# --- File Edit Tool Schema ---
EDIT_FILE_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "edit_file",
        "description": "Replace the first occurrence of a specific string within a specified file on the user's machine. Use with caution.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "The path to the file to edit (e.g., 'notes.txt', '/path/to/your/file.py').",
                },
                "string_to_replace": {
                    "type": "string",
                    "description": "The exact string to find within the file.",
                },
                "new_string": {
                    "type": "string",
                    "description": "The string that will replace the 'string_to_replace'.",
                },
            },
            "required": ["file_path", "string_to_replace", "new_string"],
        },
    }
}
# --- End File Edit Schema ---

# --- New Browser User Tool Schema ---
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
# --- End Browser User Schema ---

# --- Paste at Cursor Schema ---
PASTE_AT_CURSOR_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "paste_at_cursor",
        "description": "Pastes the provided text content at the current cursor location in the user's active application.",
        "parameters": {
            "type": "object",
            "properties": {
                "content_to_paste": {
                    "type": "string",
                    "description": "The text content to be pasted.",
                },
            },
            "required": ["content_to_paste"],
        },
    }
}
# --- End Paste at Cursor Schema ---

# --- Registry for Server-Executable Tools --- 
SERVER_EXECUTABLE_TOOLS = {
    "search": perform_web_search,
    # "browser_user": execute_browser_task, # Make sure this maps to the updated function
    # Add other server-side functions here mapped by their name
}
# --- End Registry --- 

# List of tool schemas to pass to the API
TOOL_SCHEMAS = [
    RUN_BASH_TOOL_SCHEMA,
    ASK_USER_TOOL_SCHEMA,  
    TERMINATE_TOOL_SCHEMA, 
    SEARCH_TOOL_SCHEMA, # Add search tool
    READ_FILE_TOOL_SCHEMA, # Add file read tool
    EDIT_FILE_TOOL_SCHEMA, # Add file edit tool
    BROWSER_USER_TOOL_SCHEMA, # Add browser user tool
    PASTE_AT_CURSOR_TOOL_SCHEMA, # Add paste tool
    # Add other tool schemas here
] 