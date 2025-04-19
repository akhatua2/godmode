import asyncio
import subprocess

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

# Map of tool names to functions (Not needed if execution is client-side)
# AVAILABLE_TOOLS = {
#     "run_bash_command": run_bash_command, 
# }

# List of tool schemas to pass to the API
TOOL_SCHEMAS = [
    RUN_BASH_TOOL_SCHEMA,
    ASK_USER_TOOL_SCHEMA,  # Add ask_user
    TERMINATE_TOOL_SCHEMA, # Add terminate
    # Add other tool schemas here
] 