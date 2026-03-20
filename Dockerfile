## Stage 1: Build the Rust L0 Anomaly Hunter binary
FROM rust:1.81-slim AS rust-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY trion-l0/ ./trion-l0/
RUN cd trion-l0 && cargo build --release

## Stage 2: Build the Node.js artifacts (dashboard + API + relayer)
FROM node:20-slim AS node-builder

RUN npm install -g pnpm

WORKDIR /build
COPY . .

RUN pnpm install --frozen-lockfile

# Build the React dashboard (outputs to artifacts/trion-dashboard/dist/public)
RUN pnpm --filter @workspace/trion-dashboard build

# Build the API server + relayer (outputs to artifacts/api-server/dist/)
RUN pnpm --filter @workspace/api-server run build

## Stage 3: Production runner (slim image — only what's needed to run)
FROM node:20-slim AS runner

# ==========================================
# 🚨 THE FIX: Install curl and certs for Rust
# ==========================================
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Rust binary
COPY --from=rust-builder /build/trion-l0/target/release/trion-l0 ./trion-l0/target/release/trion-l0

# Built API server and relayer
COPY --from=node-builder /build/artifacts/api-server/dist ./artifacts/api-server/dist

# Built React dashboard (served as static files by the API in production)
COPY --from=node-builder /build/artifacts/trion-dashboard/dist/public ./artifacts/trion-dashboard/dist/public

# Any runtime node_modules not bundled by esbuild
COPY --from=node-builder /build/artifacts/api-server/node_modules ./artifacts/api-server/node_modules
COPY --from=node-builder /build/node_modules ./node_modules

# Startup script
COPY start-production.sh ./
RUN chmod +x start-production.sh

# API server (+ static dashboard) on 8080
EXPOSE 8080

ENV NODE_ENV=production

CMD ["./start-production.sh"]
