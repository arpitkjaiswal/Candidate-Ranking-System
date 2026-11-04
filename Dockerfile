# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --no-audit --no-fund --strict-ssl=true
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TALENT_DATA_DIR=/data TALENT_DEMO=0 TALENT_ENV=production
WORKDIR /app
COPY requirements.lock.txt ./
RUN --mount=type=secret,id=proxy_bundle \
    if [ -f /run/secrets/proxy_bundle ]; then export PIP_CERT=/run/secrets/proxy_bundle; fi; \
    pip install --no-cache-dir --disable-pip-version-check -r requirements.lock.txt
RUN groupadd --gid 10001 talent && useradd --uid 10001 --gid talent --no-create-home talent \
    && mkdir /data && chown talent:talent /data
COPY --chown=talent:talent backend/ backend/
COPY --chown=talent:talent migrations/ migrations/
COPY --from=frontend --chown=talent:talent /build/dist frontend/dist/
USER talent
EXPOSE 8000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)"
CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
