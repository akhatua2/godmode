import os
import json
import traceback
import asyncio # Added for future handling
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from dotenv import load_dotenv
# Import only ChatAgent, ToolCallRequest is no longer needed
from agent import ChatAgent 
from typing import List, Dict, Any, Callable, Tuple, Optional
# --- Import Server Tool Registry --- 
from tools import SERVER_EXECUTABLE_TOOLS, execute_browser_task # Explicitly import execute_browser_task for type check
# --- End Import --- 

# Load environment variables from .env file
load_dotenv()

# Ensure necessary environment variables are set for LiteLLM (e.g., OPENAI_API_KEY)
if not os.getenv("OPENAI_API_KEY"):
    print("[CRITICAL ERROR] OPENAI_API_KEY not found in environment variables. LiteLLM cannot function.")
    # Optionally exit or raise an exception

app = FastAPI()

# --- Shared state for pending agent questions --- 
PENDING_AGENT_QUESTIONS: Dict[str, Dict[str, asyncio.Future]] = {}
# --- End Shared State ---

# --- Helper function to run agent step and handle output ---
async def run_agent_step_and_send(agent: ChatAgent, websocket: WebSocket) -> Tuple[bool, Optional[float]]:
    """Runs one step of the agent and sends chunks/tool requests over WebSocket.
    Returns a tuple: (agent_finished_turn: bool, cost: Optional[float])
    """
    stream_ended = False
    first_tool_name = None # Initialize variable
    final_cost_from_agent = None # Initialize cost variable
    try:
        # Directly iterate and capture cost within this function
        async for result in agent.step():
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
                        websocket_id = str(websocket.client) # Generate websocket ID
                        try:
                            # Parse arguments
                            parsed_args = json.loads(arguments)
                            # --- Execute the tool function --- 
                            if server_function is execute_browser_task: # Check if it's the browser tool
                                task_arg = parsed_args.get('task')
                                if task_arg:
                                    print(f"[WebSocket] Calling execute_browser_task for websocket {websocket_id}")
                                    result_content = await execute_browser_task(
                                        task=task_arg, 
                                        websocket=websocket, 
                                        websocket_id=websocket_id, 
                                        pending_questions_dict=PENDING_AGENT_QUESTIONS
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
                            agent_finished, _ = await run_agent_step_and_send(agent, websocket)
                            return agent_finished, final_cost_from_agent
                        except json.JSONDecodeError:
                            print(f"[WebSocket Error] Failed to parse arguments for {first_tool_name}: {arguments}")
                            agent.add_message_to_memory(role="tool", tool_call_id=tool_call_id, content=f"Error: Invalid arguments provided for {first_tool_name}.")
                            agent_finished, _ = await run_agent_step_and_send(agent, websocket)
                            return agent_finished, final_cost_from_agent
                        except Exception as tool_exec_error:
                            print(f"[WebSocket Error] Error executing server tool {first_tool_name}: {tool_exec_error}")
                            traceback.print_exc()
                            agent.add_message_to_memory(role="tool", tool_call_id=tool_call_id, content=f"Error executing tool {first_tool_name}: {tool_exec_error}")
                            agent_finished, _ = await run_agent_step_and_send(agent, websocket)
                            return agent_finished, final_cost_from_agent
                    # --- End Server-Side Tool Check --- 
                    
                    # --- Client-Side and Flow Tools --- 
                    elif first_tool_name in ["run_bash_command", "read_file", "edit_file", "paste_at_cursor"]:
                        print(f"WebSocket sending tool_call_request for: {first_tool_name}")
                        # Send the specific tool call object, not the whole result dict
                        await websocket.send_text(json.dumps({"type": "tool_call_request", "tool_calls": [first_tool_call]}))
                        stream_ended = True 
                        return False, final_cost_from_agent
                    elif first_tool_name == "ask_user":
                        if tool_call_id:
                            agent.pending_ask_user_tool_call_id = tool_call_id
                            print(f"[WebSocket] Stored pending ask_user ID: {tool_call_id}")
                        else: 
                             print("[WebSocket WARNING] ask_user tool call missing ID!")
                        question = json.loads(arguments).get("question", "")
                        print(f"WebSocket sending ask_user_request: {question[:50]}...")
                        await websocket.send_text(json.dumps({"type": "ask_user_request", "question": question}))
                        stream_ended = True 
                        break
                    elif first_tool_name == "terminate":
                        reason = json.loads(arguments).get("reason", "Task finished.")
                        print(f"WebSocket sending terminate_request: {reason}")
                        await websocket.send_text(json.dumps({"type": "terminate_request", "reason": reason}))
                        stream_ended = True 
                        break
                    else:
                        # Unknown tool requested?
                        print(f"[WebSocket WARNING] Agent requested unknown tool: {first_tool_name}")
                        await websocket.send_text(json.dumps({"type": "error", "content": f"Agent requested unknown tool: {first_tool_name}"}))
                        stream_ended = True
                        break
                elif result_type == "error": # Handle explicit errors yielded by agent
                    print(f"[WebSocket] Agent yielded error: {result.get('content')}")
                    await websocket.send_text(json.dumps(result))
                    stream_ended = True
                    break 
                else:
                    print(f"[WebSocket WARNING] Unexpected dict result type from agent.step: {result_type} - {result}")
            else:
                 # Log unexpected type if neither matches
                print(f"[WebSocket WARNING] Unexpected result type from agent.step: {type(result)} - {result}")
        
        # Send end signal ONLY if the stream wasn't already ended by a tool request/error
        if not stream_ended:
            await websocket.send_text(json.dumps({"type": "end", "content": ""}))
            print("WebSocket sent stream end signal (agent step finished naturally).")
            return True, final_cost_from_agent
        else:
             print("WebSocket stream ended due to tool request or error, not sending duplicate 'end'.")
             # If it was ended by ask_user or terminate, the agent's turn is still considered finished
             # Check if first_tool_name was set before comparing
             if first_tool_name and (first_tool_name == "ask_user" or first_tool_name == "terminate"):
                 return True, final_cost_from_agent
             else: # Must be run_bash_command, server tool, or an error
                 return False, final_cost_from_agent
                 
    except Exception as e:
        print(f"Error during agent step execution or sending: {e}")
        traceback.print_exc()
        # Try to send error to client
        try:
            await websocket.send_text(json.dumps({"type": "error", "content": f"Error during agent processing: {str(e)}"}))
        except Exception:
            pass # Ignore if sending fails
        # Indicate agent turn did not finish cleanly, cost might be None
        return False, final_cost_from_agent


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("WebSocket connection established.")
    # Check if OPENAI_API_KEY is present (as LiteLLM relies on it)
    if not os.getenv("OPENAI_API_KEY"):
        print("WebSocket closing: OPENAI_API_KEY not found for LiteLLM.")
        await websocket.send_text(json.dumps({"type": "error", "content": "Backend LLM provider key not configured."}))
        await websocket.close(code=1008)
        return
        
    # Create an agent instance for this connection
    agent = ChatAgent() # Client no longer needed
    print(f"ChatAgent instance created for WebSocket {websocket.client}")
        
    websocket_id = str(websocket.client) # Get websocket ID for this connection
    print(f"WebSocket assigned ID: {websocket_id}")

    # --- Session Cost Tracking --- 
    session_total_cost = 0.0 # Initialize total cost for the session
    # --- End Cost Tracking (Initialization) --- 

    try:
        while True:
            # Receive message from Electron client
            data = await websocket.receive_text()
            print(f"WebSocket received: {data[:200]}...")
            try:
                message_data = json.loads(data)
                message_type = message_data.get("type")

                if message_type == "user_message":
                    text = message_data.get("text")
                    screenshot_data_url = message_data.get("screenshot_data_url")
                    # --- Get context text --- 
                    context_text = message_data.get("context_text") # Can be None or empty string
                    # --- End get context --- 

                    if not text:
                        await websocket.send_text(json.dumps({"type": "error", "content": "Missing text in user_message"}))
                        continue
                    
                    print(f"[WebSocket] Processing user_message: {text[:50]}... Context provided: {bool(context_text)}")
                    
                    # --- Check if responding to ask_user --- 
                    if agent.pending_ask_user_tool_call_id:
                        print(f"[WebSocket] Treating user message as response to ask_user ID: {agent.pending_ask_user_tool_call_id}")
                        # Add as TOOL message (DO NOT prepend context here)
                        agent.add_message_to_memory(
                            role="tool",
                            tool_call_id=agent.pending_ask_user_tool_call_id,
                            content=text
                        )
                        agent.pending_ask_user_tool_call_id = None # Clear the pending ID
                    else:
                        # --- Prepare user content, potentially prepending context --- 
                        final_text_content = text
                        if context_text and context_text.strip(): # Check if context exists and is not just whitespace
                            final_text_content = f"Based on this context:\n```\n{context_text}\n```\n\n{text}"
                            print("[WebSocket] Prepended context to user message.")
                        
                        # Add as standard USER message
                        user_content: List[Dict[str, Any]] = [{"type": "text", "text": final_text_content}]
                        if screenshot_data_url:
                            user_content.append({
                                "type": "image_url",
                                "image_url": {"url": screenshot_data_url}
                            })
                        agent.add_message_to_memory(role="user", content=user_content)
                        # --- End message preparation and adding --- 
                    # --- End message adding logic ---
                    
                    # --- Run the agent step --- 
                    agent_finished_turn, step_cost = await run_agent_step_and_send(agent, websocket)
                    if step_cost is not None:
                        session_total_cost += step_cost
                        print(f"[WebSocket] LLM call cost: ${step_cost:.6f}, Session total: ${session_total_cost:.6f}")
                        # Send cost update to frontend
                        await websocket.send_text(json.dumps({
                            "type": "cost_update",
                            "total_cost": session_total_cost
                        }))
                    else:
                        print("[WebSocket WARNING] Agent step finished but no cost was returned.")
                        
                elif message_type == "tool_result":
                    results = message_data.get("results")
                    if not results or not isinstance(results, list): 
                        await websocket.send_text(json.dumps({"type": "error", "content": "Missing or invalid results in tool_result message"}))
                        continue
                        
                    print(f"[WebSocket] Processing tool_result for {len(results)} tool(s)...")
                    # --- Add tool results to agent memory --- 
                    for result in results:
                         if result.get("tool_call_id"):
                             agent.add_message_to_memory(role="tool", 
                                                       tool_call_id=result["tool_call_id"], 
                                                       content=str(result.get("content", ""))) # Ensure content is string
                         else:
                             print("[WebSocket WARNING] Received tool_result missing tool_call_id")
                     
                    # --- DEBUG: Print memory after adding tool result --- 
                    print(f"[WebSocket DEBUG] Agent memory AFTER adding tool results:")
                    print(json.dumps(agent.memory, indent=2))
                    # --- END DEBUG --- 
                    
                    # --- Run the agent step AGAIN with the new tool results in memory --- 
                    print("[WebSocket] Triggering agent step after receiving tool results...")
                    agent_finished_turn, step_cost = await run_agent_step_and_send(agent, websocket)
                    if step_cost is not None:
                        session_total_cost += step_cost
                        print(f"[WebSocket] LLM call cost: ${step_cost:.6f}, Session total: ${session_total_cost:.6f}")
                        # Send cost update to frontend
                        await websocket.send_text(json.dumps({
                            "type": "cost_update",
                            "total_cost": session_total_cost
                        }))
                    else:
                        print("[WebSocket WARNING] Agent step finished but no cost was returned.")
                    
                elif message_type == "user_response":
                    # --- Handle response for agent's question --- 
                    request_id = message_data.get("request_id")
                    answer = message_data.get("answer")
                    if not request_id or answer is None: # Check if answer is present (can be empty string)
                        await websocket.send_text(json.dumps({"type": "error", "content": "Missing request_id or answer in user_response"}))
                        continue

                    print(f"[WebSocket] Processing user_response for request_id: {request_id}")
                    # Look up the future in the shared dictionary
                    future = PENDING_AGENT_QUESTIONS.get(websocket_id, {}).get(request_id)

                    if future and not future.done():
                        print(f"[WebSocket] Found pending future for {request_id}. Setting result.")
                        future.set_result(answer) # Resolve the future, unblocking the agent
                        # DO NOT call run_agent_step_and_send here - agent resumes automatically
                    elif future and future.done():
                        print(f"[WebSocket WARNING] Received user_response for already completed request_id: {request_id}")
                        # Optionally notify client? Or just ignore.
                    else:
                        print(f"[WebSocket WARNING] Received user_response for unknown or expired request_id: {request_id} for websocket {websocket_id}")
                        await websocket.send_text(json.dumps({"type": "warning", "content": f"Received response for unknown or expired request ID {request_id}."}))
                    # --- End user_response handling ---
                    
                # --- Handle setting LLM model --- 
                elif message_type == "set_llm_model":
                    model_name = message_data.get("model_name")
                    if model_name and isinstance(model_name, str):
                        print(f"[WebSocket] Received request to set model to: {model_name}")
                        agent.set_model(model_name) # Use existing agent method
                        # Optionally send confirmation back?
                        # await websocket.send_text(json.dumps({"type": "info", "content": f"Model set to {model_name}"}))
                    else:
                        print(f"[WebSocket WARNING] Received invalid set_llm_model message: {message_data}")
                        await websocket.send_text(json.dumps({"type": "error", "content": "Invalid or missing model_name in set_llm_model message"}))
                # --- End set_llm_model handling ---
                
                else:
                    print(f"[WebSocket WARNING] Invalid message type received: {message_type}")
                    await websocket.send_text(json.dumps({"type": "error", "content": f"Invalid message type received: {message_type}"}))

            except json.JSONDecodeError:
                print("WebSocket received invalid JSON")
                await websocket.send_text(json.dumps({"type": "error", "content": "Invalid JSON received"}))
            except Exception as e:
                # Print the full traceback
                print(f"Error processing message via WebSocket (see traceback below):")
                traceback.print_exc() 
                error_message = str(e)
                await websocket.send_text(json.dumps({"type": "error", "content": f"Error processing request: {error_message}"}))

    except WebSocketDisconnect:
        print(f"WebSocket connection closed for {websocket.client}.")
    except Exception as e:
        # Catch potential errors during the receive loop itself
        print(f"Unexpected WebSocket error for {websocket.client} (see traceback below):")
        traceback.print_exc()
        # Attempt to close gracefully if possible
        try:
            await websocket.send_text(json.dumps({"type": "error", "content": f"Unexpected WebSocket error"}))
            await websocket.close(code=1011)
        except RuntimeError:
            pass # Already closed
    finally:
        # --- Cleanup agent questions for this websocket when connection closes ---
        if websocket_id in PENDING_AGENT_QUESTIONS:
            print(f"[WebSocket Cleanup] Cleaning up pending questions for websocket {websocket_id} on disconnect.")
            for request_id, future in PENDING_AGENT_QUESTIONS[websocket_id].items():
                if not future.done():
                    future.cancel("WebSocket connection closed.")
            del PENDING_AGENT_QUESTIONS[websocket_id]
        # --- End Cleanup ---

@app.get("/") # Basic root endpoint for testing
async def read_root():
    return {"message": "FastAPI backend is running (WebSocket at /ws)"}

# To run this: 
# cd backend
# (Activate venv)
# pip install -r requirements.txt
# uvicorn main:app --reload 