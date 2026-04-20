FROM ghcr.io/kestra-io/kestrapy:latest

USER root

RUN apt-get update -y \
    && apt-get install -y --no-install-recommends libgcc-s1 \
    && python -m pip install --no-cache-dir cryptography \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*
