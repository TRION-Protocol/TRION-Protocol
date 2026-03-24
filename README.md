# TRION Protocol

A behavioral execution firewall for DeFi protocols on Arbitrum. TRION monitors on-chain activity to derive a real-time coherence score, publishes that score to an on-chain oracle, and allows integrated protocols to gate sensitive functions against anomalous network states.

---

## System Overview

Most DeFi security infrastructure validates **price**. Price oracles and liquidation bots assume that if an asset is priced correctly, the transaction is safe. This assumption fails during:

- Flash loan attacks that transiently distort pool ratios
- Sybil-coordinated liquidity drains across thin markets
- Governance attacks that rely on temporary voting weight concentration

TRION operates at a different layer. It validates **behavior** — whether the current execution context is consistent with recent observed network activity. If a block's behavioral signature deviates significantly from the established baseline, TRION signals an anomaly and any integrated contract can refuse execution.

---

## Architecture

```
 ┌──────────────────────────────────────────────────────┐
 │  Arbitrum Sequencer                                  │
 │  (block data, ~250 ms polling interval)              │
 └────────────────────────┬─────────────────────────────┘
                          │ eth_getBlockByNumber (JSON-RPC)
                          ▼
 ┌──────────────────────────────────────────────────────┐
 │  trion-l0  (Rust, zero-dependency)                   │
 │                                                      │
 │  Per block:                                          │
 │    Extract 8 behavioral features (f1–f8)             │
 │    Compute coherence score  C(t) = mean(f1..f8)      │
 │    Update EMA baseline      μ(t)                     │
 │    Sliding window average   Θ(t)                     │
 │    Anomaly if drop > 15%:   (μ(t)–C(t))/μ(t) > 0.15 │
 │                                                      │
 │  Output: /tmp/trion_latest.json                      │
 └────────────────────────┬─────────────────────────────┘
                          │ file read every 12 s
                          ▼
 ┌──────────────────────────────────────────────────────┐
 │  Relayer  (Node.js / TypeScript)                     │
 │                                                      │
 │  Determine signal type: SAFE | WARN | SILENCE        │
 │  Pack into 256-bit uint via TrionSDK.packSignal()    │
 │  Derive txId = keccak256(abi.encode(blockNumber))    │
 │  Sign with EIP-191 personal_sign                     │
 │  Call TRIONOracleV3.publishSignal()                  │
 └────────────────────────┬─────────────────────────────┘
                          │ on-chain, Arbitrum Sepolia
                          ▼
 ┌──────────────────────────────────────────────────────┐
 │  TRIONOracleV3  (Solidity)                           │
 │                                                      │
 │  Verify quorum ECDSA signatures (sorted, deduped)    │
 │  Store signals[txId] = Signal(packedData, true)      │
 │  Emit ThermodynamicSignalEtched                      │
 └────────────────────────┬─────────────────────────────┘
                          │ at transaction time
                          ▼
 ┌──────────────────────────────────────────────────────┐
 │  TRIONGuardV3  (modifier: onlyWhenCoherent)          │
 │                                                      │
 │  Derive txId from call context                       │
 │  Call oracle.verifyExecution(txId)                   │
 │  isSafe == true  → proceed                           │
 │  isSafe == false → revert TRION_ExecutionBlocked     │
 └──────────────────────────────────────────────────────┘
```

---

## How It Works

### 1. Signal Generation

The Rust L0 engine fetches each Arbitrum block via JSON-RPC and extracts 8 features:

| ID | Feature | Description |
|----|---------|-------------|
| f1 | Transaction density | Transaction count per block |
| f2 | Base fee volatility | Wei-level fee variance |
| f3 | Net value flow | ETH transferred, in ETH |
| f4 | Entity concentration | Gini-style sender concentration |
| f5 | Counterparty diversity | Unique recipient ratio |
| f6 | Contract interaction rate | Fraction of calls to contracts |
| f7 | Gas limit skew | Top-10% gas usage ratio |
| f8 | Zero-value entropy | Ratio of zero-value transfers |

The coherence score is `C(t) = mean(f1..f8)` where each feature is normalized to `[0, 1]`.

### 2. Anomaly Detection

An exponential moving average `μ(t)` tracks the long-run behavioral baseline. A sliding window average `Θ(t)` captures recent short-run behavior. An anomaly is declared when:

```
(μ(t) - C(t)) / μ(t) > 0.15
```

### 3. Signal Packing

The relayer packs the signal into a single `uint256`:

```
Bits   0–7   : status     (1=SAFE, 2=WARN, 3=SILENCE)
Bits   8–39  : coherence  C(t)  scaled ×1e6
Bits  40–71  : threshold  Θ(t)  scaled ×1e6
Bits  72–135 : blockNum
Bits 136–199 : timestamp  (unix seconds)
```

### 4. Quorum Signing and Publication

The relayer signs the payload with EIP-191 `personal_sign` and calls `TRIONOracleV3.publishSignal()`. The contract:

1. Verifies that signatures are from registered validators
2. Requires signers to be ordered ascending by address (prevents replay)
3. Requires signature count ≥ `quorumRequired` (default: 2)
4. Writes the signal to `signals[txId]`

### 5. On-Chain Enforcement

`TRIONGuardV3.onlyWhenCoherent` computes the txId from the call context and calls `verifyExecution()`. The oracle returns `isSafe = false` if:

- No signal is stored for the txId
- The stored signal has `status != 1` (SAFE)
- The signal is older than 300 seconds
- The signal was published more than 50 blocks ago

---

## Core Concepts

