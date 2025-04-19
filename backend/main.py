import os
import json
import traceback
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import AsyncOpenAI
# Import only ChatAgent, ToolCallRequest is no longer needed
from agent import ChatAgent 
from typing import List, Dict, Any
# --- Import Server Tool Registry --- 
from tools import SERVER_EXECUTABLE_TOOLS
# --- End Import --- 

# Load environment variables from .env file
load_dotenv()

# Initialize AsyncOpenAI client 
try:
    # Use AsyncOpenAI()
    client = AsyncOpenAI()
except Exception as e:
    print(f"Error initializing AsyncOpenAI client: {e}")
    # Handle error appropriately
    client = None 

app = FastAPI()

# --- Helper function to run agent step and handle output ---
async def run_agent_step_and_send(agent: ChatAgent, websocket: WebSocket):
    """Runs one step of the agent and sends chunks/tool requests over WebSocket."""
    stream_ended = False
    first_tool_name = None # Initialize variable
    try:
        async for result in agent.step():
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
                        try:
                            # Parse arguments
                            parsed_args = json.loads(arguments)
                            # Execute the tool function
                            result_content = await server_function(**parsed_args)
                            # Add result to memory
                            agent.add_message_to_memory(role="tool", 
                                                      tool_call_id=tool_call_id, 
                                                      content=result_content)
                            # Trigger the next agent step immediately
                            print("[WebSocket] Triggering agent step after server tool execution...")
                            await run_agent_step_and_send(agent, websocket)
                            # Since the helper handles the next step, we mark this stream as ended conceptually
                            stream_ended = True 
                            return False # Indicate the flow continues in the recursive call
                        except json.JSONDecodeError:
                            print(f"[WebSocket Error] Failed to parse arguments for {first_tool_name}: {arguments}")
                            agent.add_message_to_memory(role="tool", tool_call_id=tool_call_id, content=f"Error: Invalid arguments provided for {first_tool_name}.")
                            await run_agent_step_and_send(agent, websocket) # Let agent handle the error
                            stream_ended = True
                            return False
                        except Exception as tool_exec_error:
                            print(f"[WebSocket Error] Error executing server tool {first_tool_name}: {tool_exec_error}")
                            traceback.print_exc()
                            agent.add_message_to_memory(role="tool", tool_call_id=tool_call_id, content=f"Error executing tool {first_tool_name}: {tool_exec_error}")
                            await run_agent_step_and_send(agent, websocket) # Let agent handle the error
                            stream_ended = True
                            return False
                    # --- End Server-Side Tool Check --- 
                    
                    # --- Client-Side and Flow Tools --- 
                    elif first_tool_name in ["run_bash_command", "read_file", "edit_file"]:
                        print(f"WebSocket sending tool_call_request for: {first_tool_name}")
                        # Send the specific tool call object, not the whole result dict
                        await websocket.send_text(json.dumps({"type": "tool_call_request", "tool_calls": [first_tool_call]}))
                        stream_ended = True 
                        return False 
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
            return True # Indicate agent finished its turn
        else:
             print("WebSocket stream ended due to tool request or error, not sending duplicate 'end'.")
             # If it was ended by ask_user or terminate, the agent's turn is still considered finished
             # Check if first_tool_name was set before comparing
             if first_tool_name and (first_tool_name == "ask_user" or first_tool_name == "terminate"):
                 return True
             else: # Must be run_bash_command or an error (where first_tool_name might be None)
                 return False # Indicate agent turn is NOT finished (waiting for tool result or error occurred)
                 
    except Exception as e:
        print(f"Error during agent step execution or sending: {e}")
        traceback.print_exc()
        # Try to send error to client
        try:
            await websocket.send_text(json.dumps({"type": "error", "content": f"Error during agent processing: {str(e)}"}))
        except Exception:
            pass # Ignore if sending fails
        return False # Indicate agent turn did not finish cleanly


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("WebSocket connection established.")
    if not client:
        print("WebSocket closing: AsyncOpenAI client not initialized.")
        await websocket.send_text(json.dumps({"type": "error", "content": "Backend OpenAI client not initialized"}))
        await websocket.close(code=1008)
        return
        
    # Create an agent instance for this connection
    agent = ChatAgent(client=client)
    print(f"ChatAgent instance created for WebSocket {websocket.client}")
        
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
                    if not text:
                        await websocket.send_text(json.dumps({"type": "error", "content": "Missing text in user_message"}))
                        continue
                    
                    print(f"[WebSocket] Processing user_message: {text[:50]}...")
                    
                    # --- Check if responding to ask_user --- 
                    if agent.pending_ask_user_tool_call_id:
                        print(f"[WebSocket] Treating user message as response to ask_user ID: {agent.pending_ask_user_tool_call_id}")
                        # Add as TOOL message
                        agent.add_message_to_memory(
                            role="tool",
                            tool_call_id=agent.pending_ask_user_tool_call_id,
                            content=text
                        )
                        agent.pending_ask_user_tool_call_id = None # Clear the pending ID
                    else:
                        # Add as standard USER message
                        user_content: List[Dict[str, Any]] = [{"type": "text", "text": text}]
                        if screenshot_data_url:
                            user_content.append({
                                "type": "image_url",
                                "image_url": {"url": screenshot_data_url}
                            })
                        agent.add_message_to_memory(role="user", content=user_content)
                    # --- End message adding logic ---
                    
                    # --- Run the agent step --- 
                    await run_agent_step_and_send(agent, websocket)
                        
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
                    
                    # --- Run the agent step AGAIN with the new tool results in memory --- 
                    print("[WebSocket] Triggering agent step after receiving tool results...")
                    await run_agent_step_and_send(agent, websocket)
                    
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

@app.get("/") # Basic root endpoint for testing
async def read_root():
    return {"message": "FastAPI backend is running (WebSocket at /ws)"}

# To run this: 
# cd backend
# (Activate venv)
# pip install -r requirements.txt
# uvicorn main:app --reload 