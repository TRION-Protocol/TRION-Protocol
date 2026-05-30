/**
 * AXIOM TypeScript SDK — Core Types
 *
 * All types mirror the Rust types in axiom-core/src/types.rs.
 */

/** 32-byte Behavioral Process Identity (as hex string). */
export type BPI = string;

/** 32-byte Blake3 hash (as hex string). */
export type UBHHash = string;

/** GPS timestamp in nanoseconds. */
export type GpsTimestampNs = bigint;

/** The 32 Universal Behavioral Event types. */
export enum UBEType {
    Transfer    = 1,
    Swap        = 2,
    Liquidity   = 3,
    Stake       = 4,
    Unstake     = 5,
    Governance  = 6,
    Proposal    = 7,
    Borrow      = 8,
    Repay       = 9,
    Liquidate   = 10,
    Bridge      = 11,
    Deploy      = 12,
    Upgrade     = 13,
    Mint        = 14,
    Burn        = 15,
    OracleUpdate = 16,
    MevCapture  = 17,
    FlashLoan   = 18,
    Airdrop     = 19,
    Claim       = 20,
    Execute     = 21,
    Read        = 22,
    Write       = 23,
    Spawn       = 24,
    Terminate   = 25,
    Communicate = 26,
    Sense       = 27,
    Actuate     = 28,
    Learn       = 29,
    Decide      = 30,
    Authenticate = 31,
    Transform   = 32,
}

export const UBE_TYPE_NAMES: Record<UBEType, string> = {
    [UBEType.Transfer]:    'TRANSFER',
    [UBEType.Swap]:        'SWAP',
    [UBEType.Liquidity]:   'LIQUIDITY',
    [UBEType.Stake]:       'STAKE',
    [UBEType.Unstake]:     'UNSTAKE',
    [UBEType.Governance]:  'GOVERNANCE',
    [UBEType.Proposal]:    'PROPOSAL',
    [UBEType.Borrow]:      'BORROW',
    [UBEType.Repay]:       'REPAY',
    [UBEType.Liquidate]:   'LIQUIDATE',
    [UBEType.Bridge]:      'BRIDGE',
    [UBEType.Deploy]:      'DEPLOY',
    [UBEType.Upgrade]:     'UPGRADE',
    [UBEType.Mint]:        'MINT',
    [UBEType.Burn]:        'BURN',
    [UBEType.OracleUpdate]: 'ORACLE_UPDATE',
    [UBEType.MevCapture]:  'MEV_CAPTURE',
    [UBEType.FlashLoan]:   'FLASH_LOAN',
    [UBEType.Airdrop]:     'AIRDROP',
    [UBEType.Claim]:       'CLAIM',
    [UBEType.Execute]:     'EXECUTE',
    [UBEType.Read]:        'READ',
    [UBEType.Write]:       'WRITE',
    [UBEType.Spawn]:       'SPAWN',
    [UBEType.Terminate]:   'TERMINATE',
    [UBEType.Communicate]: 'COMMUNICATE',
    [UBEType.Sense]:       'SENSE',
    [UBEType.Actuate]:     'ACTUATE',
    [UBEType.Learn]:       'LEARN',
    [UBEType.Decide]:      'DECIDE',
    [UBEType.Authenticate]: 'AUTHENTICATE',
    [UBEType.Transform]:   'TRANSFORM',
};

/** Universal Behavioral Hash — the atomic unit of AXIOM. */
export interface UniversalBehavioralHash {
    entityBpi:       BPI;
    eventType:       UBEType;
    eventSubtype:    number;
    priorHash:       UBHHash;
    causalContext:   UBHHash;
    gpsTimestamp:    GpsTimestampNs;
    deviceTimestamp: GpsTimestampNs;
    environmentHash: UBHHash;
    eventPayload:    Uint8Array;
    entropyProof:    UBHHash;
    validatorSig:    UBHHash;
    selfHash:        UBHHash;
    bcAtEvent:       number;
    depthAtEvent:    number;
}

/** Five-plane coherence scores. */
export interface CoherencePlanes {
    phi:   number;  // Φ: Causal Flux ∈ [0,1]
    mu:    number;  // M: Model Confidence ∈ [0,1]
    sigma: number;  // Σ: Network Consensus ∈ [0,1]
    kappa: number;  // K: Environmental Context ∈ [0,1]
    alpha: number;  // A: Adaptive Intelligence ∈ [0,1]
}

/** SILENCE state of an entity. */
export enum SilenceState {
    Operational = 'operational',
    Silenced    = 'silenced',
    Recovering  = 'recovering',
}

/** Entity truth state — full Ξ(entity, t) snapshot. */
export interface TruthState {
    entityBpi:    BPI;
    xi:           number;    // Ξ(entity, t) — behavioral truth value
    bc:           number;    // BC ∈ [0, 1]
    psi:          number;    // Ψ threshold ∈ [0, 1]
    depth:        number;    // D(entity, t) — Akashic Depth
    silence:      SilenceState;
    love:         number;    // Love coefficient ∈ [0, 1]
    gpsTimestamp: GpsTimestampNs;
    planes?:      CoherencePlanes;
}

/** BIS interrupt level. */
export enum BISLevel {
    Normal = 0,
    L1     = 1,  // Informational — log to Akashic
    L2     = 2,  // Warning — alert coherence engine
    L3     = 3,  // Critical — invoke IKP INNATE_LAYER
    L4     = 4,  // Emergency — SILENCE immediately
}

/** Behavioral Interrupt payload. */
export interface BISInterrupt {
    entityBpi:          BPI;
    trajScore:          number;
    level:              BISLevel;
    anomalySequence:    UBEType[];
    expectedSequence:   UBEType[];
    bcAtInterrupt:      number;
    depthAtInterrupt:   number;
    gpsTimestamp:       GpsTimestampNs;
    causalContext:      UBHHash;
}

/** Entity role for Λ (moat rate) computation. */
export enum EntityRole {
    KernelComponent   = 'kernel_component',
    UserProcess       = 'user_process',
    NetworkDaemon     = 'network_daemon',
    SensorIoT         = 'sensor_iot',
    HumanUser         = 'human_user',
    BlockchainOracle  = 'blockchain_oracle',
    AiModel           = 'ai_model',
    Institution       = 'institution',
    BiologicalOrganism = 'biological_organism',
}

/** RCP packet — the routing unit in the Resonance Network. */
export interface RCPPacket {
    senderBpi:   BPI;
    receiverBpi: BPI;
    ttl:         number;
    payload:     Uint8Array;
    timestamp:   GpsTimestampNs;
    senderBc:    number;
    signature:   UBHHash;
}

/** BEO resolution confidence score. */
export interface BEOConfidence {
    score: number;   // ∈ [0, 1]
    isSameEntity: boolean;     // score > 0.75
    isDistinctEntity: boolean; // score < 0.30
    isAmbiguous: boolean;
}

/** BEO resolution result. */
export type BEOResult =
    | { type: 'same';     confidence: number }
    | { type: 'distinct'; confidence: number }
    | { type: 'ambiguous'; confidence: number };

/** Resonance frequency vector — 32-dimensional UBE frequency distribution. */
export type ResonanceVector = Float32Array;  // length = 32

/** AXIOM node health status. */
export interface NodeHealth {
    status: 'healthy' | 'degraded' | 'silenced';
    localBc: number;
    localPsi: number;
    isSilenced: boolean;
    connectedPeers: number;
    packetsRouted: number;
    packetsDropped: number;
    entitiesTracked: number;
}
