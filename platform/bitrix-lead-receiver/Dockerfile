FROM python:3.12-slim
WORKDIR /app
COPY receiver.py /app/receiver.py
RUN useradd --uid 10001 --create-home receiver && mkdir /data && chown receiver /data
USER 10001:10001
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
CMD ["python", "/app/receiver.py"]
