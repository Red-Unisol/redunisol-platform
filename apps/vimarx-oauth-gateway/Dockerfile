FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --gid 10001 gateway \
    && useradd --uid 10001 --gid gateway --no-create-home gateway \
    && mkdir /data && chown gateway:gateway /data
COPY gateway ./gateway
ARG GIT_SHA=development
ENV GIT_SHA=$GIT_SHA
USER gateway
EXPOSE 8000
# Access logs intentionally disabled: authorize URLs contain one-time login state.
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "8", "--timeout", "90", "gateway.app:create_app()"]
