import os
import json
import asyncio
import litellm
from typing import List, Dict, Any, AsyncGenerator, Union, Optional, Callable, Tuple
from openai.types.chat import ChatCompletionChunk
from dotenv import load_dotenv
from core.tools.base import TOOL_SCHEMAS

# Load environment variables
load_dotenv()

async def get_llm_response_stream(
    model_name: str,
    messages: List[Dict[str, Any]],
    temperature: float = 0.7,
    max_tokens: Optional[int] = None,
    api_keys: Optional[Dict[str, str]] = None
) -> AsyncGenerator[ChatCompletionChunk | Dict[str, str] | Tuple[str, float], None]:
    """Gets a streaming response from LiteLLM, yielding chunks or error dicts."""
    stream_kwargs = {
        "model": model_name,
        "messages": messages,
        "temperature": temperature,
        "stream": True,
        "stream_options": {"include_usage": True}, # Request usage data in the stream
    }
    if max_tokens:
        stream_kwargs["max_tokens"] = max_tokens
    
    # --- Determine the specific API key to use for this call --- # ADDED
    session_api_key: Optional[str] = None # ADDED
    if api_keys: # ADDED
        # Basic provider detection from model name
        if "gpt-" in model_name or model_name.startswith("openai/"): # ADDED
            session_api_key = api_keys.get("openai") # ADDED
        elif "claude-" in model_name or model_name.startswith("anthropic/"): # ADDED
            session_api_key = api_keys.get("anthropic") # ADDED
        elif "groq/" in model_name: # ADDED
             session_api_key = api_keys.get("groq") # ADDED
        # Add more providers as needed... # ADDED
        
        if session_api_key: # ADDED
            print(f"[LLM Client] Using session API key for {model_name.split('/')[0] if '/' in model_name else 'provider'}.") # ADDED
    # --- End API Key Determination --- # ADDED
    
    print(f"[LLM Client - LiteLLM] Requesting completion from {model_name}...")
    
    # Determine provider name for error messages BEFORE the try block
    llm_provider_name = model_name.split('/')[0] if '/' in model_name else model_name # MOVED here
    
    try:
        api_base = None
        if model_name.startswith("ollama/"):
            api_base = "http://localhost:11434" 
            print(f"[LLM Client - LiteLLM] Using Ollama model, setting api_base: {api_base}")
        # Use litellm.acompletion for asynchronous streaming
        stream_object = await litellm.acompletion(
            tools=TOOL_SCHEMAS,
            tool_choice="auto",
            api_base=api_base,
            api_key=session_api_key,
            **stream_kwargs
        )
        # Iterate through the stream yielded by LiteLLM
        finish_reason = None
        error_yielded = False # Flag to track if an error dict was yielded
        captured_finish_reason = None # Explicitly capture finish_reason within the loop
        extracted_cost = None # Variable to store cost yielded by llm_client
        captured_prompt_tokens = None
        captured_completion_tokens = None

        # Initialize calculated_cost outside the loop, before finally
        calculated_cost = 0.0 
        response_content = "" # Initialize response_content
        # llm_provider_name = model_name.split('/')[0] if '/' in model_name else model_name # REMOVED from here

        async for chunk in stream_object:
            # Assume it's a ChatCompletionChunk if not an error dict
            
            # --- Capture Usage from Chunk --- 
            # LiteLLM seems to put usage info in the final chunk object
            if hasattr(chunk, 'usage') and chunk.usage: 
                if chunk.usage.prompt_tokens is not None:
                    captured_prompt_tokens = chunk.usage.prompt_tokens
                if chunk.usage.completion_tokens is not None:
                    captured_completion_tokens = chunk.usage.completion_tokens
                # Optional: Log when usage is captured
                # print(f"[LLM Client DEBUG] Captured usage from chunk: P={captured_prompt_tokens}, C={captured_completion_tokens}")
            # --- End Usage Capture ---
            
            # --- Start Debug Logging --- 
            print(f"[LLM Client DEBUG] Raw Chunk: {chunk.model_dump_json(indent=2)}")
            # --- End Debug Logging --- 
            
            yield chunk 
            
        # --- Post-Stream Cost Calculation using token_counter --- 
        try:
            # Calculate tokens using litellm.token_counter after stream completion
            prompt_tokens_calculated = litellm.token_counter(model=model_name, messages=messages)
            completion_tokens_calculated = litellm.token_counter(model=model_name, text=response_content) if response_content else 0
            print(f"[LLM Client] Tokens calculated via token_counter: P={prompt_tokens_calculated}, C={completion_tokens_calculated}")
            
            # Calculate cost using these token counts
            input_cost, output_cost = litellm.cost_per_token(
                model=model_name, 
                prompt_tokens=prompt_tokens_calculated, 
                completion_tokens=completion_tokens_calculated
            )
            manual_cost = input_cost + output_cost
            print(f"[LLM Client] Calculated cost via token_counter: ${manual_cost:.6f}")
            calculated_cost = manual_cost # Assign the calculated cost
            
        except Exception as cost_calc_e:
            print(f"[LLM Client Warning] Failed to calculate cost via token_counter: {cost_calc_e}")
            calculated_cost = 0.0 # Default to 0 if calculation fails
        # --- End Post-Stream Cost Calculation ---

    except litellm.AuthenticationError as auth_error: # ADDED: Specific handler for Auth errors
        print(f"[LLM Client Error - LiteLLM] Authentication Error for {llm_provider_name}: {auth_error}") # ADDED
        yield {"type": "error", "content": f"Authentication failed for {llm_provider_name}. Please set a valid API key in Settings."} # ADDED User-friendly message
        error_yielded = True # Mark that we yielded an error
    except Exception as e:
        # Catch potential LiteLLM specific errors or general errors
        print(f"[LLM Client Error - LiteLLM] Error during LLM stream request: {e}")
        import traceback
        traceback.print_exc()
        yield {"type": "error", "content": f"LLM Call Error: {e}"} # RESTORED yield for general errors
        error_yielded = True # Mark that we yielded an error
    finally:
        # Yield the final cost (or None) in a tuple after everything
        # Using a specific type identifier in the tuple
        # Ensure calculated_cost exists even if stream fails before calculation
        final_cost = calculated_cost if 'calculated_cost' in locals() else 0.0
        yield ("final_cost", final_cost) 