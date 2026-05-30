//! Universal Behavioral Hash engine implementation.

use crate::l0::entropy::EntropySource;
use crate::types::{BPI, UniversalBehavioralHash, UBEType, UBHHash, GpsTimestampNs};

/// Type alias for BPI — 32-byte behavioral process identity hash (re-export).
pub type BPIHash = BPI;

/// The Universal Behavioral Hash engine for one entity.
///
/// Manages the entity's BPI, prior hash chain, and event count.
/// Emits UBH records for every behavioral event.
pub struct UBHEngine {
    entity_bpi: BPIHash,
    prior_hash: UBHHash,
    event_count: u64,
    spawner_bpi: BPIHash,
    purpose_hash: UBHHash,
    love: f32,
    entropy_src: Box<dyn EntropySource>,
    recent_prior_hashes: Vec<UBHHash>,
}

impl UBHEngine {
    /// Create a new UBH engine for an entity.
    ///
    /// # Arguments
    /// * `genesis_bpi` — The BPI at entity spawn (genesis hash).
    /// * `entropy_src` — L0 entropy source.
    pub fn new(genesis_bpi: BPIHash, entropy_src: Box<dyn EntropySource>) -> Self {
        Self {
            entity_bpi: genesis_bpi,
            prior_hash: [0u8; 32],  // Genesis: prior hash is all zeros
            event_count: 0,
            spawner_bpi: [0u8; 32],
            purpose_hash: [0u8; 32],
            love: 1.0,
            entropy_src,
            recent_prior_hashes: Vec::with_capacity(1001),
        }
    }

    /// Create with full spawner context.
    pub fn with_spawner(
        genesis_bpi: BPIHash,
        spawner_bpi: BPIHash,
        purpose: &str,
        love: f32,
        entropy_src: Box<dyn EntropySource>,
    ) -> Self {
        let purpose_hash = *blake3::hash(purpose.as_bytes()).as_bytes();
        Self {
            entity_bpi: genesis_bpi,
            prior_hash: [0u8; 32],
            event_count: 0,
            spawner_bpi,
            purpose_hash,
            love,
            entropy_src,
            recent_prior_hashes: Vec::with_capacity(1001),
        }
    }

    /// Emit a behavioral event, returning the UBH record.
    ///
    /// This is the core L1 operation. Called for every entity action.
    pub fn emit_event(&mut self, event_type: UBEType, payload: Vec<u8>) -> UniversalBehavioralHash {
        self.emit_event_subtyped(event_type, 0, payload)
    }

    /// Emit a behavioral event with subtype.
    pub fn emit_event_subtyped(
        &mut self,
        event_type: UBEType,
        event_subtype: u8,
        payload: Vec<u8>,
    ) -> UniversalBehavioralHash {
        let gps_timestamp = self.entropy_src.gps_timestamp_ns();
        let device_timestamp = system_time_ns();
        let entropy_proof = self.entropy_src.combined_entropy();
        let environment_hash = self.compute_environment_hash();
        let causal_context = self.compute_causal_context();

        let mut ubh = UniversalBehavioralHash {
            entity_bpi: self.entity_bpi,
            event_type,
            event_subtype,
            prior_hash: self.prior_hash,
            causal_context,
            gps_timestamp,
            device_timestamp,
            environment_hash,
            event_payload: payload,
            entropy_proof,
            validator_sig: [0u8; 32],  // Filled by validator layer
            self_hash: [0u8; 32],      // Computed below
            bc_at_event: 0.0,
            depth_at_event: 0.0,
        };

        // Compute self_hash over all fields except self_hash
        let self_hash = ubh.compute_self_hash();
        ubh.self_hash = self_hash;

        // Update chain
        self.recent_prior_hashes.push(self.prior_hash);
        if self.recent_prior_hashes.len() > 1000 {
            self.recent_prior_hashes.remove(0);
        }
        self.prior_hash = self_hash;
        self.event_count += 1;

        // Update BPI every BPI_UPDATE_CYCLE events
        if self.event_count % crate::BPI_UPDATE_CYCLE == 0 {
            self.entity_bpi = self.compute_bpi();
        }

        ubh
    }

