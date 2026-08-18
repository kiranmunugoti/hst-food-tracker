FROM python:3.12-slim

# ZBar and Tesseract are SYSTEM libraries, not Python packages. This is why the
# service cannot run on Vercel — its Python runtime has no way to install them.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libzbar0 \
      tesseract-ocr \
      tesseract-ocr-eng \
      libglib2.0-0 \
      libgl1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .

EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
