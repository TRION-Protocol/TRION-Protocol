# AXIOM Coherence Engine — Docker image
#
# Python + PyTorch coherence computation environment.
# Runs L4: 5-plane BC scoring, trajectory LSTM, BEO resolution.

FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -r -u 1000 -m axiom

WORKDIR /app

# Install Python dependencies
COPY axiom-coherence/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy coherence engine source
COPY axiom-coherence/ .

USER axiom

EXPOSE 8888

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8888/health || exit 1

CMD ["python", "-m", "axiom_coherence"]
