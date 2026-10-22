FROM python:3.11-slim-bookworm AS base
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y 7zip tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 bcra \
    && useradd --uid 10001 --gid 10001 --no-create-home bcra \
    && mkdir /data && chown bcra:bcra /data
ENV PYTHONPATH=/app/src PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 BCRA_FILE_7Z=7zz
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY src /app/src

FROM base AS test
COPY requirements-test.txt /app/requirements-test.txt
RUN pip install --no-cache-dir -r /app/requirements-test.txt
COPY tests /app/tests
RUN python -m unittest discover -s /app/tests -v

FROM base AS runtime
USER 10001:10001
EXPOSE 8080
CMD ["python", "-m", "bcra_file_api.app"]
