"""Memory-related tools for storing and retrieving contextual information about users."""

import chromadb
import datetime
from chromadb.utils import embedding_functions
import os
from pathlib import Path
from typing import List
import json

# Initialize ChromaDB client
PERSIST_DIRECTORY = Path(__file__).parent.parent.parent / "data" / "memory_store"
os.makedirs(PERSIST_DIRECTORY, exist_ok=True)

client = chromadb.PersistentClient(path=str(PERSIST_DIRECTORY))
# Use OpenAI's embedding function
embedding_fn = embedding_functions.OpenAIEmbeddingFunction(
    api_key=os.getenv("OPENAI_API_KEY"),
    model_name="text-embedding-3-small"
)

# Create or get the collection
try:
    collection = client.get_collection("user_memories", embedding_function=embedding_fn)
except:
    collection = client.create_collection("user_memories", embedding_function=embedding_fn)

def _check_for_similar_memory(fact: str, similarity_threshold: float = 0.95) -> str | None:
    """Check if a very similar memory already exists.
    
    Args:
        fact: The fact to check for similarity.
        similarity_threshold: Threshold for considering memories as duplicates (default: 0.95).
        
    Returns:
        The ID of the similar memory if found, None otherwise.
    """
    try:
        results = collection.query(
            query_texts=[fact],
            n_results=1
        )
        
        if not results['documents'][0]:
            return None
            
        # If we have a result, check if it's very similar
        # For now, we'll use exact matching, but this could be enhanced with
        # better similarity metrics or fuzzy matching
        if results['documents'][0][0].lower().strip() == fact.lower().strip():
            return results['ids'][0][0]
        
        return None
    except Exception as e:
        print(f"[Memory Tool Error] Failed to check for similar memory: {e}")
        return None

async def add_to_memory(facts: List[str]) -> str:
    """Stores a list of atomic facts in the vector database with current timestamp.
    Checks for and removes very similar existing memories before adding new ones.

    Args:
        facts: List of atomic facts to be stored as memories.

    Returns:
        A confirmation message.
    """
    try:
        timestamp = datetime.datetime.now().isoformat()
        added_facts = []
        updated_facts = []
        
        for fact in facts:
            # Check for similar existing memory
            similar_memory_id = _check_for_similar_memory(fact)
            
            if similar_memory_id:
                # Remove the old memory
                collection.delete(ids=[similar_memory_id])
                updated_facts.append(fact)
            
            # Add the new memory
            collection.add(
                documents=[fact],
                metadatas=[{"timestamp": timestamp}],
                ids=[f"memory_{timestamp}_{len(added_facts)}"]
            )
            added_facts.append(fact)
        
        print(f"[Memory Tool] Stored {len(added_facts)} facts, updated {len(updated_facts)} existing memories")
        
        result = f"Successfully stored {len(added_facts)} memories with timestamp {timestamp}"
        if updated_facts:
            result += f"\nUpdated {len(updated_facts)} existing memories"
        return result
    except Exception as e:
        print(f"[Memory Tool Error] Failed to store memories: {e}")
        return f"Error storing memories: {e}"

async def fetch_from_memory(query: str, n_results: int = 3) -> str:
    """Retrieves relevant memories based on the query.

    Args:
        query: The search query to find relevant memories.
        n_results: Number of memories to retrieve (default: 3).

    Returns:
        A formatted string containing the relevant memories with their timestamps.
    """
    try:
        # Query the collection
        results = collection.query(
            query_texts=[query],
            n_results=n_results
        )
        
        if not results['documents'][0]:
            return "No relevant memories found."
            
        # Format results
        memories = []
        for doc, metadata in zip(results['documents'][0], results['metadatas'][0]):
            timestamp = datetime.datetime.fromisoformat(metadata['timestamp']).strftime('%Y-%m-%d %H:%M:%S')
            memories.append(f"[{timestamp}] {doc}")
            
        return "Retrieved memories:\n" + "\n\n".join(memories)
    except Exception as e:
        print(f"[Memory Tool Error] Failed to retrieve memories: {e}")
        return f"Error retrieving memories: {e}"

# --- Tool Schemas ---
ADD_TO_MEMORY_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "add_to_memory",
        "description": "Store a list of atomic facts about the user or context in long-term memory. Break down complex information into simple, atomic facts before storing.",
        "parameters": {
            "type": "object",
            "properties": {
                "facts": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    },
                    "description": "List of atomic facts to store. Each fact should be a simple, clear statement about a single piece of information.",
                },
            },
            "required": ["facts"],
        },
    }
}

FETCH_FROM_MEMORY_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "fetch_from_memory",
        "description": "Retrieve relevant memories about the user or context. Use this when you need to recall previous interactions or important information about the user.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query to find relevant memories.",
                },
                "n_results": {
                    "type": "integer",
                    "description": "(Optional) Number of memories to retrieve (default: 3).",
                },
            },
            "required": ["query"],
        },
    }
} 