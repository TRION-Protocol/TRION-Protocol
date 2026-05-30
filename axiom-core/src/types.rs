//! Core AXIOM data types used across all layers.

use serde::{Deserialize, Serialize};

/// Behavioral Process Identity — 32-byte causal history hash.
pub type BPI = [u8; 32];

/// Universal Behavioral Hash self-hash — 32 bytes (Blake3).
pub type UBHHash = [u8; 32];

/// Timestamp in nanoseconds since GPS epoch.
pub type GpsTimestampNs = u64;

/// The 32 Universal Behavioral Event types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum UBEType {
    // Category 1 — Value/Resource operations (from TRION)
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

    // Category 2 — AXIOM Universal Extension
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

impl UBEType {
    /// Convert from u8 representation.
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            1  => Some(Self::Transfer),
            2  => Some(Self::Swap),
            3  => Some(Self::Liquidity),
            4  => Some(Self::Stake),
            5  => Some(Self::Unstake),
            6  => Some(Self::Governance),
            7  => Some(Self::Proposal),
            8  => Some(Self::Borrow),
            9  => Some(Self::Repay),
            10 => Some(Self::Liquidate),
            11 => Some(Self::Bridge),
            12 => Some(Self::Deploy),
            13 => Some(Self::Upgrade),
            14 => Some(Self::Mint),
            15 => Some(Self::Burn),
            16 => Some(Self::OracleUpdate),
            17 => Some(Self::MevCapture),
            18 => Some(Self::FlashLoan),
            19 => Some(Self::Airdrop),
            20 => Some(Self::Claim),
            21 => Some(Self::Execute),
            22 => Some(Self::Read),
            23 => Some(Self::Write),
            24 => Some(Self::Spawn),
            25 => Some(Self::Terminate),
            26 => Some(Self::Communicate),
            27 => Some(Self::Sense),
            28 => Some(Self::Actuate),
            29 => Some(Self::Learn),
            30 => Some(Self::Decide),
            31 => Some(Self::Authenticate),
            32 => Some(Self::Transform),
            _ => None,
        }
    }

    /// Category name for this event type.
    pub fn category(&self) -> &'static str {
        match self {
            Self::Transfer | Self::Swap | Self::Liquidity | Self::Stake |
            Self::Unstake | Self::Borrow | Self::Repay | Self::Liquidate |
            Self::Mint | Self::Burn | Self::Airdrop | Self::Claim => "value_resource",

            Self::Read | Self::Write | Self::OracleUpdate |
            Self::Communicate | Self::Sense => "information",

            Self::Deploy | Self::Upgrade | Self::Spawn |
            Self::Terminate | Self::Bridge => "entity_lifecycle",

            Self::Governance | Self::Proposal | Self::Decide |
            Self::Authenticate => "coordination",

            Self::Execute | Self::Transform | Self::FlashLoan |
            Self::MevCapture => "computational",

            Self::Learn | Self::Actuate => "adaptive",
        }
    }
}

/// The Universal Behavioral Hash (UBH) — the atomic unit of AXIOM.
///
/// Every behavioral event generates one UBH record.
/// Records are immutable once written (Append Invariant I1).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UniversalBehavioralHash {
    // Identity (32 bytes)
    pub entity_bpi: BPI,

    // Event (2 bytes)
    pub event_type: UBEType,
    pub event_subtype: u8,

    // Causal chain (64 bytes)
    pub prior_hash: UBHHash,
    pub causal_context: UBHHash,

    // Temporal (16 bytes)
    pub gps_timestamp: GpsTimestampNs,
    pub device_timestamp: GpsTimestampNs,

    // Environmental (32 bytes)
    pub environment_hash: UBHHash,

    // Content (variable, max 4KB)
    pub event_payload: Vec<u8>,

    // Proof (64 bytes)
    pub entropy_proof: UBHHash,
    pub validator_sig: UBHHash,

    // Self-hash (32 bytes) — Blake3 of all above fields
    pub self_hash: UBHHash,

    // Derived (not stored, computed)
    pub bc_at_event: f32,
    pub depth_at_event: f64,
}

impl UniversalBehavioralHash {
    /// Verify the causal chain property: self_hash is Blake3 of all other fields.
    pub fn verify_self_hash(&self) -> bool {
        let computed = self.compute_self_hash();
        computed == self.self_hash
    }

