//! Behavioral Process Identity (BPI) — Invention #10.
//!
//! BPI is a process identity scheme where each process's identifier
//! encodes its complete causal behavioral history from spawn to present.
//!
//! ## Formula
//! ```text
//! BPI(process, t) = Blake3(
//!   causal_history_root(process, t₀→t) ||
//!   spawner_BPI(t₀)                    ||
//!   purpose_declaration                ||
//!   Love_coefficient                   ||
//!   environmental_context_hash(t)
//! )
//! ```

use crate::types::{BPI, GpsTimestampNs, UBHHash};

/// Full BPI record for a process or entity.
#[derive(Debug, Clone)]
pub struct BehavioralProcessIdentity {
    /// Current BPI hash.
    pub bpi: BPI,
    /// BPI of the entity that spawned this process.
    pub spawner_bpi: BPI,
    /// Hash of the declared purpose of this entity.
    pub purpose_hash: UBHHash,
    /// Life-service coefficient Love ∈ [0, 1].
    pub love: f32,
    /// GPS timestamp of genesis (first spawn).
    pub genesis_timestamp: GpsTimestampNs,
    /// GPS timestamp of last BPI update.
    pub last_updated: GpsTimestampNs,
    /// Total events since genesis.
    pub total_events: u64,
    /// Update cycle counter.
    pub update_cycle: u64,
}

impl BehavioralProcessIdentity {
    /// Compute a new genesis BPI for a fresh entity.
    pub fn genesis(
        purpose: &str,
        love: f32,
        spawner_bpi: Option<BPI>,
        entropy: &[u8; 32],
        timestamp: GpsTimestampNs,
    ) -> Self {
        let spawner = spawner_bpi.unwrap_or([0u8; 32]);
        let purpose_hash = *blake3::hash(purpose.as_bytes()).as_bytes();

        let mut hasher = blake3::Hasher::new();
        hasher.update(entropy);
        hasher.update(&spawner);
        hasher.update(&purpose_hash);
        hasher.update(&love.to_le_bytes());
        hasher.update(&timestamp.to_le_bytes());
        let bpi = *hasher.finalize().as_bytes();

        Self {
            bpi,
            spawner_bpi: spawner,
            purpose_hash,
            love,
            genesis_timestamp: timestamp,
            last_updated: timestamp,
            total_events: 0,
            update_cycle: 0,
        }
    }

    /// Update BPI from causal history root (called every BPI_UPDATE_CYCLE events).
    pub fn update(
        &mut self,
        causal_history_root: &UBHHash,
        environment_hash: &UBHHash,
        timestamp: GpsTimestampNs,
    ) {
        let mut hasher = blake3::Hasher::new();
        hasher.update(causal_history_root);
        hasher.update(&self.spawner_bpi);
        hasher.update(&self.purpose_hash);
        hasher.update(&self.love.to_le_bytes());
        hasher.update(environment_hash);
        self.bpi = *hasher.finalize().as_bytes();
        self.last_updated = timestamp;
        self.update_cycle += 1;
    }

    /// Age in nanoseconds since genesis.
    pub fn age_ns(&self, now: GpsTimestampNs) -> u64 {
        now.saturating_sub(self.genesis_timestamp)
    }

    /// How many BPI update cycles have occurred.
    pub fn depth_cycles(&self) -> u64 {
        self.update_cycle
    }
}

/// Traditional PID comparison illustrating BPI superiority.
///
/// A Unix PID is just an integer: process 1234 at t=0 is identical
/// to process 1234 at t=1year. BPI encodes the full causal history.
pub struct TraditionalPID(pub u32);

impl TraditionalPID {
    /// Traditional PIDs contain zero behavioral history.
    pub fn behavioral_depth(&self) -> f64 { 0.0 }

    /// Traditional PIDs can be forged by starting a new process.
    pub fn is_forgeable(&self) -> bool { true }
}

impl BehavioralProcessIdentity {
    /// BPI contains the full causal history — depth accumulates.
    pub fn is_forgeable(&self) -> bool {
        // P(forge BPI(t)) → 0 as total_events → ∞
        self.total_events == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn genesis_bpi_is_nonzero() {
        let entropy = [1u8; 32];
        let bpi = BehavioralProcessIdentity::genesis("test process", 0.8, None, &entropy, 1_000_000);
        assert_ne!(bpi.bpi, [0u8; 32]);
    }

    #[test]
    fn bpi_updates_on_cycle() {
        let entropy = [1u8; 32];
        let mut bpi = BehavioralProcessIdentity::genesis("test", 0.8, None, &entropy, 1_000);
        let initial = bpi.bpi;
        let history_root = [2u8; 32];
        let env = [3u8; 32];
        bpi.update(&history_root, &env, 2_000);
        assert_ne!(bpi.bpi, initial);
    }

    #[test]
    fn spawner_context_affects_bpi() {
        let entropy = [1u8; 32];
        let no_spawner = BehavioralProcessIdentity::genesis("test", 0.8, None, &entropy, 1000);
        let with_spawner = BehavioralProcessIdentity::genesis("test", 0.8, Some([5u8; 32]), &entropy, 1000);
        assert_ne!(no_spawner.bpi, with_spawner.bpi);
    }
}
