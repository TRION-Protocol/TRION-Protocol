# AXIOM Validator Node — Multi-stage Docker build
#
# Stage 1: Build Rust binaries (axiom-core + axiom-akashic)
# Stage 2: Build Go RCP daemon
# Stage 3: Production validator image (minimal)
# Stage 4: Production RCP image (minimal)
#
# Author: Hudu Yusuf (Analys), @The_analys
# License: CC0 1.0 Universal

# ============================================================================
# Stage 1: Rust build
# ============================================================================
FROM rust:1.79-slim AS rust-builder

WORKDIR /axiom

# Install system dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace files
COPY Cargo.toml ./
COPY axiom-core/ axiom-core/
COPY axiom-akashic/ axiom-akashic/

# Build with release optimizations
RUN cargo build --release \
    --package axiom-core \
    --package axiom-akashic

# ============================================================================
# Stage 2: Go RCP build
# ============================================================================
FROM golang:1.22-alpine AS go-builder

WORKDIR /axiom-rcp

RUN apk add --no-cache git

COPY axiom-rcp/go.mod axiom-rcp/go.sum ./
RUN go mod download

COPY axiom-rcp/ .
RUN go build -ldflags="-s -w" -o /bin/axiom-rcp ./...

# ============================================================================
# Stage 3: Validator production image
# ============================================================================
FROM debian:bookworm-slim AS validator

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -r -u 1000 -m axiom

WORKDIR /app

# Copy Rust binaries
COPY --from=rust-builder /axiom/target/release/axiom-validator /app/axiom-validator

# Health check script
COPY --from=rust-builder /axiom/scripts/healthcheck.sh /app/healthcheck.sh
RUN chmod +x /app/healthcheck.sh

USER axiom

EXPOSE 7777 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

ENTRYPOINT ["/app/axiom-validator"]
CMD ["--grpc-port", "7777", "--http-port", "8080"]

# ============================================================================
# Stage 4: RCP daemon production image
# ============================================================================
FROM alpine:3.19 AS rcp

RUN apk add --no-cache ca-certificates curl

RUN adduser -D -u 1000 axiom

WORKDIR /app
COPY --from=go-builder /bin/axiom-rcp /app/axiom-rcp

USER axiom

EXPOSE 7778 7779

ENTRYPOINT ["/app/axiom-rcp"]
CMD ["--grpc-addr", ":7778"]
