FROM python:3.12-slim

# Keep Python output visible in Docker logs.
ENV PYTHONUNBUFFERED=1

# Define the application's working directory.
WORKDIR /app

# Install dependencies separately to improve Docker build caching.
COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

# Copy the FastAPI application into the container.
COPY app ./app

# Document the port used by the application.
EXPOSE 8000

# Run FastAPI and make it reachable within Docker's network.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]