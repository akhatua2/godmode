from setuptools import setup, find_packages

setup(
    name="laptop_llm_backend",
    version="0.1.0",
    packages=find_packages(),
    install_requires=[
        "fastapi",
        "uvicorn",
        "python-dotenv",
        "aiosqlite",
        "tavily-python",
        "langchain-openai",
        "browser-use",
    ],
) 