**txId binding** — The txId is `keccak256(abi.encode(address(this), msg.sender, msg.data, block.chainid))`. This deterministically links a specific call to its pre-published signal. A signal published for one caller cannot authorize the same call from a different address.

**Signal freshness** — Two independent bounds (timestamp and block number) ensure signals cannot be replayed from earlier network states.

**Quorum validation** — Multiple validators must co-sign each signal. Validator addresses must be ordered ascending in the signature array, preventing duplicate signature submission.

**Fail-closed vs fail-open** — By default the Guard fails closed: a missing signal causes `TRION_SignalStaleOrMissing`, an incoherent signal causes `TRION_ExecutionBlocked`. The `trionBypassEnabled` flag provides a fail-open mode for emergency maintenance, controlled by the inheriting contract's owner.

---

## Contracts

| Contract | Location | Description | Arbitrum Sepolia |
|---|---|---|---|
| `TRIONOracleV3` | `contracts/core/` | Signal store with quorum verification | `0xb819c63c02Ed5aB49017C0f3f2568A14624658b3` |
| `TRIONGuardV3` | `contracts/core/` | Abstract base with `onlyWhenCoherent` modifier | — |
| `ITRIONOracleV3` | `contracts/interfaces/` | Oracle interface for integrators | — |
| `TRIONProtectedVault` | `contracts/examples/` | Reference integration (not production) | `0x91D7D8bc873D13B75E329e62D9dDA4EfF1b9f7E5` |

---

## Installation and Setup

**Requirements:** Node.js ≥ 20, pnpm, Rust (stable), Hardhat

```bash
git clone https://github.com/TRION-Protocol/TRION-Protocol.git
cd TRION-Protocol
pnpm install
```

**Environment variables:**

```bash
ARBITRUM_RPC_URL=<arbitrum-mainnet-rpc>        # L0 indexer (mainnet)
ARBITRUM_SEPOLIA_RPC=<arbitrum-sepolia-rpc>    # Hardhat / relayer network
RELAYER_PRIVATE_KEY=<hex-private-key>           # Relayer signing key
TRION_V3_ORACLE_ADDRESS=0xb819c63c02Ed5aB49017C0f3f2568A14624658b3
TRION_PROTECTED_VAULT_ADDRESS=0x91D7D8bc873D13B75E329e62D9dDA4EfF1b9f7E5
```

**Start the L0 indexer:**

```bash
cd trion-l0
ARBITRUM_RPC_URL=<rpc> cargo run
```

**Start the API server and relayer:**

```bash
PORT=3001 pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/api-server run relay
```

**Compile contracts:**

```bash
npx hardhat compile
```

**Deploy to Arbitrum Sepolia:**

```bash
TS_NODE_PROJECT=tsconfig.hardhat.json \
npx hardhat run hardhat-scripts/deploy.ts --network arbitrumSepolia
```

---

## Integrating TRIONGuardV3

Inherit `TRIONGuardV3` and pass the oracle address in your constructor. Decorate sensitive functions with `onlyWhenCoherent`.

```solidity
import "./contracts/core/TRIONGuardV3.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract ProtectedLendingPool is TRIONGuardV3, Ownable {

    constructor(address oracle) TRIONGuardV3(oracle) Ownable(msg.sender) {}

    function borrow(uint256 amount) external onlyWhenCoherent {
        // Reaches here only when oracle.verifyExecution(txId) returns isSafe == true.
        _processBorrow(msg.sender, amount);
    }

    function emergencyPause(bool bypass) external onlyOwner {
        _toggleTrionBypass(bypass);
    }
}
```

The off-chain relayer must publish a SAFE signal for the txId before this call succeeds. The txId is:

```solidity
keccak256(abi.encode(address(this), msg.sender, msg.data, block.chainid))
```

---

## SDK

`sdk/index.ts` provides `TrionSDK.packSignal()` and `TrionSDK.unpackSignal()` for constructing and decoding the 256-bit signal format in TypeScript.

```typescript
import { TrionSDK } from "./sdk/index";

const packed = TrionSDK.packSignal(
    1,          // status: SAFE
    612000,     // coherence: 0.612 × 1e6
    603000,     // threshold: 0.603 × 1e6
    445200000,  // blockNum
    1774374460, // timestamp (unix seconds)
);

const fields = TrionSDK.unpackSignal(packed);
// { status: 1, coherence: 612000, threshold: 603000, ... }
```

---

## Security Model

**Threat model:** TRION assumes validators are honest and available. If all registered validators collude, they can publish false signals. This is mitigated by expanding the validator set and increasing the quorum threshold.

**Assumptions:**
- The L0 engine has an accurate view of Arbitrum's JSON-RPC state
- Validators sign only signals they independently verify
- The oracle contract address is not compromised at the key management level

**Known limitations:**
- A degraded RPC connection will produce stale L0 data; the relayer will not publish it, but the integrated contract will revert with `TRION_SignalStaleOrMissing` until a fresh signal is available
- The testnet configuration (quorum=1) does not provide Byzantine fault tolerance; mainnet requires quorum ≥ 3 with independent validators
- The 300-second freshness window means a signal from a prior normal state can potentially authorize a call during a brief anomaly spike, by design — this prevents excessive false positives during ordinary volatility

---

## Roadmap

| Phase | Status | Description |
|---|---|---|
| Testnet | Active | Single-validator on Arbitrum Sepolia, live L0 monitoring of Arbitrum mainnet |
| Validator expansion | Planned | Multi-party quorum with independent validator infrastructure |
| Mainnet | Planned | Production oracle deployment, protocol integrations |
| Threshold configuration | Planned | Per-protocol coherence thresholds configurable at the Guard level |

---

## License

CC0 — No rights reserved.
