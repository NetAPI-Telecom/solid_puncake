FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
# Frontend is mounted as a volume at /app/frontend by docker-compose
CMD ["python", "app.py"]
