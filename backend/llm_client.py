import json
import asyncio
from typing import List, Dict, Any, AsyncGenerator, Union

# Import necessary OpenAI types
from openai import AsyncOpenAI, APIError # Import APIError for specific exception handling if needed
from openai.types.chat import ChatCompletionChunk

# Import tool schemas to be used
from tools import TOOL_SCHEMAS 

async def get_llm_response_stream(
    client: AsyncOpenAI, 
    model_name: str, 
    messages: List[Dict[str, Any]],
    temperature: float = 0.7 # Optional: Add temperature or other parameters
) -> AsyncGenerator[Union[ChatCompletionChunk, Dict[str, str]], None]:
    """Calls the OpenAI API and streams back the response chunks or an error dict."""
    
    print(f"[LLM Client] Requesting completion from {model_name}...")
    # Debug log only the last few messages if history is long?
    # print(f"[LLM Client DEBUG] Sending messages: \n{json.dumps(messages[-5:], indent=2)}") 
    
    try:
        stream = await client.chat.completions.create(
            model=model_name,
            messages=messages,
            tools=TOOL_SCHEMAS, # Use imported schemas
            tool_choice="auto", 
            parallel_tool_calls=False, # Keep single tool call restriction
            temperature=temperature,
            stream=True
        )
        async for chunk in stream:
            yield chunk
            
    except APIError as e:
        print(f"[LLM Client Error] OpenAI API Error: {e.status_code} - {e.message}")
        yield {"type": "error", "content": f"OpenAI API Error: {e.message}"}
    except Exception as e:
        print(f"[LLM Client Error] Error during LLM stream request: {e}")
        import traceback
        traceback.print_exc() # Print full traceback for unexpected errors
        yield {"type": "error", "content": f"LLM Call Error: {e}"} 