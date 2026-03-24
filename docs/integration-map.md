# TRION V3 — Integration Architecture

This document maps the full execution path from Arbitrum block data through the off-chain engine to on-chain enforcement.

```
Arbitrum Sequencer
  │
  │  block_by_number (JSON-RPC, ~250 ms)
  ▼
trion-l0 (Rust L0 Engine)
  ├── Extract 8 behavioral features per block (f1–f8)
  ├── Compute C(t) = mean(f1..f8)
  ├── Update EMA baseline μ(t)
  ├── Evaluate: anomaly = (μ(t) - C(t)) / μ(t) > 0.15
  └── Write /tmp/trion_latest.json
  │
  │  File read, every 12 s
  ▼
artifacts/api-server (relayer.ts)
  ├── Determine signalType: SAFE | WARN | SILENCE
  ├── Pack into uint256 (TrionSDK.packSignal)
  ├── Derive txId = keccak256(abi.encode(blockNumber))
  ├── Sign with EIP-191 personal_sign
  └── Call TRIONOracleV3.publishSignal(txId, packedData, [sig])
  │
  │  On-chain, Arbitrum Sepolia
  ▼
TRIONOracleV3
  ├── Verify quorum signatures (sorted, no duplicates)
  ├── Store signals[txId] = Signal(packedData, initialized=true)
  └── Emit ThermodynamicSignalEtched
  │
  │  At transaction time
  ▼
TRIONGuardV3 (onlyWhenCoherent modifier)
  ├── Derive txId = keccak256(abi.encode(address(this), msg.sender, msg.data, chainId))
  ├── Call oracle.verifyExecution(txId)
  │     └── Returns (isSafe, coherence, threshold)
  │           isSafe = status==1 && timestamp fresh (<300s) && block bound (<50 blocks)
  ├── isSafe == true  → proceed
  └── isSafe == false → revert TRION_ExecutionBlocked(coherence, threshold)
```

## Packed Signal Layout

| Bits    | Field      | Notes                          |
|---------|------------|-------------------------------|
| 0–7     | status     | 1=SAFE, 2=WARN, 3=SILENCE     |
| 8–39    | coherence  | C(t) × 1e6, uint32            |
| 40–71   | threshold  | Θ(t) × 1e6, uint32            |
| 72–135  | blockNum   | uint64                        |
| 136–199 | timestamp  | Unix seconds, uint64          |
| 200–255 | (reserved) |                               |

## txId Binding

The txId links a specific transaction to its pre-published signal. It is computed identically off-chain (by the relayer) and on-chain (by the Guard modifier). Any deviation in the call context — different caller, different calldata, different chain — produces a different txId and the corresponding signal will not be found.

## Signal Freshness

`verifyExecution` enforces two staleness bounds:
- **Timestamp bound**: signal must be less than 300 seconds old
- **Block bound**: signal must have been published within the last 50 blocks

These bounds prevent replaying valid signals from earlier network states.