    /// Compute the self_hash over all fields except self_hash itself.
    pub fn compute_self_hash(&self) -> UBHHash {
        let mut hasher = blake3::Hasher::new();
        hasher.update(&self.entity_bpi);
        hasher.update(&[self.event_type as u8, self.event_subtype]);
        hasher.update(&self.prior_hash);
        hasher.update(&self.causal_context);
        hasher.update(&self.gps_timestamp.to_le_bytes());
        hasher.update(&self.device_timestamp.to_le_bytes());
        hasher.update(&self.environment_hash);
        hasher.update(&self.event_payload);
        hasher.update(&self.entropy_proof);
        hasher.update(&self.validator_sig);
        *hasher.finalize().as_bytes()
    }

    /// Verify this event links correctly to the prior event.
    pub fn verify_chain_link(&self, prior: &UniversalBehavioralHash) -> bool {
        self.prior_hash == prior.self_hash
    }
}

/// Five-plane coherence scores.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct CoherencePlanes {
    /// Φ — Causal Flux / Entropy
    pub phi: f32,
    /// M — Model Confidence
    pub mu: f32,
    /// Σ — Network Consensus
    pub sigma: f32,
    /// K — Environmental Context
    pub kappa: f32,
    /// A — Adaptive Intelligence
    pub alpha: f32,
}

impl CoherencePlanes {
    /// Compute BC(entity, t) from five planes.
    pub fn behavioral_coherence(&self) -> f32 {
        let w = crate::PLANE_WEIGHTS;
        (w[0] * self.phi + w[1] * self.mu + w[2] * self.sigma
            + w[3] * self.kappa + w[4] * self.alpha)
            .clamp(0.0, 1.0)
    }
}

/// Role multipliers for Λ(entity) computation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum EntityRole {
    KernelComponent,
    UserProcess,
    NetworkDaemon,
    SensorIoT,
    HumanUser,
    BlockchainOracle,
    AiModel,
    Institution,
    BiologicalOrganism,
}

impl EntityRole {
    /// Role multiplier for Λ(entity).
    pub fn multiplier(&self) -> f64 {
        match self {
            Self::KernelComponent   => 2.0,
            Self::NetworkDaemon     => 1.5,
            Self::HumanUser         => 1.2,
            Self::UserProcess       => 1.0,
            Self::BlockchainOracle  => 1.0,
            Self::AiModel           => 1.0,
            Self::Institution       => 0.9,
            Self::SensorIoT         => 0.8,
            Self::BiologicalOrganism => 0.7,
        }
    }
}

/// SILENCE state of an entity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SilenceState {
    /// BC ≥ Ψ — entity is operational.
    Operational,
    /// BC < Ψ — entity is silenced (no output).
    Silenced,
    /// BC recovering — in sustained window before SILENCE lifts.
    Recovering { events_remaining: u64 },
}

/// Behavioral Interrupt levels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BISLevel {
    /// TRAJ < 1σ — normal operation.
    Normal,
    /// TRAJ ≥ 1σ — informational, log to Akashic Index.
    L1,
    /// TRAJ ≥ 2σ — warning, alert coherence engine.
    L2,
    /// TRAJ ≥ 3σ — critical, invoke IKP INNATE_LAYER.
    L3,
    /// TRAJ ≥ 5σ — emergency, SILENCE entity immediately.
    L4,
}

impl BISLevel {
    /// Classify a trajectory anomaly score into a BIS level.
    pub fn from_traj_score(score: f32) -> Self {
        if score >= 5.0 { Self::L4 }
        else if score >= 3.0 { Self::L3 }
        else if score >= 2.0 { Self::L2 }
        else if score >= 1.0 { Self::L1 }
        else { Self::Normal }
    }
}

/// A Behavioral Interrupt payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BISInterrupt {
    pub entity_bpi: BPI,
    pub traj_score: f32,
    pub level: BISLevel,
    pub anomaly_sequence: Vec<UBEType>,
    pub expected_sequence: Vec<UBEType>,
    pub bc_at_interrupt: f32,
    pub depth_at_interrupt: f64,
    pub gps_timestamp: GpsTimestampNs,
    pub causal_context: UBHHash,
}

/// Entity truth state — full Ξ(entity, t) snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TruthState {
    pub entity_bpi: BPI,
    pub xi: f64,
    pub bc: f32,
    pub psi: f32,
    pub depth: f64,
    pub silence: SilenceState,
    pub gps_timestamp: GpsTimestampNs,
    pub love: f32,
    pub role: EntityRole,
}

impl TruthState {
    /// Compute Ξ(entity, t) from this truth state.
    pub fn xi(&self) -> f64 {
        let lambda = crate::living_moat(self.role.multiplier(), self.love);
        crate::master_equation(self.bc, self.psi, 1.0, lambda, self.depth)
    }
}
