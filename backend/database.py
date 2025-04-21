import aiosqlite
import datetime
import json
import traceback
from typing import Any, Optional

# --- Database Constants ---
DATABASE_URL = "./nohup.db"

# --- Database Initialization ---
async def init_db():
    async with aiosqlite.connect(DATABASE_URL) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS chats (
                chat_id TEXT PRIMARY KEY,
                title TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_active_at TIMESTAMP,
                current_model TEXT,
                total_cost REAL DEFAULT 0.0
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                message_id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id TEXT NOT NULL,
                role TEXT NOT NULL, 
                content TEXT NOT NULL, 
                tool_call_id TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
            )
        """)
        await db.commit()
    print("Database initialized.")

# --- Database Operations ---
async def save_message_to_db(chat_id: str, role: str, content: Any, tool_call_id: Optional[str] = None):
    """Helper function to save a message to the database."""
    content_str = json.dumps(content) if not isinstance(content, str) else content
    try:
        async with aiosqlite.connect(DATABASE_URL) as db:
            await db.execute(
                "INSERT INTO messages (chat_id, role, content, tool_call_id) VALUES (?, ?, ?, ?)",
                (chat_id, role, content_str, tool_call_id)
            )
            await db.commit()
    except Exception as e:
        print(f"[DB Error] Failed to save message for chat {chat_id}: {e}")
        traceback.print_exc()

async def update_chat_metadata_in_db(chat_id: str, total_cost: float, current_model: Optional[str] = None):
    """Helper function to update chat metadata (cost, model, last_active) in the database."""
    now = datetime.datetime.now(datetime.timezone.utc)
    try:
        async with aiosqlite.connect(DATABASE_URL) as db:
            if current_model is not None:
                 await db.execute(
                     "UPDATE chats SET total_cost = ?, current_model = ?, last_active_at = ? WHERE chat_id = ?",
                     (total_cost, current_model, now, chat_id)
                 )
            else: # Only update cost and timestamp if model isn't changing
                 await db.execute(
                     "UPDATE chats SET total_cost = ?, last_active_at = ? WHERE chat_id = ?",
                     (total_cost, now, chat_id)
                 )
            await db.commit()
    except Exception as e:
        print(f"[DB Error] Failed to update chat metadata for chat {chat_id}: {e}")
        traceback.print_exc() 