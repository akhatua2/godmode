import uvicorn
from app.main import app

if __name__ == "__main__":
    print("Starting FastAPI server...")
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=True  # Enable auto-reload during development
    ) 