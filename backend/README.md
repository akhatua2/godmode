# Laptop LLM Backend

A FastAPI-based backend for the Laptop LLM project.

## Setup

1. Create and activate a virtual environment (optional but recommended):
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Set up environment variables in a `.env` file:
```bash
OPENAI_API_KEY=your_key_here
TAVILY_API_KEY=your_key_here
```

## Running the Server

You can start the server in two ways:

1. Using the run script:
```bash
python run.py
```

2. Using uvicorn directly:
```bash
uvicorn app.main:app --reload
```

The server will start at http://127.0.0.1:8000

## API Endpoints

- `GET /` - Health check endpoint
- `GET /chats` - List all chats
- `WebSocket /ws` - Main WebSocket endpoint for chat interaction

## Development

The project structure is organized as follows:

```
backend/
├── app/              # Main application code
│   ├── main.py      # FastAPI application
│   └── websocket/   # WebSocket handling
├── core/            # Core business logic
│   ├── agent/      # Agent implementation
│   └── tools/      # Tools implementation
├── db/             # Database operations
├── services/       # External services
└── requirements.txt # Dependencies
``` 