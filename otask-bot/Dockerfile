FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DATA_DIR=/data

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY bot ./bot
COPY main.py .

# Том для хранилища (подписчики, дедуп напоминаний)
VOLUME ["/data"]

CMD ["python", "main.py"]
