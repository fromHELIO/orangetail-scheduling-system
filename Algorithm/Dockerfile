# Python algorithm / FastAPI server
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
# 0.0.0.0 so the server is reachable from outside the container
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]
