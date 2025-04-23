"""System-related tools for bash commands and clipboard operations."""

async def run_bash_command(command: str) -> str:
    """Describes the function to run a bash command (execution happens client-side).

    Args:
        command: The bash command string to execute.
        
    Returns:
        A string containing the standard output or error from the client-side execution.
    """
    print(f"[Tool Definition] run_bash_command with command: {command}")
    return "Placeholder: Tool execution is handled by the client."

# --- Tool Schemas ---
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