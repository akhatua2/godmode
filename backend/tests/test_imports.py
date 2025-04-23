"""
Test script to verify imports in the new structure.
Run this script to check if all imports are working correctly.
"""

def test_imports():
    try:
        # Test app imports
        from app.config import DATABASE_URL
        from app.websocket.handler import run_agent_step_and_send
        print("✅ App imports successful")

        # Test core imports
        from core.agent.agent import ChatAgent
        from core.tools.base import SERVER_EXECUTABLE_TOOLS
        print("✅ Core imports successful")

        # Test db imports
        from db.operations import init_db, save_message_to_db
        print("✅ Database imports successful")

        # Test services imports
        from services.transcription import get_transcription
        from services.llm import ChatOpenAI
        print("✅ Services imports successful")

        print("\nAll imports successful! ✨")
        return True

    except ImportError as e:
        print(f"\n❌ Import Error: {e}")
        return False

if __name__ == "__main__":
    test_imports() 