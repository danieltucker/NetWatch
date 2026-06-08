# ── Stage 1: Build the React frontend ────────────────────────────────────────
# Pinned to amd64 — output is architecture-agnostic static files (JS/CSS/HTML),
# so there's no reason to run this through QEMU when cross-compiling for arm64.
FROM --platform=linux/amd64 node:22-alpine AS frontend

WORKDIR /build

COPY package*.json ./
RUN npm ci

COPY index.html vite.config.js tailwind.config.js postcss.config.js ./
COPY src ./src

# Output goes to server/public/ (configured in vite.config.js)
RUN npm run build


# ── Stage 2: Compile native server dependencies ───────────────────────────────
# net-ping uses a native C extension — needs build tools at compile time only.
FROM node:22-alpine AS server-deps

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY server/package*.json ./
RUN npm ci --omit=dev


# ── Stage 3: Final runtime image ─────────────────────────────────────────────
FROM node:22-alpine

# iputils provides the system `ping` binary (used as a fallback if net-ping
# raw sockets are unavailable, and for general network debugging in the container)
RUN apk add --no-cache iputils

WORKDIR /app

# Copy compiled node_modules (includes native .node binary for net-ping)
COPY --from=server-deps /app/node_modules ./node_modules

# Copy server source
COPY server/src ./src

# Copy built frontend assets
COPY --from=frontend /build/server/public ./public

# Remove npm — not needed at runtime, eliminates its bundled CVEs (tar, minimatch, glob, etc.)
RUN npm uninstall -g npm

# SQLite data directory — mount a volume here for persistence
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["node", "src/server.js"]
