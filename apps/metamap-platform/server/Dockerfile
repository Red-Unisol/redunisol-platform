FROM python:3.11-slim

ARG GIT_SHA=""
ENV METAMAP_SERVER_GIT_SHA=$GIT_SHA

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src ./src

RUN python -m pip install --upgrade pip \
    && pip install .

EXPOSE 8000

CMD ["uvicorn", "metamap_server.main:app", "--host", "0.0.0.0", "--port", "8000"]
