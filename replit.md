# TRION Protocol — Workspace

A behavioral execution firewall for DeFi protocols on Arbitrum. The system monitors on-chain activity, derives a coherence score, publishes signed signals to an on-chain oracle, and allows integrated smart contracts to gate execution against anomalous network states.

---

## Repository Structure

```
contracts/
  interfaces/
    ITRIONOracleV3.sol        Oracle interface for integrators
  core/
    TRIONOracleV3.sol         Production oracle (quorum, 256-bit signals)
    TRIONGuardV3.sol          Abstract guard (onlyWhenCoherent modifier)
  examples/
    TRIONProtectedVault.sol   Reference DeFi integration
  test/
    MockOracle.sol            Local Hardhat test double (implements ITRIONOracle)
    VulnerableVault.sol       Reentrancy demo gated by TRION
    TRIONGuard.sol            Legacy v1 guard (test dependency)
    ITRIONOracle.sol          Legacy v1 interface (test dependency)

trion-l0/
  src/main.rs                 Rust L0 indexer daemon

artifacts/
  api-server/                 Express API server + V3 relayer
  trion-dashboard/            React + Vite real-time dashboard
  mockup-sandbox/             Component preview server

hardhat-scripts/
  deploy.ts                   Deploy TRIONOracleV3 + TRIONProtectedVault
  deploy-vault.ts             Deploy vault only (against live oracle)
  bootstrap.ts                Verify oracle state on-chain
  simulate-exploit.ts         Local reentrancy demo on Hardhat network

sdk/
  index.ts                    TrionSDK: packSignal / unpackSignal

docs/
  integration-map.md          Full execution flow + signal layout reference

lib/
  db/                         Drizzle ORM + PostgreSQL
  api-spec/                   OpenAPI spec
  api-client-react/           Generated React Query hooks
  api-zod/                    Generated Zod schemas

scripts/
  post-merge.sh               Post-merge setup hook
```

---

## Deployed Contracts (Arbitrum Sepolia)

| Contract | Address |
|---|---|
| TRIONOracleV3 | `0xb819c63c02Ed5aB49017C0f3f2568A14624658b3` |
| TRIONProtectedVault | `0x91D7D8bc873D13B75E329e62D9dDA4EfF1b9f7E5` |

---

## Running Components

| Workflow | Command | Port |
|---|---|---|
| L0 Indexer | `cd trion-l0 && cargo run` | — |
| API Server | `PORT=3001 pnpm --filter @workspace/api-server run dev` | 3001 |
| Dashboard | `PORT=8080 pnpm --filter @workspace/trion-dashboard run dev` | 8080 |
| Relayer | `pnpm --filter @workspace/api-server run relay` | — |

---

## L0 Indexer (Rust)

Polls `eth_getBlockByNumber` every 300 ms. Extracts 8 behavioral features per block:

| Feature | Description |
|---|---|
| f1 Transaction density | Tx count |
| f2 Base fee volatility | Wei variance |
| f3 Net value flow | ETH moved |
| f4 Entity concentration | Sender concentration (Gini) |
| f5 Counterparty diversity | Unique recipient ratio |
| f6 Contract interaction rate | Fraction of contract calls |
| f7 Gas limit skew | Top-10% gas share |
| f8 Zero-value entropy | Fraction of zero-value txs |

Computes `C(t) = mean(f1..f8)`, EMA baseline `μ(t)`, sliding window `Θ(t)`. Writes `/tmp/trion_latest.json`.

---

## V3 Signal Layout (uint256)

| Bits | Field | Notes |
|---|---|---|
| 0–7 | status | 1=SAFE, 2=WARN, 3=SILENCE |
| 8–39 | coherence C(t) | Scaled ×1e6 |
| 40–71 | threshold Θ(t) | Scaled ×1e6 |
| 72–135 | blockNum | uint64 |
| 136–199 | timestamp | Unix seconds, uint64 |

---

## V3 Message Hash (relayer must match on-chain)

```typescript
const innerHash = ethers.keccak256(
  ethers.solidityPacked(
    ["uint256", "address", "bytes32", "uint256"],
    [chainId, oracleAddress, txId, packedSignal]
  )
);
const signature = await signer.signMessage(ethers.getBytes(innerHash));
```

Contract: `keccak256(abi.encodePacked(block.chainid, address(this), txId, packedData))` wrapped with `MessageHashUtils.toEthSignedMessageHash`.

---

## Relayer Startup Sequence

On startup the relayer:
1. Confirms it is the oracle owner
2. Sets `quorumRequired` to 1 if > 1 (single-validator testnet mode)
3. Registers itself as a validator via `addValidator()` if not already registered
4. Fetches `chainId` from the provider (used in every message hash)

---

## TypeScript Monorepo

pnpm workspaces, Node.js 24, TypeScript 5.9, Express 5, Drizzle ORM, Zod.

- Typecheck from root: `pnpm run typecheck`
- All packages extend `tsconfig.base.json` with `composite: true`
- API routes live in `artifacts/api-server/src/routes/`
- DB schema in `lib/db/src/schema/`
