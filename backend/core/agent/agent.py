import json
import uuid
import asyncio
from typing import Optional, List, Dict, Any, AsyncGenerator, Tuple, TypedDict, Callable
# Import Stream type for better hinting if needed (optional)
from openai.types.chat import ChatCompletionChunk
# ChoiceDeltaToolCall is used for type hinting the chunk, not for accumulation state
from openai.types.chat.chat_completion_chunk import ChoiceDelta 
from pydantic import BaseModel
from dotenv import load_dotenv
import os

# Update import path for llm_client
from services.llm import get_llm_response_stream

# Load environment variables
load_dotenv()

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
    def __init__(self, model_name: str = "gpt-4.1-mini"):
        self.model_name = model_name
        self.memory: List[MessageDict] = [] # Initialize memory as a list of dictionaries
        self.pending_ask_user_tool_call_id: Optional[str] = None # State for pending ask_user ID
        # --- Updated System Prompt ---
        system_prompt = (
            "You are a helpful assistant that can interact with the user's local machine and maintain a memory of important information. "
            "You have the following tools available:\n\n"
            "Memory Tools:\n"
            "- add_to_memory: Store atomic facts about the user or context. ALWAYS break down complex information into simple, atomic facts before storing. "
            "Each fact should be a single, clear statement that captures one piece of information. For example, instead of storing "
            "'User prefers dark mode and uses vim keybindings', store as two facts: ['User prefers dark mode', 'User uses vim keybindings']. "
            "The system will automatically check for and update similar existing memories.\n"
            "- fetch_from_memory: Query your memory to recall relevant information. Use this before making assumptions about user preferences or context.\n\n"
            "System Tools:\n"
            "- run_bash_command: Execute a bash command on the user's machine. Use this for file operations, running scripts, etc. You do NOT need to ask for permission first.\n"
            "- read_file: Read the content of any file on the user's machine.\n"
            "- edit_file: Replace the first occurrence of 'string_to_replace' with 'new_string' in any file on the user's machine. Use with caution.\n"
            "- paste_at_cursor: Pastes the provided text content at the current cursor location in the user's active application.\n\n"
            "Web Tools:\n"
            "- Use `perform_web_search` to either:\n"
            "  1. Search the web with a query (e.g., \"latest Python features\")\n"
            "  2. Fetch content from a specific URL (e.g., \"https://docs.python.org\")\n"
            "- When fetching from a URL, ensure it's accessible and relevant\n"
            "- For general searches, use specific and focused queries\n"
            "- Process and summarize the results before presenting to the user\n"
            "Interaction Tools:\n"
            "- ask_user: Ask the user a clarifying question if you are unsure how to proceed or need more information. ONLY use this after checking memory first!\n"
            "- terminate: End the current interaction or task when the goal is achieved, you are stuck, or the user asks to stop.\n\n"
            "Memory Management Guidelines:\n"
            "1. ALWAYS check memory BEFORE asking the user for information:\n"
            "   - Use fetch_from_memory with relevant queries first\n"
            "   - Try multiple related queries if needed (e.g., 'user location', 'user city', 'where user lives')\n"
            "   - Only ask the user if no relevant information is found in memory\n"
            "   Example flow:\n"
            "   - User asks: 'Find pizza places near me'\n"
            "   - First action: fetch_from_memory with query 'user location' or 'user city'\n"
            "   - Only ask location if nothing found in memory\n\n"
            "2. ALWAYS break down information into atomic facts when using add_to_memory:\n"
            "   - Each fact should contain ONE piece of information\n"
            "   - Facts should be clear and unambiguous\n"
            "   - Use simple, declarative sentences\n"
            "   Examples:\n"
            "   - Good: ['User lives in San Francisco', 'User prefers vegetarian food', 'User works in SOMA district']\n"
            "   - Bad: ['User lives in San Francisco and likes vegetarian food']\n\n"
            "3. ALWAYS use add_to_memory when you learn new information about:\n"
            "   - User location and preferences\n"
            "   - Personal details (city, neighborhood, dietary preferences)\n"
            "   - Project context (goals, requirements)\n"
            "   - Technical environment (languages, frameworks)\n"
            "   - Important decisions made\n"
            "   - Recurring patterns in behavior\n\n"
            "4. ALWAYS use fetch_from_memory when:\n"
            "   - Starting a new interaction\n"
            "   - Asked about user preferences\n"
            "   - Making recommendations\n"
            "   - Needing context about ongoing work\n"
            "   - Before asking the user for any information\n\n"
            "Interaction Flow:\n"
            "1. ALWAYS start by fetching relevant memories about the context:\n"
            "   - Try multiple related queries to find information\n"
            "   - Consider different ways to phrase the query\n"
            "2. Process the user's request using available information\n"
            "3. Only ask the user for information if nothing relevant found in memory\n"
            "4. Break down any new information into atomic facts and store them\n"
            "5. Use terminate when the task is complete\n"
            "6. Keep responses concise unless asked for more detail\n\n"
            "Remember: Your memory is persistent! Always check it before asking users to repeat information they've shared before."
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
    async def step(self, api_keys: Optional[Dict[str, str]] = None, callbacks: Optional[List[Callable]] = None, connection_state: Optional[Dict] = None) -> AsyncGenerator[str | Dict[str, Any] | Tuple[str, float], None]:
        """Performs one step of interaction: gets LLM response and yields content/tool request."""
        print("[Agent] Executing agent step...")
        
        # --- Call the LLM Client Function --- 
        print("[Agent] Requesting LLM stream...")
        print(f"[Agent DEBUG] LLM Input Messages (step):\n{json.dumps(self.memory, indent=2)}") # Keep debug log here
        
        response_stream = get_llm_response_stream(
            model_name=self.model_name,
            messages=self.memory,
            api_keys=api_keys, # Pass keys
            connection_state=connection_state # Pass connection state
        )
        # --- End LLM Client Call --- 

        # Process stream for content or tool calls
        response_content = ""
        buffered_content = ""  # Buffer for potential JSON response 
        is_ollama_model = self.model_name.startswith("ollama/")  # Check if using Ollama
        looks_like_json = False  # Flag to check if response looks like JSON
        
        tool_calls_in_progress: Dict[int, Dict[str, Any]] = {} 
        finish_reason = None
        error_yielded = False # Flag to track if an error dict was yielded
        captured_finish_reason = None # Explicitly capture finish_reason within the loop
        extracted_cost = None # Variable to store cost tuple value

        async for chunk_or_error in response_stream:
            # Check for stop signal
            if connection_state and connection_state.get("stop_requested"):
                print("[Agent] Stop requested during stream processing")
                break

            # --- Check for final_cost tuple FIRST --- 
            if isinstance(chunk_or_error, tuple) and chunk_or_error[0] == "final_cost":
                extracted_cost = chunk_or_error[1] # Store the cost value
                print(f"[Agent DEBUG] Received final_cost tuple from llm_client: {extracted_cost}")
                continue # Consume the tuple, don't process as chunk
            # --- End check ---

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
            if finish_reason:
                captured_finish_reason = finish_reason # Capture it when it appears

            delta: ChoiceDelta | None = choice.delta

            if delta and delta.content:
                response_content += delta.content
                
                # Check if this looks like JSON when using Ollama
                if is_ollama_model:
                    buffered_content += delta.content
                    
                    # Check if response starts to look like JSON
                    if not looks_like_json and buffered_content.strip().startswith("{"):
                        looks_like_json = True
                        print("[Agent DEBUG] Response looks like JSON, buffering content")
                    
                    # Only stream if we're certain it's not JSON
                    if not looks_like_json:
                        yield delta.content
                else:
                    # For non-Ollama models, stream normally
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
            if captured_finish_reason == "tool_calls" and tool_calls_in_progress:
                # Finalize tool calls from the accumulated dictionaries
                final_tool_calls = list(tool_calls_in_progress.values()) 
                # Basic validation
                valid_tool_calls = [
                    call for call in final_tool_calls 
                    if call.get("id") and call.get("type") == "function" and 
                       isinstance(call.get("function"), dict) and call["function"].get("name")
                ]

                # --- Debug log before yielding tool request --- 
                print(f"[Agent DEBUG] Yielding tool call request: {valid_tool_calls}")
                # --- End Debug log --- 

                if valid_tool_calls:
                    print(f"[Agent] Detected tool calls: {[call['function']['name'] for call in valid_tool_calls]}")
                    
                    # Ensure arguments are in the expected string format for all tool calls
                    for call in valid_tool_calls:
                        if isinstance(call.get('function', {}).get('arguments'), dict):
                            # Convert dict arguments to JSON string
                            call['function']['arguments'] = json.dumps(call['function']['arguments'])
                    
                    # Add the assistant message *requesting* the tool call(s) to memory
                    self.add_message_to_memory(role="assistant", tool_calls=valid_tool_calls, content=None)
                    # Yield the request object (plain dict) to the WebSocket handler
                    yield {"type": 'tool_call_request', "tool_calls": valid_tool_calls}
                else:
                     print("[Agent] Warning: Tool call finish reason but no valid tool calls accumulated.")
                     # Add error state to memory? Or just yield error? 
                     self.add_message_to_memory(role="assistant", content="[Agent Error: Inconsistent tool call state]")
                     yield {"type": "error", "content": "[Agent Error: Inconsistent tool call detected]"}

            elif captured_finish_reason == "stop":
                print(f"[Agent] Finished normally (stop reason). Response length: {len(response_content)}")
                handled_as_tool_call = False # Flag to check if we parsed it as a tool call
                if response_content:
                    try:
                        # Attempt to parse the content as JSON
                        parsed_content = json.loads(response_content.strip())
                        # Check if it looks like the expected tool call structure
                        if isinstance(parsed_content, dict) and \
                           parsed_content.get("name") and \
                           isinstance(parsed_content.get("arguments"), dict):
                            
                            print("[Agent] Interpreting JSON content from 'stop' reason as a tool call.")
                            # Generate a plausible tool call ID (consider improving this)
                            tool_call_id = f"tool_{parsed_content['name']}_{abs(hash(str(parsed_content['arguments']))) % 10000}"
                            
                            # Convert the arguments to a string if it's not already
                            arguments_json = ""
                            if isinstance(parsed_content.get('arguments'), dict):
                                # Serialize the arguments back to a JSON string to match expected format
                                arguments_json = json.dumps(parsed_content['arguments'])
                            elif isinstance(parsed_content.get('arguments'), str):
                                arguments_json = parsed_content['arguments']
                                
                            # Build the final tool call with arguments as a serialized JSON string
                            final_tool_calls = [{
                                "id": tool_call_id,
                                "type": "function",
                                "function": {
                                    "name": parsed_content['name'],
                                    "arguments": arguments_json
                                }
                            }]
                            
                            print(f"[Agent DEBUG] Created tool call: {final_tool_calls}")
                            
                            # Add to memory as tool call request
                            self.add_message_to_memory(role="assistant", tool_calls=final_tool_calls, content=None)
                            # Yield the request object
                            yield {"type": 'tool_call_request', "tool_calls": final_tool_calls}
                            handled_as_tool_call = True
                            
                    except json.JSONDecodeError:
                        # Not JSON, treat as regular text
                        print("[Agent DEBUG] Content is not valid JSON.")
                        pass # handled_as_tool_call remains False
                    except (KeyError, TypeError) as e:
                        # JSON but not the expected structure
                        print(f"[Agent DEBUG] Content is JSON but not a valid tool call structure: {e}")
                        pass # handled_as_tool_call remains False
                
                # If it wasn't handled as a tool call, add as regular content
                if not handled_as_tool_call:
                    # If we buffered content (for Ollama JSON detection) but it wasn't actually a tool call,
                    # now we need to yield it to the client
                    if is_ollama_model and looks_like_json and not handled_as_tool_call:
                        print("[Agent DEBUG] Buffered content wasn't a tool call, yielding it now")
                        yield buffered_content
                        
                if response_content: 
                    self.add_message_to_memory(role="assistant", content=response_content)
                else:
                        # LLM finished with stop but no text and no tool calls
                        print("[Agent] Warning: Stream finished with stop reason but no text content and not parsed as tool call.")
                        self.add_message_to_memory(role="assistant", content=None)
            else:
                # Handle other finish reasons (length, content_filter, etc.) or incomplete streams
                print(f"[Agent] Stream finished with unexpected reason: {captured_finish_reason}")
                # Add partial response to memory
                if response_content:
                     self.add_message_to_memory(role="assistant", content=response_content + f" [Incomplete Response: {captured_finish_reason}]")
                else:
                     self.add_message_to_memory(role="assistant", content=f"[Agent Error: Stream ended unexpectedly. Reason: {captured_finish_reason}]")
                # Yield an error message/object
                yield {"type": "error", "content": f"[Agent Error: Stream ended unexpectedly. Reason: {captured_finish_reason}]"}
        else:
             print("[Agent] Skipping final processing due to earlier error.")

        # --- Yield the cost tuple at the very end if extracted --- 
        if extracted_cost is not None:
            print(f"[Agent DEBUG] Yielding final_cost tuple: {extracted_cost}")
            yield ("final_cost", extracted_cost)
        # --- End yield --- 

        print("[Agent] Step finished.")

    # Removed continue_step_with_tool_results method
