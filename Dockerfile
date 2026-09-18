# Stage 1: Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache tzdata ca-certificates

# Copy package manifests and install all dependencies
COPY package*.json ./
RUN npm ci

# Copy application source code and configurations
COPY tsconfig.json vite.config.ts index.html metadata.json ./
COPY src ./src
COPY server.ts ./

# Build Vite frontend and bundle Express backend via esbuild -> dist/server.cjs
RUN npm run build

# Stage 2: Production runner stage
FROM node:20-alpine AS runner

WORKDIR /app

# Install runtime dependencies:
# - tzdata: Europe/Moscow timezone support
# - wget & curl: Health checking, network inspection and debugging
# - ffmpeg: Audio processing and format conversion for speech recognition
# - ca-certificates: TLS verification with Russian Trusted CA (Минцифры) for Sber GigaChat
RUN apk add --no-cache tzdata wget curl ffmpeg ca-certificates && \
    mkdir -p /usr/local/share/ca-certificates/ && \
    (wget --no-check-certificate -qO /usr/local/share/ca-certificates/russian_trusted_root_ca.crt https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt 2>/dev/null || true) && \
    (wget --no-check-certificate -qO /usr/local/share/ca-certificates/russian_trusted_sub_ca.crt https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt 2>/dev/null || true) && \
    update-ca-certificates 2>/dev/null || true

# Production environment configuration
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV TZ=Europe/Moscow
ENV DATA_PATH=/app/data/data-store.json
ENV DATA_PATH_ENC=/app/data/data-store.enc
ENV CONSENT_PATH=/app/data/consents.enc
ENV CONSENTS_PATH=/app/data/consents.enc
ENV YC_SERVICE_ACCOUNT_KEY_FILE=/app/keys/authorized_key.json
ENV NODE_OPTIONS=--max-old-space-size=2048
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

# Create directories for encrypted database, consents, keys, and temp buffers
RUN mkdir -p /app/keys /app/data /app/temp && \
    chown -R node:node /app/data /app/keys /app/temp && \
    chmod 700 /app/keys && \
    chmod 750 /app/data

# Copy production package manifest and install only runtime dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled frontend and bundled CommonJS server from builder
COPY --from=builder --chown=node:node /app/dist ./dist

# Ensure proper permissions across the application directory
RUN chown -R node:node /app

# Volume for durable encrypted store, audit logs, and consents (152-FZ)
VOLUME ["/app/data"]

USER node

EXPOSE 3000

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

# Start the compiled CommonJS server
CMD ["node", "dist/server.cjs"]

