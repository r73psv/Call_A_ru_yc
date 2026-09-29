# ==============================================================================
# Dockerfile: Remix CallQA AI_RU (Салон красоты «Лик 28»)
# Multi-stage production container with 152-FZ encryption and Russian CA support
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build stage
# Compiles Vite frontend SPA and bundles Express backend via esbuild -> dist/server.cjs
# ------------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Install build tools and timezone data
RUN apk add --no-cache tzdata ca-certificates

# Copy package manifests and install all dependencies (including devDependencies)
COPY package*.json ./
RUN npm install --no-audit --no-fund

# Copy application configuration and source code
COPY tsconfig.json vite.config.ts index.html metadata.json ./
COPY src ./src
COPY fonts ./fonts
COPY server.ts ./

# Compile frontend and backend in production mode with sufficient memory
ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=2048
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Production runner stage
# Lightweight, hardened image with ffmpeg, Russian Trusted CA, and dumb-init
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

# Install essential runtime dependencies:
# - tzdata: Europe/Moscow timezone support
# - dumb-init: Lightweight PID 1 init system for graceful signal handling (SIGTERM/SIGINT)
# - wget & curl: Health checks, container probes, and debugging
# - ffmpeg: Audio transcoding and format normalization for SpeechKit
# - ttf-liberation: Cyrillic typography for 152-ФЗ PDF generation and reports
# - ca-certificates: TLS verification with Russian Trusted CA (Минцифры) for Sber GigaChat
RUN apk add --no-cache tzdata dumb-init wget curl ffmpeg ttf-liberation ca-certificates && \
    mkdir -p /usr/local/share/ca-certificates/ && \
    (wget --no-check-certificate -qO /usr/local/share/ca-certificates/russian_trusted_root_ca.crt https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt 2>/dev/null || true) && \
    (wget --no-check-certificate -qO /usr/local/share/ca-certificates/russian_trusted_sub_ca.crt https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt 2>/dev/null || true) && \
    update-ca-certificates 2>/dev/null || true

# Production environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV TZ=Europe/Moscow
ENV DATA_PATH=/app/data/data-store.json
ENV DATA_PATH_ENC=/app/data/data-store.enc
ENV CONSENT_PATH=/app/data/consents.enc
ENV CONSENTS_PATH=/app/data/consents.enc
ENV YC_FOLDER_ID=
ENV YC_API_KEY=
ENV YC_SERVICE_ACCOUNT_KEY_FILE=/app/keys/authorized_key.json
ENV YC_STORAGE_BUCKET=
ENV YC_STORAGE_ENDPOINT=https://storage.yandexcloud.net
ENV YC_STORAGE_REGION=ru-central1
ENV S3_ENDPOINT=https://s3.timeweb.cloud
ENV S3_REGION=ru-1
ENV S3_KEY_PREFIX=lik28/data/
ENV S3_SYNC_INTERVAL_SEC=300
ENV GIGACHAT_MODEL=GigaChat:Lite
ENV GIGACHAT_SCOPE=GIGACHAT_API_PERS
ENV TTL_LOG_DAYS=30
ENV TTL_TEMP_DAYS=30
ENV TTL_AUDIO_DAYS=30
ENV NODE_OPTIONS=--max-old-space-size=2048
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

# Create required directories for persistent encrypted storage, key files, temp & uploads (152-ФЗ)
RUN mkdir -p /app/keys /app/data /app/temp /app/uploads && \
    chown -R node:node /app/data /app/keys /app/temp /app/uploads && \
    chmod 700 /app/keys && \
    chmod 750 /app/data && \
    chmod 770 /app/temp /app/uploads

# Copy package manifest and pre-installed dependencies from builder
COPY --chown=node:node package.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules

# Copy pre-compiled distribution assets from builder
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node fonts ./fonts

# Volumes for persistent encrypted database (152-ФЗ), credentials, temporary files, and uploads
VOLUME ["/app/data", "/app/keys", "/app/temp", "/app/uploads"]

# Run as non-root user for security hardening
USER node

# Container listens strictly on port 3000
EXPOSE 3000

# Health check probe against Express /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

# Launch using dumb-init for graceful termination and process reaping
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/server.cjs"]
