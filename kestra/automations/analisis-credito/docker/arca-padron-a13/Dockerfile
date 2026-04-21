FROM ghcr.io/kestra-io/kestrapy:latest

USER root

RUN if command -v apk >/dev/null 2>&1; then \
        apk add --no-cache libgcc libstdc++; \
    elif command -v apt-get >/dev/null 2>&1; then \
        apt-get update -y \
        && apt-get install -y --no-install-recommends libgcc-s1 libstdc++6 \
        && apt-get clean \
        && rm -rf /var/lib/apt/lists/*; \
    else \
        echo "Unsupported base image: no apk or apt-get available" >&2; \
        exit 1; \
    fi \
    && python -m pip install --no-cache-dir cryptography
