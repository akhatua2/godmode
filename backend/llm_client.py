import json
import asyncio
import litellm # Import LiteLLM
from typing import List, Dict, Any, AsyncGenerator, Union, Optional, Callable # Removed Tuple

# Import necessary OpenAI types
# Remove OpenAI client import
from openai.types.chat import ChatCompletionChunk # Keep for type hinting chunks if LiteLLM yields compatible objects

# Import tool schemas to be used
from tools import TOOL_SCHEMAS 

async def get_llm_response_stream(
    model_name: str, 
    messages: List[Dict[str, Any]],
    temperature: float = 0.7, # Optional: Add temperature or other parameters
) -> AsyncGenerator[Union[ChatCompletionChunk, Dict[str, str]], None]:
    """Calls the LLM API via LiteLLM and streams back the response chunks or an error dict."""
    
    print(f"[LLM Client - LiteLLM] Requesting completion from {model_name}...")
    
    try:
        api_base = None
        if model_name.startswith("ollama/"):
            api_base = "http://localhost:11434" 
            print(f"[LLM Client - LiteLLM] Using Ollama model, setting api_base: {api_base}")
        # Use litellm.acompletion for asynchronous streaming
        stream_object = await litellm.acompletion(
            model=model_name,
            messages=messages,
            tools=TOOL_SCHEMAS,
            tool_choice="auto",
            # parallel_tool_calls=False, # LiteLLM might handle this differently or not support it directly
            temperature=temperature,
            stream=True,
            api_base=api_base
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

    except Exception as e:
        # Catch potential LiteLLM specific errors or general errors
        print(f"[LLM Client Error - LiteLLM] Error during LLM stream request: {e}")
        import traceback
        traceback.print_exc()
        yield {"type": "error", "content": f"LLM Call Error: {e}"}
    finally:
        # Yield the final cost (or None) in a tuple after everything
        # Using a specific type identifier in the tuple
        # Ensure calculated_cost exists even if stream fails before calculation
        final_cost = calculated_cost if 'calculated_cost' in locals() else 0.0
        yield ("final_cost", final_cost) 