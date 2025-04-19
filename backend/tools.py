import asyncio
import subprocess
import os # For reading env vars
from dotenv import load_dotenv # For reading env vars
from tavily import TavilyClient # Import Tavily client

# --- Load Env Vars and Initialize Tavily Client ---
load_dotenv()
tavily_api_key = os.getenv("TAVILY_API_KEY")
if not tavily_api_key:
    print("[WARN] TAVILY_API_KEY not found in environment variables. Search tool will not work.")
    tavily_client = None
else:
    tavily_client = TavilyClient(api_key=tavily_api_key)
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

# --- Registry for Server-Executable Tools --- 
SERVER_EXECUTABLE_TOOLS = {
    "search": perform_web_search,
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
    # Add other tool schemas here
] 