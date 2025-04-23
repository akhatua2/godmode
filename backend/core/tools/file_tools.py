"""File-related tools for reading and editing files."""

async def read_file(file_path: str) -> str:
    """Describes the function to read a file (execution happens client-side).

    Args:
        file_path: The path to the file to be read on the client's machine.

    Returns:
        A placeholder string indicating client-side execution.
    """
    print(f"[Tool Definition] read_file for path: {file_path}")
    return "Placeholder: Tool execution is handled by the client."

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
    return "Placeholder: Tool execution is handled by the client."

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