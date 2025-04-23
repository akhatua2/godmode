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
    api_keys: Optional[Dict[str, str]] = None
) -> Tuple[bool, Optional[float]]:
    """Run one step of agent interaction and send results via websocket.
    Returns (finished_turn: bool, cost: Optional[float])
    """
    stream_ended = False
    final_cost_from_agent = None
    
    try:
        async for item in agent.step(api_keys=api_keys):
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
                        await websocket.send_text(json.dumps({
                            "type": "tool_call_request",
                            "tool_calls": client_tool_calls
                        }))
                        
                        # Wait for all client tool responses
                        while pending_tool_calls:
                            try:
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
                                            # If this was a denial, trigger next agent step
                                            if "User denied execution" in content:
                                                print("[WebSocket] Tool execution denied, triggering next agent step")
                                                agent_finished, cost_from_nested = await run_agent_step_and_send(
                                                    agent, websocket, pending_questions, api_keys=api_keys
                                                )
                                                return agent_finished, final_cost_from_agent if final_cost_from_agent is not None else cost_from_nested
                            except Exception as e:
                                print(f"Error processing tool response: {e}")
                                break

                    # If we had server tools, trigger next step
                    if server_tool_calls:
                        print("[WebSocket] Triggering next agent step after server tool execution...")
                        agent_finished, cost_from_nested = await run_agent_step_and_send(
                            agent, websocket, pending_questions, api_keys=api_keys
                        )
                        return agent_finished, final_cost_from_agent if final_cost_from_agent is not None else cost_from_nested

                    # If we only had client tools and they're all done, continue
                    if not server_tool_calls and not pending_tool_calls:
                        continue

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