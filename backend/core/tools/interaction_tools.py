"""User interaction tools for asking questions and terminating tasks."""

# --- Tool Schemas ---
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
            "required": [],
        },
    }
} 