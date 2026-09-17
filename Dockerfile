# Stage 1: Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install tzdata and ca-certificates
RUN apk add --no-cache tzdata ca-certificates

# Copy package manifests and install all dependencies
COPY package*.json ./
RUN npm ci

# Copy application source code explicitly (never copying secrets or full workspace)
COPY tsconfig.json vite.config.ts index.html metadata.json ./
COPY src ./src
COPY server.ts ./

# Build Vite frontend and bundle Express backend via esbuild -> dist/server.cjs
RUN npm run build

# Stage 2: Production runner stage
FROM node:20-alpine AS runner

WORKDIR /app

# Install runtime dependencies: tzdata (Moscow timezone), wget (healthcheck), ffmpeg (audio), ca-certificates
RUN apk add --no-cache tzdata wget ffmpeg ca-certificates

# Environment configuration
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV TZ=Europe/Moscow
ENV DATA_PATH=/app/data/data-store.enc
ENV CONSENTS_PATH=/app/data/consents.enc
ENV YC_SERVICE_ACCOUNT_KEY_FILE=/app/keys/authorized_key.json
ENV NODE_OPTIONS=--max-old-space-size=2048

# Create directories for encrypted data and keys with restrictive permissions
RUN mkdir -p /app/keys /app/data && \
    chown -R node:node /app/data /app/keys && \
    chmod 700 /app/keys

# Copy production package manifest
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy compiled frontend and bundled server from builder
COPY --from=builder --chown=node:node /app/dist ./dist

# Ensure proper permissions across the application directory
RUN chown -R node:node /app

# Volume for durable encrypted store and consents
VOLUME ["/app/data"]

USER node

EXPOSE 3000

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

# Start the compiled CommonJS server
CMD ["node", "dist/server.cjs"]
