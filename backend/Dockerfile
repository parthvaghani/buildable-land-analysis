FROM python:3.11-slim

WORKDIR /app

# System deps for GDAL/Fiona/pyogrio
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgdal-dev \
    gdal-bin \
    libgeos-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Mount /data as a volume in production so GeoParquet files persist across deploys.
VOLUME ["/data"]

EXPOSE 8000

# Gunicorn with Uvicorn workers for production; override with uvicorn for local dev.
CMD ["gunicorn", "app.main:app", "-k", "uvicorn.workers.UvicornWorker", \
     "-w", "2", "--bind", "0.0.0.0:8000", "--timeout", "120"]
