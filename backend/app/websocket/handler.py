"""WebSocket handler for agent interactions."""

import os
import json
import traceback
import asyncio
import uuid
from fastapi import WebSocket, HTTPException
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
    pending_questions: Dict[str, Dict[str, asyncio.Future]],
    api_keys: Optional[Dict[str, str]] = None,
    connection_state: Optional[Dict[str, Any]] = None  # Add connection state parameter
) -> Tuple[bool, Optional[float]]:
    """Run one step of agent interaction and send results via websocket.
    Returns (finished_turn: bool, cost: Optional[float])
    """
    stream_ended = False
    final_cost_from_agent = None
    
    try:
        async for item in agent.step(api_keys=api_keys, connection_state=connection_state):
            # Check for stop signal
            if connection_state and connection_state.get("stop_requested"):
                print("[WebSocket] Stop requested, ending agent step")
                # If there are any tool calls in the last assistant message, add cancellation responses
                for msg in reversed(agent.memory):
                    if msg.get("role") == "assistant" and msg.get("tool_calls"):
                        for tool_call in msg["tool_calls"]:
                            tool_id = tool_call["id"]
                            # Only add cancellation response if there isn't already a response for this tool
                            if not any(m.get("tool_call_id") == tool_id for m in agent.memory if m.get("role") == "tool"):
                                cancellation_content = f"Tool execution cancelled: Operation interrupted by user"
                                agent.add_message_to_memory(
                                    role="tool",
                                    content=cancellation_content,
                                    tool_call_id=tool_id
                                )
                        break  # Only handle the most recent assistant message
                
                await websocket.send_text(json.dumps({
                    "type": "info",
                    "content": "Operation stopped by user request."
                }))
                await websocket.send_text(json.dumps({"type": "end", "content": ""}))
                return True, final_cost_from_agent

            if isinstance(item, tuple) and item[0] == "final_cost":
                final_cost_from_agent = item[1]
                print(f"[run_agent_step_and_send] Captured final_cost: {final_cost_from_agent}")
                continue

            if isinstance(item, str):
                await websocket.send_text(json.dumps({"type": "chunk", "content": item}))
            elif isinstance(item, dict):
                if item.get("type") == "tool_call_request":
                    tool_calls = item.get("tool_calls", [])
                    if not tool_calls:
                        print("[WebSocket WARNING] Received tool_call_request with no tool_calls")
                        await websocket.send_text(json.dumps({"type": "error", "content": "Agent requested tool call but sent no tools."}))
                        stream_ended = True
                        break

                    # Track all pending tool calls
                    pending_tool_calls: Dict[str, Dict] = {}
                    server_tool_calls: List[Dict] = []
                    client_tool_calls: List[Dict] = []

                    # Categorize tool calls
                    for tool_call in tool_calls:
                        tool_name = tool_call.get("function", {}).get("name")
                        call_id = tool_call["id"]
                        
                        if tool_name in SERVER_EXECUTABLE_TOOLS:
                            server_tool_calls.append(tool_call)
                        elif tool_name in ["run_bash_command", "read_file", "edit_file", "paste_at_cursor"]:
                            client_tool_calls.append(tool_call)
                            pending_tool_calls[call_id] = tool_call
                        elif tool_name == "ask_user":
                            if call_id:
                                agent.pending_ask_user_tool_call_id = call_id
                                print(f"[WebSocket] Stored pending ask_user ID: {call_id}")
                            question = json.loads(tool_call["function"]["arguments"]).get("question", "")
                            await websocket.send_text(json.dumps({"type": "ask_user_request", "question": question}))
                            stream_ended = True
                            return True, final_cost_from_agent
                        elif tool_name == "terminate":
                            reason = json.loads(tool_call["function"]["arguments"]).get("reason", "Task finished.")
                            await websocket.send_text(json.dumps({"type": "terminate_request", "reason": reason}))
                            stream_ended = True
                            return True, final_cost_from_agent
                        else:
                            print(f"[WebSocket WARNING] Unknown tool requested: {tool_name}")
                            continue

                    # Handle server-side tools first
                    for tool_call in server_tool_calls:
                        tool_name = tool_call["function"]["name"]
                        tool_call_id = tool_call["id"]
                        arguments = tool_call["function"]["arguments"]
                        
                        try:
                            parsed_args = json.loads(arguments)
                            server_function = SERVER_EXECUTABLE_TOOLS[tool_name]
                            
                            if server_function is execute_browser_task:
                                task_arg = parsed_args.get('task')
                                if task_arg:
                                    result_content = await execute_browser_task(
                                        task=task_arg,
                                        websocket=websocket,
                                        websocket_id=str(websocket.client),
                                        pending_questions_dict=pending_questions
                                    )
                                else:
                                    result_content = "Error: Missing 'task' argument for browser_user tool."
                            else:
                                result_content = await server_function(**parsed_args)
                                
                            agent.add_message_to_memory(
                                role="tool",
                                tool_call_id=tool_call_id,
                                content=result_content
                            )
                        except Exception as e:
                            print(f"[WebSocket Error] Server tool execution failed: {e}")
                            traceback.print_exc()
                            agent.add_message_to_memory(
                                role="tool",
                                tool_call_id=tool_call_id,
                                content=f"Error executing tool {tool_name}: {str(e)}"
                            )

                    # Send client-side tool calls if any
                    if client_tool_calls:
                        # Add tool calls to tracking set
                        if connection_state:
                            connection_state["current_tool_calls"].update(call["id"] for call in client_tool_calls)
                        
                        await websocket.send_text(json.dumps({
                            "type": "tool_call_request",
                            "tool_calls": client_tool_calls
                        }))
                        
                        # Wait for all client tool responses or stop signal
                        while pending_tool_calls:
                            try:
                                # Check for stop signal before waiting for response
                                if connection_state and connection_state.get("stop_requested"):
                                    print("[WebSocket] Stop requested while waiting for tool results")
                                    # Only add cancellation responses for tool calls that haven't received responses yet
                                    for tool_id, tool_call in pending_tool_calls.items():
                                        # Skip if this tool call already has a response in agent memory
                                        if any(m.get("tool_call_id") == tool_id for m in agent.memory if m.get("role") == "tool"):
                                            print(f"[WebSocket] Tool {tool_id} already has response, skipping cancellation")
                                            continue
                                            
                                        print(f"[WebSocket] Adding cancellation response for tool {tool_id}")
                                        cancellation_content = f"Tool execution cancelled: Operation interrupted by user"
                                        # Add to agent memory
                                        agent.add_message_to_memory(
                                            role="tool",
                                            content=cancellation_content,
                                            tool_call_id=tool_id
                                        )
                                        # Save to database
                                        chat_id = connection_state.get("chat_id")
                                        if chat_id:
                                            from main import save_message_to_db  # Import at use to avoid circular imports
                                            await save_message_to_db(
                                                chat_id=chat_id,
                                                role="tool",
                                                content=cancellation_content,
                                                tool_call_id=tool_id
                                            )
                                        # Remove from tracking
                                        if connection_state:
                                            connection_state["current_tool_calls"].discard(tool_id)
                                    pending_tool_calls.clear()  # Clear after handling all pending calls
                                    
                                    await websocket.send_text(json.dumps({"type": "info", "content": "Tool execution interrupted by user request."}))
                                    await websocket.send_text(json.dumps({"type": "end", "content": ""}))
                                    return True, final_cost_from_agent

                                response = await websocket.receive_text()
                                response_data = json.loads(response)
                                
                                if response_data.get("type") == "tool_result":
                                    results = response_data.get("results", [])
                                    for result in results:
                                        tool_call_id = result.get("tool_call_id")
                                        if tool_call_id in pending_tool_calls:
                                            content = str(result.get("content", ""))
                                            agent.add_message_to_memory(
                                                role="tool",
                                                content=content,
                                                tool_call_id=tool_call_id
                                            )
                                            del pending_tool_calls[tool_call_id]
                                            # Remove from tracking set
                                            if connection_state:
                                                connection_state["current_tool_calls"].discard(tool_call_id)
                                            # If this was a denial, trigger next agent step
                                            if "User denied execution" in content:
                                                print("[WebSocket] Tool execution denied, triggering next agent step")
                                                agent_finished, cost_from_nested = await run_agent_step_and_send(
                                                    agent, websocket, pending_questions, 
                                                    api_keys=api_keys,
                                                    connection_state=connection_state
                                                )
                                                return agent_finished, final_cost_from_agent if final_cost_from_agent is not None else cost_from_nested
                            except Exception as e:
                                print(f"Error processing tool response: {e}")
                                # Clean up tracking on error
                                if connection_state:
                                    for tool_id in pending_tool_calls:
                                        connection_state["current_tool_calls"].discard(tool_id)
                                break

                    # If we had server tools, trigger next step
                    if server_tool_calls:
                        print("[WebSocket] Triggering next agent step after server tool execution...")
                        agent_finished, cost_from_nested = await run_agent_step_and_send(
                            agent, websocket, pending_questions, 
                            api_keys=api_keys,
                            connection_state=connection_state
                        )
                        return agent_finished, final_cost_from_agent if final_cost_from_agent is not None else cost_from_nested

                    # If we only had client tools and they're all done, trigger next step
                    if not server_tool_calls and not pending_tool_calls:
                        print("[WebSocket] All client tools finished, triggering next agent step...")
                        agent_finished, cost_from_nested = await run_agent_step_and_send(
                            agent, websocket, pending_questions, 
                            api_keys=api_keys,
                            connection_state=connection_state
                        )
                        return agent_finished, final_cost_from_agent if final_cost_from_agent is not None else cost_from_nested

                elif item.get("type") == "error":
                    await websocket.send_text(json.dumps(item))
                    stream_ended = True
                    break

        if not stream_ended:
            await websocket.send_text(json.dumps({"type": "end", "content": ""}))
            print("WebSocket sent stream end signal (agent step finished naturally).")
            return True, final_cost_from_agent
        else:
            print("WebSocket stream ended due to break, not sending duplicate 'end'.")
            return True, final_cost_from_agent

    except Exception as e:
        print(f"Error during agent step execution or sending: {e}")
        traceback.print_exc()
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "content": f"Error during agent processing: {str(e)}"
            }))
        except Exception:
            pass
        return False, final_cost_from_agent

