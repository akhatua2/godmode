import os
import json
import traceback
import asyncio
from fastapi import WebSocket, HTTPException # Only WebSocket needed here from fastapi
from core.agent.agent import ChatAgent 
from typing import List, Dict, Any, Callable, Tuple, Optional
# --- Import Server Tool Registry --- 
from core.tools.base import SERVER_EXECUTABLE_TOOLS, execute_browser_task 
# --- Import state potentially needed by tools ---
# This creates a potential circular dependency if tools also import this.
# Consider passing necessary state (like PENDING_AGENT_QUESTIONS) as arguments instead.
# from main import PENDING_AGENT_QUESTIONS # REMOVED: Avoid circular import

# --- Helper function to run agent step and handle output --- 
async def run_agent_step_and_send(
    agent: ChatAgent, 
    websocket: WebSocket, 
    pending_questions_dict: Dict[str, Dict[str, asyncio.Future]], # Added argument
    api_keys: Optional[Dict[str, str]] = None # ADDED: Accept API keys
) -> Tuple[bool, Optional[float]]:
    """Runs one step of the agent and sends chunks/tool requests over WebSocket.
    Returns a tuple: (agent_finished_turn: bool, cost: Optional[float])
    """
    stream_ended = False
    first_tool_name = None # Initialize variable
    final_cost_from_agent = None # Initialize cost variable
    try:
        # Directly iterate and capture cost within this function
        async for result in agent.step(api_keys=api_keys):
            # --- Check for final_cost tuple --- 
            if isinstance(result, tuple) and result[0] == "final_cost":
                 final_cost_from_agent = result[1]
                 print(f"[run_agent_step_and_send] Captured final_cost: {final_cost_from_agent}")
                 # Don't yield this tuple outside, just capture it.
                 continue # Skip further processing of the tuple itself
            # --- End check ---
            
            if isinstance(result, str): # Text chunk
                await websocket.send_text(json.dumps({"type": "chunk", "content": result}))
            elif isinstance(result, dict):
                result_type = result.get("type")
                if result_type == "tool_call_request":
                    tool_calls = result.get("tool_calls", [])
                    if not tool_calls: 
                        print("[WebSocket WARNING] Received tool_call_request with no tool_calls")
                        await websocket.send_text(json.dumps({"type": "error", "content": "Agent requested tool call but sent no tools."}))
                        stream_ended = True
                        break # Exit the async for loop
                        
                    first_tool_call = tool_calls[0] # Expecting only one due to parallel_tool_calls=False
                    first_tool_name = first_tool_call.get("function", {}).get("name")
                    tool_call_id = first_tool_call.get("id")
                    arguments = first_tool_call.get("function", {}).get("arguments", "{}") # Get arguments string
                    
                    # --- Check if it's a Server-Side Tool --- 
                    if first_tool_name in SERVER_EXECUTABLE_TOOLS:
                        print(f"[WebSocket] Executing server-side tool: {first_tool_name}")
                        server_function = SERVER_EXECUTABLE_TOOLS[first_tool_name]
                        connection_key = str(websocket.client) # Use connection key
                        try:
                            # Parse arguments
                            parsed_args = json.loads(arguments)
                            # --- Execute the tool function --- 
                            if server_function is execute_browser_task: # Check if it's the browser tool
                                task_arg = parsed_args.get('task')
                                if task_arg:
                                    print(f"[WebSocket] Calling execute_browser_task for connection {connection_key}")
                                    result_content = await execute_browser_task(
                                        task=task_arg, 
                                        websocket=websocket, 
                                        websocket_id=connection_key, 
                                        pending_questions_dict=pending_questions_dict # Use passed argument
                                    )
                                else:
                                    result_content = "Error: Missing 'task' argument for browser_user tool."
                            else: # For other server-side tools (e.g., search)
                                result_content = await server_function(**parsed_args)
                            # --- End Tool Execution --- 
                            
                            # Add result to memory
                            agent.add_message_to_memory(role="tool", 
                                                      tool_call_id=tool_call_id, 
                                                      content=result_content)
                            # Trigger the next agent step immediately
                            print("[WebSocket] Triggering agent step after server tool execution...")
                            # Recursive call - ensure agent state is consistent
                            agent_finished, cost_from_nested_step = await run_agent_step_and_send(
                                agent, websocket, pending_questions_dict, api_keys=api_keys # Pass keys in recursion
                            )
                            # Combine costs if applicable (tricky with recursion, might double count)
                            # For simplicity, just return the cost from the *initial* step if available
                            return agent_finished, final_cost_from_agent if final_cost_from_agent is not None else cost_from_nested_step
                        except json.JSONDecodeError:
                            print(f"[WebSocket Error] Failed to parse arguments for {first_tool_name}: {arguments}")
                            agent.add_message_to_memory(role="tool", tool_call_id=tool_call_id, content=f"Error: Invalid arguments provided for {first_tool_name}.")
                            # Recursive call after error
                            agent_finished, cost_from_nested_step = await run_agent_step_and_send(
                                agent, websocket, pending_questions_dict, api_keys=api_keys # Pass keys in recursion
                            )
                            return agent_finished, final_cost_from_agent if final_cost_from_agent is not None else cost_from_nested_step
                        except Exception as tool_exec_error:
                            print(f"[WebSocket Error] Error executing server tool {first_tool_name}: {tool_exec_error}")
                            traceback.print_exc()
                            agent.add_message_to_memory(role="tool", tool_call_id=tool_call_id, content=f"Error executing tool {first_tool_name}: {tool_exec_error}")
                            # Recursive call after error
                            agent_finished, cost_from_nested_step = await run_agent_step_and_send(
                                agent, websocket, pending_questions_dict, api_keys=api_keys # Pass keys in recursion
                            )
                            return agent_finished, final_cost_from_agent if final_cost_from_agent is not None else cost_from_nested_step
                    # --- End Server-Side Tool Check --- 
                    
                    # --- Client-Side and Flow Tools --- 
                    elif first_tool_name in ["run_bash_command", "read_file", "edit_file", "paste_at_cursor"]:
                        print(f"WebSocket sending tool_call_request for: {first_tool_name}")
                        # Send the specific tool call object, not the whole result dict
                        await websocket.send_text(json.dumps({"type": "tool_call_request", "tool_calls": [first_tool_call]}))
                        stream_ended = True # Mark stream ended, but agent turn is NOT finished
                        return False, final_cost_from_agent # Return False for agent_finished_turn
                    elif first_tool_name == "ask_user":
                        if tool_call_id:
                            agent.pending_ask_user_tool_call_id = tool_call_id
                            print(f"[WebSocket] Stored pending ask_user ID: {tool_call_id}")
                        else: 
                             print("[WebSocket WARNING] ask_user tool call missing ID!")
                        question = json.loads(arguments).get("question", "")
                        print(f"WebSocket sending ask_user_request: {question[:50]}...")
                        await websocket.send_text(json.dumps({"type": "ask_user_request", "question": question}))
                        stream_ended = True # Mark stream ended
                        break # Exit the loop, agent turn IS finished
                    elif first_tool_name == "terminate":
                        reason = json.loads(arguments).get("reason", "Task finished.")
                        print(f"WebSocket sending terminate_request: {reason}")
                        await websocket.send_text(json.dumps({"type": "terminate_request", "reason": reason}))
                        stream_ended = True # Mark stream ended
                        break # Exit the loop, agent turn IS finished
                    else:
                        # Unknown tool requested?
                        print(f"[WebSocket WARNING] Agent requested unknown tool: {first_tool_name}")
                        await websocket.send_text(json.dumps({"type": "error", "content": f"Agent requested unknown tool: {first_tool_name}"}))
                        stream_ended = True # Mark stream ended
                        break # Exit the loop, agent turn IS finished (with error)
                elif result_type == "error": # Handle explicit errors yielded by agent
                    print(f"[WebSocket] Agent yielded error: {result.get('content')}")
                    await websocket.send_text(json.dumps(result))
                    stream_ended = True # Mark stream ended
                    break # Exit the loop, agent turn IS finished (with error)
                else:
                    print(f"[WebSocket WARNING] Unexpected dict result type from agent.step: {result_type} - {result}")
            else:
                 # Log unexpected type if neither matches
                print(f"[WebSocket WARNING] Unexpected result type from agent.step: {type(result)} - {result}")
        
        # Agent loop finished naturally (no break from tool request/error)
        if not stream_ended:
            await websocket.send_text(json.dumps({"type": "end", "content": ""}))
            print("WebSocket sent stream end signal (agent step finished naturally).")
            return True, final_cost_from_agent
        else:
             # Stream ended due to a break (ask_user, terminate, unknown tool, agent error)
             print("WebSocket stream ended due to break, not sending duplicate 'end'.")
             # Agent turn is considered finished in these cases
             return True, final_cost_from_agent 
                 
    except Exception as e:
        print(f"Error during agent step execution or sending: {e}")
        traceback.print_exc()
        # Try to send error to client
        try:
            await websocket.send_text(json.dumps({"type": "error", "content": f"Error during agent processing: {str(e)}"}))
        except Exception:
            pass # Ignore if sending fails
        # Indicate agent turn did not finish cleanly, cost might be None
        return False, final_cost_from_agent # Return False as turn didn't complete successfully