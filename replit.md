# Workspace

## TRION Protocol L0 — Real-Time Indexer Daemon

A zero-dependency, bare-metal Rust daemon that connects to Arbitrum One Mainnet and extracts 9 thermodynamic behavioral features per block in real time.

### Location
`trion-l0/` — standalone Rust project (no external crate dependencies)

### Run
```bash
cd trion-l0 && cargo run
```
Requires `ARBITRUM_RPC_URL` in Replit Secrets (full URL or raw Alchemy key).

### Architecture
- Pure Rust standard library + system `curl` for JSON-RPC calls
- Zero-dependency `Cargo.toml` — compiles in ~3 seconds
- Continuous daemon loop: polls `eth_blockNumber`, extracts full block on new blocks, sleeps 300ms otherwise
- Manual JSON parser handles the transactions array without `serde_json`

### 9 Behavioral Features (Physical Plane Φ)
| ID | Feature | Description |
|----|---------|-------------|
| f1 | Transaction Density | Total tx count |
| f2 | Base Fee Volatility | Network congestion (Wei) |
| f3 | Net Value Flow | Total ETH moved (ETH) |
| f4 | Entity Concentration | Unique senders / total txs |
| f5 | Counterparty Diversity | Unique receivers / unique senders |
| f6 | Contract Interaction Rate | Fraction of txs calling contracts |
| f7 | Gas Limit Skew | Top 10% gas share |
| f8 | Zero-Value Entropy | Fraction of zero-value txs |
| f9 | Block Coherence Score C(t) | Composite ∈ [0.00, 1.00] |

---

## L1 Semantic Plane

- 10-block sliding window `VecDeque<f64>` tracks C(t) values
- Rolling baseline Θ(t) = mean of window
- SILENCE primitive: alerts when C(t) drops >30% below Θ(t)
- **AnomalyHunter (EMA)**: α=0.10, anomaly_threshold=15% — tracks μ(t) via Exponential Moving Average
- Output: `/tmp/trion_latest.json` — includes `mu_t`, `is_stable`, shared between daemon, API server, and relayer

## Phase 2: On-Chain Oracle Bridge (V2 Trustless)

### Smart Contract: `contracts/v2_trustless/TRIONOracleV2.sol`
- V2 Trustless architecture — ecrecover-based validator permissioning
- Packed signal layout (bits 0-1: signalType, bits 17-48: coherence ×1e6, bits 49-80: threshold ×1e6)
- `publishSignal(txId, packedSignal, signature)` — on-chain signature verification via ecrecover
- **Deployed on Arbitrum Sepolia (V2)**: `0x852365411bf700ba7257A93c134CBdE71A58d4E0`
- Explorer: https://sepolia.arbiscan.io/address/0x852365411bf700ba7257A93c134CBdE71A58d4E0
- Relayer wallet / validator: `0xdbbf66cad621da3ec186d18b29a135d2a5d42d20`
- Deploy command: `TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat run hardhat-scripts/deploy_v2_sepolia.ts --network arbitrumSepolia`

### V2 Relayer: `artifacts/api-server/src/relayer.ts`
- Polls `/tmp/trion_latest.json` every 12 seconds
- Bit-packs signalType + coherence + threshold into a uint256
- Signs payload hash with EIP-191 personal_sign (ecrecover-compatible)
- Broadcasts to `TRIONOracleV2.publishSignal()` on Arbitrum Sepolia
- Writes V2 signed state cache to `/tmp/trion_v2_oracle.json` (served via `/api/trion/v2oracle`)
- Run: `pnpm --filter @workspace/api-server run relay`
- Requires: `RELAYER_PRIVATE_KEY`, `ARBITRUM_SEPOLIA_RPC` (defaults to publicnode), `TRION_V2_ORACLE_ADDRESS`

## L2 Public Dashboard

- React + Vite dashboard at `/` (artifact: `trion-dashboard`, port 24875)
- Polls `GET /api/trion/latest` every 1 second via React Query
- Dark terminal cyberpunk aesthetic — neon green on black, monospace fonts
- Features: live C(t) display, Θ(t) baseline, status banner (SAFE/ANOMALY), 3x3 feature grid
- API route: `artifacts/api-server/src/routes/trion.ts` (reads `/tmp/trion_latest.json`)

---

# Workspace (TypeScript Monorepo)

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health` (full path: `/api/health`)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.
