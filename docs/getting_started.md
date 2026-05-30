# Getting Started with AXIOM

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Rust | 1.79+ | L0-L2, L5 core |
| Go | 1.22+ | L6 RCP daemon |
| Python | 3.12+ | L4 coherence engine |
| Node.js | 20+ | TypeScript SDK, contracts |
| Docker | 26+ | Full stack deployment |
| PostgreSQL | 16+ | TimescaleDB (with extension) |

## Quick Start (Development)

### 1. Clone the repository

```bash
git clone https://github.com/dev-analyshd/TRION-Protocol.git
cd TRION-Protocol/AXIOM
```

### 2. Start infrastructure

```bash
docker compose -f docker/docker-compose.yml up timescaledb redis kafka -d
```

### 3. Apply database schema

```bash
psql postgres://axiom:axiom_dev_password@localhost:5432/axiom -f sql/akashic_schema.sql
```

### 4. Build and run the Rust core

```bash
# Build all Rust crates
cargo build --release

# Run tests
cargo test
```

### 5. Start the RCP daemon

```bash
cd axiom-rcp
go build ./...
./axiom-rcp --grpc-addr :7777 --akashic-url postgres://axiom:axiom_dev_password@localhost:5432/axiom
```

### 6. Start the coherence engine

```bash
cd axiom-coherence
pip install -r requirements.txt
python -m axiom_coherence
```

### 7. Install the TypeScript SDK

```bash
cd sdk
npm install
npm run build
```

## Using the TypeScript SDK

```typescript
import { AXIOMClient, UBEType, computeBC } from '@axiom/sdk';

// Connect to AXIOM node
const client = new AXIOMClient({ 
    endpoint: 'http://localhost:7777',
    apiKey: 'your-api-key',
});

// Get truth state for an entity
const state = await client.getTruthState('your-bpi-hex');
console.log(`BC: ${state.bc.toFixed(4)}, Ξ: ${state.xi.toFixed(6)}`);

// Check SILENCE
if (state.silence === 'silenced') {
    console.warn('Entity is SILENCED — BC below threshold');
}

// Emit a behavioral event
const ubh = await client.emitEvent(entityBpi, UBEType.Execute, new Uint8Array([1, 2, 3]));
console.log(`Event hash: ${ubh.selfHash}`);

// Subscribe to real-time coherence updates
const unsubscribe = client.subscribeCoherence(entityBpi, (update) => {
    console.log(`New BC: ${update.bc.toFixed(4)}`);
});

// Clean up
unsubscribe();
client.disconnect();
```

## Deploying Smart Contracts

```bash
cd contracts
npm install

# Local testnet
npx hardhat node &
npx hardhat run scripts/deploy.ts --network localhost

# Arbitrum Sepolia
DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy.ts --network arbitrum-sepolia
```

## Compiling ZK Circuits

### Noir (Barretenberg/Aztec)

```bash
cd circuits
nargo check
nargo prove
nargo verify
```

### Cairo (Starknet)

```bash
cd cairo
scarb build
scarb test
```

### C Bare-Metal (ARM Cortex-M)

```bash
cd axiom-c
mkdir build && cd build

# ARM Cortex-M4 target
cmake .. -DCMAKE_TOOLCHAIN_FILE=../cmake/arm-cortex-m4.cmake -DEMBEDDED=ON
make

# ESP32 target
cmake .. -DESP32=ON
make
```

## Running All Tests

```bash
# Rust
cargo test --workspace

# Python
cd axiom-coherence && python -m pytest

# Go
cd axiom-rcp && go test ./...

# C
cd axiom-c/build && ctest

# Contracts
cd contracts && npx hardhat test
```

## Full Stack Deployment

```bash
# Production deployment
docker compose -f docker/docker-compose.yml up -d

# Check health
curl http://localhost:8080/health
curl http://localhost:7777/health

# View Grafana dashboards
open http://localhost:3000  # admin / axiom_admin
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | Required | TimescaleDB connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `KAFKA_BROKERS` | `localhost:9092` | Kafka bootstrap servers |
| `AXIOM_GRPC_PORT` | `7777` | Validator gRPC port |
| `AXIOM_HTTP_PORT` | `8080` | Health/metrics port |
| `AXIOM_ENV` | `development` | Environment name |
| `AXIOM_LOG_LEVEL` | `info` | Log verbosity |
| `POSTGRES_PASSWORD` | `axiom_dev_password` | Database password |

## TRION Oracle V3 (deployed)

The predecessor TRION Oracle V3 is deployed on Arbitrum Sepolia:
```
0xb819c63c02Ed5aB49017C0f3f2568A14624658b3
```

TRIONOracleV4 (this repository) supersedes it with full AXIOM integration.

## No-Version Evolution Law (Invention #16)

AXIOM software has no discrete version numbers. The "version" is:
```
D(AXIOM, t) ∈ ℝ⁺ — current Akashic Depth
```

This is a continuous, monotonically increasing real number. AXIOM-native software cannot be versioned in the discrete sense. This is a theorem, not a preference.
