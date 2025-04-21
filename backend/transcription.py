import litellm
import base64
import aiofiles
import uuid
import os
import io
from fastapi import HTTPException

async def get_transcription(audio_base64: str, file_format: str = "webm") -> str:
    """
    Transcribes audio using LiteLLM's atranscription.

    Args:
        audio_base64: Base64 encoded string of the audio data.
        file_format: The format of the audio file (e.g., 'webm', 'mp3', 'wav').

    Returns:
        The transcribed text.
        
    Raises:
        HTTPException: If transcription fails.
    """
    print("[Transcription Service] Received audio data for transcription.")
    
    temp_dir = "temp_audio"
    os.makedirs(temp_dir, exist_ok=True)
    
    temp_filename = f"{uuid.uuid4()}.{file_format}"
    temp_filepath = os.path.join(temp_dir, temp_filename)

    try:
        try:
            # Remove potential data URL prefix if present
            if ";base64," in audio_base64:
                header, encoded = audio_base64.split(";base64,", 1)
            else:
                encoded = audio_base64
            
            audio_bytes = base64.b64decode(encoded)
            print(f"[Transcription Service] Decoded base64 audio ({len(audio_bytes)} bytes).")
        except (base64.binascii.Error, ValueError, TypeError) as decode_err:
            print(f"[Transcription Service Error] Failed to decode base64 audio: {decode_err}")
            raise HTTPException(status_code=400, detail=f"Invalid base64 audio data: {decode_err}")

        async with aiofiles.open(temp_filepath, "wb") as temp_file:
            await temp_file.write(audio_bytes)
        print(f"[Transcription Service] Saved temporary audio file: {temp_filepath}")

        try:
             async with aiofiles.open(temp_filepath, "rb") as audio_file_object:
                print(f"[Transcription Service] Calling LiteLLM with file object...")
                # Note: LiteLLM might expect the file object directly, 
                # or sometimes specific attributes like name. Check LiteLLM docs if issues arise.
                response = await litellm.atranscription(
                    model="whisper-1", 
                    file=audio_file_object
                )
                # Response structure might vary, adjust as needed. Often it's response.text
                if hasattr(response, 'text'):
                    transcribed_text = response.text
                elif isinstance(response, dict) and 'text' in response:
                     transcribed_text = response['text']
                else:
                    # Fallback or raise error if structure unknown
                    transcribed_text = str(response) 
                    print("[Transcription Service Warning] Unexpected response structure from litellm.atranscription")

                print(f"[Transcription Service] Transcription successful: {transcribed_text[:100]}...")
                return transcribed_text
        except Exception as transcription_err:
            print(f"[Transcription Service Error] LiteLLM transcription failed: {transcription_err}")
            import traceback
            traceback.print_exc()
            # Re-raise as HTTPException for FastAPI handling
            raise HTTPException(status_code=500, detail=f"Transcription failed: {transcription_err}")

    finally:
        if os.path.exists(temp_filepath):
            try:
                os.remove(temp_filepath)
                print(f"[Transcription Service] Cleaned up temporary file: {temp_filepath}")
            except OSError as cleanup_err:
                print(f"[Transcription Service Warning] Failed to delete temporary file {temp_filepath}: {cleanup_err}")