    /// Compute the Behavioral Process Identity.
    ///
    /// BPI = Blake3(history_root || spawner_bpi || purpose_hash || love || env_hash)
    pub fn compute_bpi(&self) -> BPIHash {
        let history_root = self.merkle_root_of_recent_hashes();
        let love_bytes = self.love.to_le_bytes();
        let env_hash = self.compute_environment_hash();

        let mut hasher = blake3::Hasher::new();
        hasher.update(&history_root);
        hasher.update(&self.spawner_bpi);
        hasher.update(&self.purpose_hash);
        hasher.update(&love_bytes);
        hasher.update(&env_hash);
        *hasher.finalize().as_bytes()
    }

    /// Get current BPI.
    pub fn current_bpi(&self) -> BPIHash {
        self.entity_bpi
    }

    /// Get current event count (proxy for depth at L1).
    pub fn event_count(&self) -> u64 {
        self.event_count
    }

    /// Set BC and depth on the last emitted event's metadata.
    pub fn set_love(&mut self, love: f32) {
        self.love = love.clamp(0.0, 1.0);
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    fn compute_environment_hash(&self) -> UBHHash {
        // Environment hash encodes current system state
        let ts = system_time_ns();
        let event_count = self.event_count;
        let mut hasher = blake3::Hasher::new();
        hasher.update(&ts.to_le_bytes());
        hasher.update(&event_count.to_le_bytes());
        hasher.update(&self.entity_bpi);
        *hasher.finalize().as_bytes()
    }

    fn compute_causal_context(&self) -> UBHHash {
        // Causal context: hash of the last N prior hashes (causal chain summary)
        let mut hasher = blake3::Hasher::new();
        for h in self.recent_prior_hashes.iter().rev().take(10) {
            hasher.update(h);
        }
        hasher.update(&self.prior_hash);
        *hasher.finalize().as_bytes()
    }

    fn merkle_root_of_recent_hashes(&self) -> UBHHash {
        if self.recent_prior_hashes.is_empty() {
            return [0u8; 32];
        }
        // Simple binary Merkle tree over recent prior hashes
        let mut level: Vec<UBHHash> = self.recent_prior_hashes.clone();
        while level.len() > 1 {
            let mut next = Vec::with_capacity((level.len() + 1) / 2);
            for pair in level.chunks(2) {
                let mut hasher = blake3::Hasher::new();
                hasher.update(&pair[0]);
                if pair.len() > 1 {
                    hasher.update(&pair[1]);
                } else {
                    hasher.update(&pair[0]); // duplicate for odd count
                }
                next.push(*hasher.finalize().as_bytes());
            }
            level = next;
        }
        level[0]
    }
}

fn system_time_ns() -> GpsTimestampNs {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64
}

/// Genesis BPI for the AXIOM system entity itself.
pub fn axiom_genesis_bpi() -> BPIHash {
    *blake3::hash(b"AXIOM:GENESIS:2026:BEHAVIORAL:TRUTH").as_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::l0::entropy::SimulationEntropySource;

    fn make_engine() -> UBHEngine {
        let bpi = axiom_genesis_bpi();
        UBHEngine::new(bpi, Box::new(SimulationEntropySource::from_u64(42)))
    }

    #[test]
    fn ubh_self_hash_valid() {
        let mut engine = make_engine();
        let ubh = engine.emit_event(UBEType::Execute, vec![1, 2, 3]);
        assert!(ubh.verify_self_hash());
    }

    #[test]
    fn ubh_chain_links_correctly() {
        let mut engine = make_engine();
        let e1 = engine.emit_event(UBEType::Spawn, vec![]);
        let e2 = engine.emit_event(UBEType::Execute, vec![]);
        assert_eq!(e2.prior_hash, e1.self_hash);
    }

    #[test]
    fn bpi_updates_every_cycle() {
        let mut engine = make_engine();
        let initial_bpi = engine.current_bpi();
        for i in 0..crate::BPI_UPDATE_CYCLE {
            engine.emit_event(UBEType::Execute, vec![i as u8]);
        }
        let updated_bpi = engine.current_bpi();
        assert_ne!(initial_bpi, updated_bpi);
    }

    #[test]
    fn event_count_increments() {
        let mut engine = make_engine();
        assert_eq!(engine.event_count(), 0);
        engine.emit_event(UBEType::Read, vec![]);
        engine.emit_event(UBEType::Write, vec![]);
        assert_eq!(engine.event_count(), 2);
    }
}
