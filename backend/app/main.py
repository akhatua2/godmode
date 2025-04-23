import os
import json
import traceback
import asyncio # Added for future handling
import base64 # Added
import aiofiles # Added
import uuid # Added
import datetime # Added for DB timestamps
import aiosqlite # ADDED
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from dotenv import load_dotenv
# Import from new locations
from core.agent.agent import ChatAgent
from db.operations import init_db, save_message_to_db, update_chat_metadata_in_db, update_chat_title_in_db, DATABASE_URL
from services.transcription import get_transcription
from app.websocket.handler import run_agent_step_and_send
from typing import List, Dict, Any, Callable, Tuple, Optional
# --- Import Server Tool Registry --- 
# --- End Import --- 
# --- Import Database Functions ---
# --- End DB Import ---
# --- Import Logic Functions ---
# --- End Import Logic Functions ---

# Load environment variables from .env file
load_dotenv()

# --- Global state for active connections ---
# Key: connection_key (e.g., str(websocket.client)), Value: Dict containing chat_id, agent, total_cost
ACTIVE_CONNECTIONS: Dict[str, Dict[str, Any]] = {}
# --- End Global State ---

app = FastAPI()

@app.on_event("startup")
async def startup_event():
    await init_db()

# --- Shared state for pending agent questions --- 
PENDING_AGENT_QUESTIONS: Dict[str, Dict[str, asyncio.Future]] = {}
# --- End Shared State ---

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("WebSocket connection establishing...")

    # --- Get chat_id and Validate --- 
    chat_id = websocket.query_params.get("chat_id")
    if not chat_id:
        print("WebSocket closing: chat_id missing from query parameters.")
        await websocket.send_text(json.dumps({"type": "error", "content": "chat_id query parameter is required."}))
        await websocket.close(code=1008)
        return
    try: # Validate chat_id format (e.g., UUID) if desired
        uuid.UUID(chat_id)
    except ValueError:
        print(f"WebSocket closing: Invalid chat_id format: {chat_id}")
        await websocket.send_text(json.dumps({"type": "error", "content": "Invalid chat_id format."}))
        await websocket.close(code=1008)
        return
    print(f"WebSocket attempting connection for chat_id: {chat_id}")
    # --- End get/validate chat_id --- 

    agent: ChatAgent
    session_total_cost: float
    connection_key = str(websocket.client) # Unique identifier for this specific connection

    # --- Load or Create Chat State from DB --- 
    try:
        async with aiosqlite.connect(DATABASE_URL) as db:
            db.row_factory = aiosqlite.Row # Access columns by name
            async with db.execute("SELECT * FROM chats WHERE chat_id = ?", (chat_id,)) as cursor:
                chat_data = await cursor.fetchone()

            now = datetime.datetime.now(datetime.timezone.utc)
            
            if chat_data:
                print(f"Loading existing chat: {chat_id}")
                session_total_cost = chat_data['total_cost'] or 0.0
                current_model = chat_data['current_model'] # Can be None
                agent = ChatAgent(model_name=current_model) # Initialize agent, optionally with stored model (FIXED)
                
                # Load history
                async with db.execute("SELECT role, content, tool_call_id FROM messages WHERE chat_id = ? ORDER BY timestamp ASC", (chat_id,)) as msg_cursor:
                    async for row in msg_cursor:
                        content = row['content']
                        # Attempt to parse content if it looks like JSON (for user/tool roles)
                        parsed_content: Any = content
                        if row['role'] in ["user", "tool"] or (row['role'] == 'assistant' and 'tool_calls' in content):
                             try:
                                 parsed_content = json.loads(content)
                             except json.JSONDecodeError:
                                 print(f"[DB Load Warning] Could not parse message content for chat {chat_id}, role {row['role']}. Treating as string.")
                                 # Keep content as string if parsing fails
                        
                        agent.add_message_to_memory(role=row['role'], content=parsed_content, tool_call_id=row['tool_call_id'])
                print(f"Loaded {len(agent.memory)} messages from history for chat {chat_id}")
                
                # Update last active time
                await db.execute("UPDATE chats SET last_active_at = ? WHERE chat_id = ?", (now, chat_id))
                await db.commit()
            
            else:
                print(f"Creating new chat: {chat_id}")
                agent = ChatAgent() # Create agent with default model
                session_total_cost = 0.0
                current_model = agent.model_name # Get default model (FIXED)
                
                await db.execute(
                    "INSERT INTO chats (chat_id, created_at, last_active_at, current_model, total_cost) VALUES (?, ?, ?, ?, ?)",
                    (chat_id, now, now, current_model, session_total_cost)
                )
                await db.commit()
                
        # Store in active connections
        ACTIVE_CONNECTIONS[connection_key] = {
            "chat_id": chat_id,
            "agent": agent,
            "total_cost": session_total_cost,
            "api_keys": {}, # ADDED: Initialize empty dict for session API keys
            "stop_requested": False, # Add stop signal flag
            "current_tool_calls": set() # Track active tool calls
        }
        print(f"WebSocket connection {connection_key} established for chat_id: {chat_id}")
        
    except Exception as db_error:
        print(f"[DB Error] Failed to load/create chat state for {chat_id}: {db_error}")
        traceback.print_exc()
        await websocket.send_text(json.dumps({"type": "error", "content": "Failed to initialize chat session."}))
        await websocket.close(code=1011)
        return
    # --- End Load or Create Chat State ---

    try:
        while True:
            # Receive message from Electron client
            data = await websocket.receive_text()
            connection_key = str(websocket.client)
            
            # --- Retrieve connection state --- 
            connection_state = ACTIVE_CONNECTIONS.get(connection_key)
            if not connection_state:
                print(f"[WebSocket Error] Received message from unknown connection: {connection_key}. Closing.")
                await websocket.close(code=1011)
                break # Exit the while loop
                
            agent = connection_state["agent"]
            chat_id = connection_state["chat_id"] # Get chat_id for logging
            current_total_cost = connection_state["total_cost"] # Get current cost
            # --- End retrieve state --- 
            
            print(f"WebSocket ({chat_id}) received: {data[:200]}...")
            try:
                message_data = json.loads(data)
                message_type = message_data.get("type")

                if message_type == "user_message":
                    # ... (logic for getting text, screenshot, context remains same)
                    text = message_data.get("text")
                    screenshot_data_url = message_data.get("screenshot_data_url")
                    context_text = message_data.get("context_text")
                    
                    if not text:
                        await websocket.send_text(json.dumps({"type": "error", "content": "Missing text in user_message"}))
                        continue
                    
                    print(f"[WebSocket ({chat_id})] Processing user_message: {text[:50]}...")
                    
                    # Check if this is the first message and set chat title
                    if len(agent.memory) == 0:
                        # Use first 50 chars of message as title, or up to first newline
                        title = text.split('\n')[0][:50]
                        if len(title) < len(text):
                            title += "..."
                        await update_chat_title_in_db(chat_id, title)
                        print(f"[WebSocket ({chat_id})] Set initial chat title: {title}")
                    
                    # ... (logic for adding message to agent memory remains same, using retrieved agent) ...
                    if agent.pending_ask_user_tool_call_id:
                        tool_call_id = agent.pending_ask_user_tool_call_id
                        agent.add_message_to_memory(role="tool", tool_call_id=tool_call_id, content=text)
                        await save_message_to_db(chat_id=chat_id, role="tool", content=text, tool_call_id=tool_call_id)
                        agent.pending_ask_user_tool_call_id = None
                    else:
                        # ... prepare user content ...
                        final_text_content = text
                        if context_text and context_text.strip(): 
                            final_text_content = f"Based on this context:\n```\n{context_text}\n```\n\n{text}"
                        user_content: List[Dict[str, Any]] = [{"type": "text", "text": final_text_content}]
                        if screenshot_data_url:
                            user_content.append({
                                "type": "image_url",
                                "image_url": {"url": screenshot_data_url}
                            })
                        agent.add_message_to_memory(role="user", content=user_content)
                        await save_message_to_db(chat_id=chat_id, role="user", content=user_content)
                    
                    # --- Run the agent step (using retrieved agent) --- 
                    api_keys_for_step = connection_state.get("api_keys", {}) # Get session keys
                    agent_finished_turn, step_cost = await run_agent_step_and_send(
                        agent, websocket, PENDING_AGENT_QUESTIONS, 
                        api_keys=api_keys_for_step, # Pass keys
                        connection_state=connection_state # Pass connection state
                    )
                    if step_cost is not None:
                        connection_state["total_cost"] += step_cost
                        new_total_cost = connection_state["total_cost"]
                        # --- Update DB --- 
                        await update_chat_metadata_in_db(chat_id, total_cost=new_total_cost)
                        # --- End DB Update --- 
                        print(f"[WebSocket ({chat_id})] LLM call cost: ${step_cost:.6f}, Session total: ${new_total_cost:.6f}")
                        await websocket.send_text(json.dumps({
                            "type": "cost_update",
                            "total_cost": new_total_cost
                        }))
                    else:
                        print(f"[WebSocket ({chat_id}) WARNING] Agent step finished but no cost was returned.")
                        
                elif message_type == "tool_result":
                    # ... (logic for getting results remains same) ...
                    results = message_data.get("results")
                    if not results or not isinstance(results, list): 
                        await websocket.send_text(json.dumps({"type": "error", "content": "Missing or invalid results in tool_result message"}))
                        continue
                        
                    print(f"[WebSocket ({chat_id})] Processing tool_result for {len(results)} tool(s)...")
                    
                    # Track which tool calls have been responded to
                    received_tool_call_ids = set()
                    expected_tool_call_ids = set()
                    
                    # Find the most recent assistant message with tool calls
                    for msg in reversed(agent.memory):
                        if msg.get("role") == "assistant" and msg.get("tool_calls"):
                            for tool_call in msg["tool_calls"]:
                                expected_tool_call_ids.add(tool_call["id"])
                            break
                    
                    # Add the received results to memory
                    for result in results:
                        tool_call_id = result.get("tool_call_id")
                        content = str(result.get("content", ""))
                        if tool_call_id:
                            agent.add_message_to_memory(role="tool", tool_call_id=tool_call_id, content=content)
                            await save_message_to_db(chat_id=chat_id, role="tool", content=content, tool_call_id=tool_call_id)
                            received_tool_call_ids.add(tool_call_id)
                        else:
                            print(f"[WebSocket ({chat_id}) WARNING] Received tool_result missing tool_call_id")
                    
                    # Check if we have all expected tool results
                    missing_tool_calls = expected_tool_call_ids - received_tool_call_ids
                    if missing_tool_calls:
                        print(f"[WebSocket ({chat_id})] Still waiting for tool results: {missing_tool_calls}")
                        continue  # Don't proceed with agent step until we have all results
                     
                    print(f"[WebSocket ({chat_id}) DEBUG] Agent memory AFTER adding tool results:")
                    print(json.dumps(agent.memory, indent=2))
                    
                    # --- Run agent step again (using retrieved agent) --- 
                    print(f"[WebSocket ({chat_id})] All tool results received. Triggering agent step...")
                    api_keys_for_step = connection_state.get("api_keys", {}) # Get session keys
                    agent_finished_turn, step_cost = await run_agent_step_and_send(
                        agent, websocket, PENDING_AGENT_QUESTIONS, 
                        api_keys=api_keys_for_step, # Pass keys
                        connection_state=connection_state # Pass connection state
                    )
                    if step_cost is not None:
                        connection_state["total_cost"] += step_cost
                        new_total_cost = connection_state["total_cost"]
                        # --- Update DB --- 
                        await update_chat_metadata_in_db(chat_id, total_cost=new_total_cost)
                        # --- End DB Update --- 
                        print(f"[WebSocket ({chat_id})] LLM call cost: ${step_cost:.6f}, Session total: ${new_total_cost:.6f}")
                        await websocket.send_text(json.dumps({
                            "type": "cost_update",
                            "total_cost": new_total_cost
                        }))
                    else:
                        print(f"[WebSocket ({chat_id}) WARNING] Agent step finished but no cost was returned.")
                    
                elif message_type == "user_response":
                    # ... (logic for getting request_id, answer remains same) ...
                    request_id = message_data.get("request_id")
                    answer = message_data.get("answer")
                    if not request_id or answer is None: 
                        await websocket.send_text(json.dumps({"type": "error", "content": "Missing request_id or answer in user_response"}))
                        continue

                    print(f"[WebSocket ({chat_id})] Processing user_response for request_id: {request_id}")
                    # --- Use connection_key for PENDING_AGENT_QUESTIONS --- 
                    future = PENDING_AGENT_QUESTIONS.get(connection_key, {}).get(request_id)

                    if future and not future.done():
                        print(f"[WebSocket ({chat_id})] Found pending future for {request_id}. Setting result.")
                        future.set_result(answer) 
                    elif future and future.done():
                        print(f"[WebSocket ({chat_id}) WARNING] Received user_response for already completed request_id: {request_id}")
                    else:
                        print(f"[WebSocket ({chat_id}) WARNING] Received user_response for unknown or expired request_id: {request_id} for connection {connection_key}")
                        await websocket.send_text(json.dumps({"type": "warning", "content": f"Received response for unknown or expired request ID {request_id}."}))
                    # --- End user_response handling --- 
                    
                elif message_type == "set_llm_model":
                    # ... (logic for getting model_name remains same) ...
                    model_name = message_data.get("model_name")
                    if model_name and isinstance(model_name, str):
                        print(f"[WebSocket ({chat_id})] Received request to set model to: {model_name}")
                        agent.set_model(model_name) # Use retrieved agent
                        # --- Update DB --- 
                        current_total_cost = connection_state["total_cost"] # Get current cost from connection state
                        await update_chat_metadata_in_db(chat_id, total_cost=current_total_cost, current_model=model_name)
                        # --- End DB Update --- 
                    else:
                        print(f"[WebSocket ({chat_id}) WARNING] Received invalid set_llm_model message: {message_data}")
                        await websocket.send_text(json.dumps({"type": "error", "content": "Invalid or missing model_name in set_llm_model message"}))
                
                # --- NEW: Handle set_api_keys --- 
                elif message_type == "set_api_keys":
                    keys_data = message_data.get("keys")
                    if isinstance(keys_data, dict):
                        print(f"[WebSocket ({chat_id})] Received request to set API keys.")
                        # Validate keys (basic validation)
                        validated_keys = {k: v for k, v in keys_data.items() if isinstance(k, str) and isinstance(v, str)}
                        connection_state["api_keys"] = validated_keys # Update the connection state
                        print(f"[WebSocket ({chat_id})] Updated API keys for session: {list(validated_keys.keys())}")
                        # Optional: Send confirmation back to client
                        await websocket.send_text(json.dumps({"type": "info", "content": f"API keys received for providers: {list(validated_keys.keys())}"}))
                    else:
                         print(f"[WebSocket ({chat_id}) WARNING] Received invalid set_api_keys message: {message_data}")
                         await websocket.send_text(json.dumps({"type": "error", "content": "Invalid or missing 'keys' dictionary in set_api_keys message"}))
                # --- End set_api_keys handling ---
                
                elif message_type == "audio_input":
                    # ... (logic for getting audio data, format remains same) ...
                    audio_data_base64 = message_data.get("audio_data")
                    audio_format = message_data.get("format", "webm")
                    if not audio_data_base64:
                        await websocket.send_text(json.dumps({"type": "error", "content": "Missing audio_data in audio_input message"}))
                        continue
                    
                    print(f"[WebSocket ({chat_id})] Processing audio_input (format: {audio_format})...")
                    # ... (transcription call and error handling remain same) ...
                    try:
                        transcription_text = await get_transcription(audio_data_base64, audio_format)
                        print(f"[WebSocket ({chat_id})] Transcription successful: '{transcription_text[:100]}...'")
                        await websocket.send_text(json.dumps({
                            "type": "transcription_result",
                            "text": transcription_text
                        }))
                        print(f"[WebSocket ({chat_id})] Sent transcription_result to client.")
                    except HTTPException as http_exc:
                        print(f"[WebSocket ({chat_id}) Error] Transcription HTTP Exception: {http_exc.detail}")
                        await websocket.send_text(json.dumps({"type": "error", "content": f"Transcription Error: {http_exc.detail}"}))
                    except Exception as trans_exc:
                        print(f"[WebSocket ({chat_id}) Error] Unexpected error during transcription processing: {trans_exc}")
                        traceback.print_exc()
                        await websocket.send_text(json.dumps({"type": "error", "content": f"Unexpected transcription error: {trans_exc}"}))
                
                elif message_type == "stop":
                    print(f"[WebSocket ({chat_id})] Received stop request")
                    connection_state["stop_requested"] = True
                    
                    # Send acknowledgment back to client
                    await websocket.send_text(json.dumps({"type": "info", "content": "Stop request received"}))
                    # Note: The actual stopping and tool cancellation will happen in the websocket handler
                    
                    # Reset the stop_requested flag after handling the stop request
                    connection_state["stop_requested"] = False
                    print(f"[WebSocket ({chat_id})] Reset stop_requested flag")
                
                else:
                    print(f"[WebSocket ({chat_id}) WARNING] Invalid message type received: {message_type}")
                    await websocket.send_text(json.dumps({"type": "error", "content": f"Invalid message type received: {message_type}"}))

            except json.JSONDecodeError:
                print(f"WebSocket ({chat_id}) received invalid JSON")
                await websocket.send_text(json.dumps({"type": "error", "content": "Invalid JSON received"}))
            except Exception as e:
                print(f"Error processing message via WebSocket ({chat_id}) (see traceback below):")
                traceback.print_exc() 
                error_message = str(e)
                await websocket.send_text(json.dumps({"type": "error", "content": f"Error processing request: {error_message}"}))

    except WebSocketDisconnect:
        print(f"WebSocket connection closed for {connection_key} (chat_id: {chat_id}).")
    except Exception as e:
        print(f"Unexpected WebSocket error for {connection_key} (chat_id: {chat_id}) (see traceback below):")
        traceback.print_exc()
        try:
            await websocket.send_text(json.dumps({"type": "error", "content": f"Unexpected WebSocket error"}))
            await websocket.close(code=1011)
        except RuntimeError:
            pass # Already closed
    finally:
        # --- Remove connection state --- 
        if connection_key in ACTIVE_CONNECTIONS:
            removed_chat_id = ACTIVE_CONNECTIONS[connection_key].get("chat_id", "unknown")
            del ACTIVE_CONNECTIONS[connection_key]
            print(f"Removed connection state for {connection_key} (chat_id: {removed_chat_id}). Active connections: {len(ACTIVE_CONNECTIONS)}")
        # --- End remove connection state ---

        # --- Cleanup agent questions for this connection (using connection_key) ---
        if connection_key in PENDING_AGENT_QUESTIONS: # Use connection_key matching ACTIVE_CONNECTIONS
            print(f"[WebSocket Cleanup] Cleaning up pending questions for connection {connection_key} on disconnect.")
            for request_id, future in PENDING_AGENT_QUESTIONS[connection_key].items():
                if not future.done():
                    future.cancel("WebSocket connection closed.")
            del PENDING_AGENT_QUESTIONS[connection_key]
        # --- End Cleanup ---

@app.get("/") # Basic root endpoint for testing
async def read_root():
    return {"message": "FastAPI backend is running (WebSocket at /ws)"}

# --- NEW: Endpoint to list existing chats --- 
@app.get("/chats")
async def list_chats():
    """Retrieves a list of chats from the database, ordered by last activity."""
    chats = []
    try:
        async with aiosqlite.connect(DATABASE_URL) as db:
            db.row_factory = aiosqlite.Row # Access columns by name
            async with db.execute(
                "SELECT chat_id, title, created_at, last_active_at, current_model, total_cost FROM chats ORDER BY last_active_at DESC"
            ) as cursor:
                async for row in cursor:
                    chats.append(dict(row)) # Convert Row object to dictionary
        return chats
    except Exception as e:
        print(f"[DB Error] Failed to list chats: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Failed to retrieve chat list.")
# --- End List Chats Endpoint ---

# To run this: 
# cd backend
# (Activate venv)
# pip install -r requirements.txt
# uvicorn main:app --reload 