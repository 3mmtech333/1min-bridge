# ============================================================================
# 1min-relay — Multi-stage Docker Build
# ============================================================================

# Stage 1: Fast Build on Native Host Architecture (avoids slow QEMU emulation for TS compile)
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npx tsc

# Stage 2: Production Dependencies
FROM --platform=$BUILDPLATFORM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Stage 3: Production Runtime
FROM node:22-alpine AS production
RUN apk add --no-cache tini
WORKDIR /app

# Copy only production artifacts
COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

# Non-root user
RUN addgroup -g 1001 -S relay && \
    adduser -S relay -u 1001 && \
    chown -R relay:relay /app
USER relay

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
