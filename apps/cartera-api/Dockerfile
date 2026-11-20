FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY src ./src

ENV PYTHONPATH=/app/src
EXPOSE 8000

# Un solo proceso: la copia diaria corre en un hilo dentro de la app.
CMD ["uvicorn", "cartera_api.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-proxy-headers"]
# X-Forwarded-For lo interpreta la app (CARTERA_PROXIES_CONFIABLES), no uvicorn.
