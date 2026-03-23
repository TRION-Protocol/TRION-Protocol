# TRION V3.0 Integration Architecture

This diagram maps the exact flow of thermodynamic truth from the L2 state, into the Rust anomaly detection engine, through the 256-bit SDK packer, signed by the BFT Quorum, and enforced by the on-chain smart contract modifier.

```mermaid
sequenceDiagram
    autonumber
    participant RPC as Arbitrum Sequencer
    participant L0 as L0/L1 Rust Engine
    participant SDK as TrionSDK (Packer)
    participant Val as Validator Quorum
    participant L2 as TRIONOracleV3
    participant Guard as TRIONGuardV3
    participant Vault as Protected Protocol

    %% Phase 1: Ingestion & Analysis
    RPC->>L0: Stream Blocks (Async/WebSocket)
    L0->>L0: Compute C(t) & Dynamic Threshold Θ(t)
    L0->>L0: Evaluate Anomaly (C(t) < 0.7 * Θ(t))
    
    %% Phase 2: Packing & Consensus
    L0->>SDK: Pass (Status, C(t), Θ(t), BlockNum, Timestamp)
    SDK->>SDK: Bitwise Pack -> 256-bit uint256
    SDK->>Val: Broadcast Packed Signal
    Val->>Val: EIP-191 Sign Domain-Separated Hash
    
    %% Phase 3: On-Chain Etching
    Val->>L2: publishSignal(txId, packedData, signatures[])
    L2->>L2: Verify Quorum (2/n) & Order
    L2->>L2: Store Signal & Emit Event
    
    %% Phase 4: Pre-Execution Interception
    Attacker->>Vault: simulate flashLoanAttack()
    Vault->>Guard: Trigger onlyWhenCoherent modifier
    Guard->>Guard: Generate internal bound txId
    Guard->>L2: verifyExecution(txId)
    L2-->>Guard: Returns (isSafe, C, Θ)
    
    alt isSafe == false (Thermodynamic Collapse)
        Guard-->>Vault: REVERT TRION_ExecutionBlocked
        Vault-->>Attacker: Wallet Greys Out Confirm Button
    else isSafe == true (Network Nominal)
        Guard-->>Vault: Proceed with Execution
    end
```
