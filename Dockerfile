# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency files first for better layer caching
COPY package.json package-lock.json ./

# Install all dependencies required for building
RUN npm ci --ignore-scripts

# Copy TypeScript and bundler configuration
COPY tsconfig.json ./
COPY tsup.config.ts ./

# Copy application source
COPY src/ ./src/

# Build TypeScript → JavaScript
RUN npm run build


# ─── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Create a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy dependency files
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

# Copy compiled application
COPY --from=builder /app/dist ./dist

# Use non-root user
USER appuser

# Application configuration
ENV PORT=8000
ENV NODE_ENV=production

# Document the application port
EXPOSE 8000

# Container health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8000/health || exit 1

# Start the application
CMD ["node", "dist/server.js"]