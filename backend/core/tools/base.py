"""Core functionality and base imports."""

import asyncio
import os
from dotenv import load_dotenv
from tavily import TavilyClient
from langchain_openai import ChatOpenAI

from app.config import (
    TAVILY_API_KEY,
    OPENAI_API_KEY,
    DEFAULT_MODEL,
    PLANNER_MODEL,
    CHROME_PATH
)

# Import tool modules
from .file_tools import (
    READ_FILE_TOOL_SCHEMA,
    EDIT_FILE_TOOL_SCHEMA,
    read_file,
    edit_file
)
from .web_tools import (
    SEARCH_TOOL_SCHEMA,
    BROWSER_USER_TOOL_SCHEMA,
    perform_web_search,
    execute_browser_task
)
from .system_tools import (
    RUN_BASH_TOOL_SCHEMA,
    PASTE_AT_CURSOR_TOOL_SCHEMA,
    run_bash_command
)
from .interaction_tools import (
    ASK_USER_TOOL_SCHEMA,
    TERMINATE_TOOL_SCHEMA
)
from .memory_tools import (
    ADD_TO_MEMORY_TOOL_SCHEMA,
    FETCH_FROM_MEMORY_TOOL_SCHEMA,
    add_to_memory,
    fetch_from_memory
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

# --- Registry for Server-Executable Tools --- 
SERVER_EXECUTABLE_TOOLS = {
    "search": perform_web_search,
    # "browser_user": execute_browser_task,
    "add_to_memory": add_to_memory,
    "fetch_from_memory": fetch_from_memory,
}
# --- End Registry --- 

# List of tool schemas to pass to the API
TOOL_SCHEMAS = [
    RUN_BASH_TOOL_SCHEMA,
    ASK_USER_TOOL_SCHEMA,  
    TERMINATE_TOOL_SCHEMA, 
    SEARCH_TOOL_SCHEMA,
    READ_FILE_TOOL_SCHEMA,
    EDIT_FILE_TOOL_SCHEMA,
    # BROWSER_USER_TOOL_SCHEMA,
    PASTE_AT_CURSOR_TOOL_SCHEMA,
    ADD_TO_MEMORY_TOOL_SCHEMA,
    FETCH_FROM_MEMORY_TOOL_SCHEMA,
] 