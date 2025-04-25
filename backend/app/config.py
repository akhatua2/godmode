import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Database configuration
DATABASE_URL = "./nohup.db"

# API Keys
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# LLM Configuration
DEFAULT_MODEL = "gpt-4.1-mini"
PLANNER_MODEL = "o3-mini"

# Browser Configuration
CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'  # macOS path

# WebSocket Configuration
WS_HOST = "localhost"
WS_PORT = 8000
WS_ENDPOINT = "/ws" 