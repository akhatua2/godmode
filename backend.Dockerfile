FROM python:3.12-slim

WORKDIR /app

# Copy requirements first to leverage Docker cache
COPY ./requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy the backend directory
COPY ./backend /app/backend/

# Install the backend package in development mode
WORKDIR /app/backend
RUN pip install -e .

# App listening on the below port
EXPOSE 8000

# Run the application
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]