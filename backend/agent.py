import json
import asyncio
from typing import Optional, List, Dict, Any, AsyncGenerator, Tuple, TypedDict
# Import AsyncOpenAI for type hinting
from openai import AsyncOpenAI
# Import Stream type for better hinting if needed (optional)
from openai.types.chat import ChatCompletionChunk
# ChoiceDeltaToolCall is used for type hinting the chunk, not for accumulation state
from openai.types.chat.chat_completion_chunk import ChoiceDelta 

# Import tool schemas (used by llm_client now)
# from tools import TOOL_SCHEMAS 
# --- Import the new LLM client function --- 
from llm_client import get_llm_response_stream
# --- End import --- 

# Define message structure directly here if not using external types
# (Matching OpenAI API structure)
class MessageDict(TypedDict, total=False):
    role: str
    content: str | List[Dict[str, Any]] | None # Content can be None for tool calls
    tool_calls: List[Dict]
    tool_call_id: str

# Structure for yielding a tool call request - REMOVED
# class ToolCallRequest(TypedDict):
#     type: str # Should be 'tool_call_request'
#     tool_calls: List[Dict] # List of requested tool calls

class ChatAgent:
    """A self-contained agent to manage chat history and interact with an LLM."""

    # Update type hint for client
    def __init__(self, client: AsyncOpenAI, model_name: str = "gpt-4.1-mini"):
        self.client = client
        self.model_name = model_name
        self.memory: List[MessageDict] = [] # Initialize memory as a list of dictionaries
        self.pending_ask_user_tool_call_id: Optional[str] = None # State for pending ask_user ID
        # --- Updated System Prompt ---
        system_prompt = (
            "You are a helpful assistant that can interact with the user's local machine. "
            "You have the following tools available:\n"
            "- run_bash_command: Execute a bash command on the user's machine. Use this for file operations, running scripts, etc. You do NOT need to ask for permission first.\n"
            "- search: Search the web for information on a given query. Returns a list of results.\n"
            "- ask_user: Ask the user a clarifying question if you are unsure how to proceed or need more information.\n"
            "- terminate: End the current interaction or task when the goal is achieved, you are stuck, or the user asks to stop.\n\n"
            "- read_file: Read the content of a specific file on the user's machine (client-side execution).\n"
            "- edit_file: Replace the first occurrence of 'string_to_replace' with 'new_string' in the specified 'file_path' on the user's machine (client-side execution). Use with caution.\n\n"
            "Follow these steps:\n"
            "1. Understand the user's request based on their message and the screenshot context (if provided).\n"
            "2. Plan the steps needed. This might involve multiple tool uses (e.g., search the web, then run a command based on results).\n"
            "3. Execute the plan step-by-step using the available tools.\n"
            "4. If you need clarification, use the 'ask_user' tool.\n"
            "5. If you complete the task or cannot proceed, use the 'terminate' tool, optionally providing a reason.\n"
            "6. Respond concisely. Only provide necessary information or the direct result of commands unless asked for more detail."
        )
        self.memory.append({"role": "system", "content": system_prompt})
        # --- End Updated System Prompt ---

    def set_model(self, model_name: str):
        self.model_name = model_name

    def add_message_to_memory(self, role: str, content: Optional[str | List[Dict[str, Any]]] = None, tool_calls: Optional[List[Dict]] = None, tool_call_id: Optional[str] = None):
        """Adds a message dictionary to the agent's memory. Also handles adding tool results.
        If role is 'tool', content should be the result string.
        """
        message: MessageDict = {"role": role}
        if content is not None:
            message["content"] = content
        if tool_calls is not None:
            message["tool_calls"] = tool_calls
        if tool_call_id is not None:
            # This assumes role == 'tool' if tool_call_id is provided
            message["tool_call_id"] = tool_call_id
            if content is None:
                 # Ensure content is at least an empty string for tool results if not provided
                 message["content"] = "" 
                 
        print(f"[Memory Add] Adding: {message}") # Verbose log
        self.memory.append(message)

    # Refactored step method - handles one LLM call based on current memory
    async def step(self) -> AsyncGenerator[str | Dict[str, Any], None]:
        """Performs one step of interaction: gets LLM response and yields content/tool request."""
        print("[Agent] Executing agent step...")
        
        # --- Call the LLM Client Function --- 
        print("[Agent] Requesting LLM stream...")
        print(f"[Agent DEBUG] LLM Input Messages (step):\n{json.dumps(self.memory, indent=2)}") # Keep debug log here
        
        response_stream = get_llm_response_stream(
            client=self.client,
            model_name=self.model_name,
            messages=self.memory
            # Optionally pass temperature: temperature=0.8 
        )
        # --- End LLM Client Call --- 

        # Process stream for content or tool calls
        response_content = ""
        tool_calls_in_progress: Dict[int, Dict[str, Any]] = {} 
        finish_reason = None
        error_yielded = False # Flag to track if an error dict was yielded

        async for chunk_or_error in response_stream:
            # Check if the yielded item is an error dictionary
            if isinstance(chunk_or_error, dict) and chunk_or_error.get("type") == "error":
                print(f"[Agent] Received error from LLM client: {chunk_or_error['content']}")
                yield chunk_or_error # Forward the error dict
                error_yielded = True
                break # Stop processing the stream on error
            
            # Assume it's a ChatCompletionChunk if not an error dict
            chunk: ChatCompletionChunk = chunk_or_error
            
            # --- Start Debug Logging --- 
            # print(f"[Agent DEBUG] Raw Chunk: {chunk.model_dump_json(indent=2)}")
            # --- End Debug Logging --- 

            choice = chunk.choices[0] if chunk.choices else None
            if not choice: continue 

            finish_reason = choice.finish_reason
            delta: ChoiceDelta | None = choice.delta

            if delta and delta.content:
                response_content += delta.content
                yield delta.content 

            if delta and delta.tool_calls:
                # --- Debug Logging for Tool Call Chunks ---
                # print(f"\n--- [Agent DEBUG] Raw Tool Call Chunk START ---\n{chunk.model_dump_json(indent=2)}\n--- [Agent DEBUG] Raw Tool Call Chunk END ---\n")
                # --- End Debug Logging ---

                for tc_chunk in delta.tool_calls:
                    index = tc_chunk.index
                    # Initialize the standard dictionary if it's the first chunk for this index
                    if index not in tool_calls_in_progress: 
                        tool_calls_in_progress[index] = {
                            "id": tc_chunk.id, 
                            "type": "function", 
                            "function": {"name": tc_chunk.function.name or "", "arguments": ""}
                        }
                        # print(f"[Agent] Started accumulating tool call index {index}: id={tc_chunk.id}, name='{tc_chunk.function.name}'")
                    
                    # Append arguments
                    if tc_chunk.function and tc_chunk.function.arguments:
                         tool_calls_in_progress[index]["function"]["arguments"] += tc_chunk.function.arguments
                         
                    # Update name if it arrives later
                    if tc_chunk.function and tc_chunk.function.name and not tool_calls_in_progress[index]["function"]["name"]:
                         tool_calls_in_progress[index]["function"]["name"] = tc_chunk.function.name
                         # print(f"[Agent] Updated tool call name for index {index} to '{tc_chunk.function.name}'")

        # --- Debug Log: After Stream --- 
        print(f"\n[Agent DEBUG] Stream loop finished.")
        if not error_yielded:
            print(f"[Agent DEBUG] Final Finish Reason: {finish_reason}")
        # --- End Debug Log --- 

        # Handle finish reason ONLY if no error was yielded during streaming
        if not error_yielded:
            if finish_reason == "tool_calls" and tool_calls_in_progress:
                # Finalize tool calls from the accumulated dictionaries
                final_tool_calls = list(tool_calls_in_progress.values()) 
                # Basic validation
                valid_tool_calls = [
                    call for call in final_tool_calls 
                    if call.get("id") and call.get("type") == "function" and 
                       isinstance(call.get("function"), dict) and call["function"].get("name")
                ]

                if valid_tool_calls:
                    print(f"[Agent] Detected tool calls: {[call['function']['name'] for call in valid_tool_calls]}")
                    # Add the assistant message *requesting* the tool call(s) to memory
                    self.add_message_to_memory(role="assistant", tool_calls=valid_tool_calls, content=None)
                    # Yield the request object (plain dict) to the WebSocket handler
                    yield {"type": 'tool_call_request', "tool_calls": valid_tool_calls}
                else:
                     print("[Agent] Warning: Tool call finish reason but no valid tool calls accumulated.")
                     # Add error state to memory? Or just yield error? 
                     self.add_message_to_memory(role="assistant", content="[Agent Error: Inconsistent tool call state]")
                     yield {"type": "error", "content": "[Agent Error: Inconsistent tool call detected]"}

            elif finish_reason == "stop":
                print(f"[Agent] Finished normally (stop reason). Response length: {len(response_content)}")
                # Normal stop, add the complete assistant response to memory
                if response_content: 
                    self.add_message_to_memory(role="assistant", content=response_content)
                else:
                    # LLM finished with stop but no text and no tool calls - maybe just an acknowledgement? Add empty response.
                    print("[Agent] Warning: Stream finished with stop reason but no text content.")
                    self.add_message_to_memory(role="assistant", content=None) # Represent empty response
                    # Do we need to yield anything here? Main expects an 'end' signal later.
            else:
                # Handle other finish reasons (length, content_filter, etc.) or incomplete streams
                print(f"[Agent] Stream finished with unexpected reason: {finish_reason}")
                # Add partial response to memory
                if response_content:
                     self.add_message_to_memory(role="assistant", content=response_content + f" [Incomplete Response: {finish_reason}]")
                else:
                     self.add_message_to_memory(role="assistant", content=f"[Agent Error: Stream ended unexpectedly. Reason: {finish_reason}]")
                # Yield an error message/object
                yield {"type": "error", "content": f"[Agent Error: Stream ended unexpectedly. Reason: {finish_reason}]"}
        else:
             print("[Agent] Skipping final processing due to earlier error.")

        print("[Agent] Step finished.")

    # Removed continue_step_with_tool_results method
