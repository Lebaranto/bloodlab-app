FROM python:3.11-slim

# System packages for pillow/pdfium
RUN apt-get update && apt-get install -y \
    libgl1 libglib2.0-0 libjpeg62-turbo zlib1g libpng16-16 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Code and data
COPY backend /app
COPY backend/data /app/data

# ENV with docker-compose
ENV PYTHONUNBUFFERED=1

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