async def process_agent_response(self, agent: ChatAgent, connection_state: Dict) -> None:
    """Process agent's response stream and handle tool calls."""
    try:
        async for response in agent.step(api_keys=self.api_keys, connection_state=connection_state):
            # Check for stop signal at the start of each iteration
            if connection_state.get("stop_requested"):
                print("[WebSocket] Stop requested during agent processing")
                # Send stop acknowledgment
                await self.send_message({
                    "type": "info",
                    "content": "Operation stopped by user request."
                })
                await self.send_message({
                    "type": "end",
                    "content": ""
                })
                break

            if isinstance(response, str):
                # Handle content chunks
                await self.send_message({
                    "type": "content",
                    "content": response
                })
            elif isinstance(response, dict):
                # Handle tool calls
                if response.get("type") == "tool_call":
                    tool_call = response["tool_call"]
                    tool_id = tool_call["id"]
                    
                    # Check for stop signal before executing tool
                    if connection_state.get("stop_requested"):
                        print("[WebSocket] Stop requested before tool execution")
                        # Send stop acknowledgment
                        await self.send_message({
                            "type": "info",
                            "content": "Operation stopped by user request."
                        })
                        await self.send_message({
                            "type": "end",
                            "content": ""
                        })
                        break
                        
                    # Execute tool and get result
                    tool_result = await self.execute_tool(tool_call)
                    
                    # Check for stop signal after tool execution
                    if connection_state.get("stop_requested"):
                        print("[WebSocket] Stop requested after tool execution")
                        # Send stop acknowledgment
                        await self.send_message({
                            "type": "info",
                            "content": "Operation stopped by user request."
                        })
                        await self.send_message({
                            "type": "end",
                            "content": ""
                        })
                        break
                        
                    # Add tool result to agent's memory
                    agent.add_message({
                        "role": "tool",
                        "tool_call_id": tool_id,
                        "name": tool_call["name"],
                        "content": tool_result
                    })
                    
                    # Send tool result to client
                    await self.send_message({
                        "type": "tool_result",
                        "tool_call_id": tool_id,
                        "result": tool_result
                    })
                    
                    # Continue processing with updated memory
                    continue
                elif isinstance(response, tuple) and response[0] == "final_cost":
                    # Handle cost information
                    await self.send_message({
                        "type": "cost",
                        "cost": response[1]
                    })
            
        # Send end message if we haven't already (i.e., if we didn't break due to stop)
        if not connection_state.get("stop_requested"):
            await self.send_message({
                "type": "end",
                "content": ""
            })
            
    except Exception as e:
        print(f"[WebSocket] Error processing agent response: {str(e)}")
        await self.send_message({
            "type": "error",
            "error": str(e)
        })