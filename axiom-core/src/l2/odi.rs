//! Ontological Device Identity (ODI) — Invention #15.
//!
//! ODI gives every device a permanent behavioral identity from first boot.
//! Identity security grows continuously with device age and honest operation.
//!
//! ## Formula
//! ```text
//! ODI(device, t) = Blake3(
//!   genesis_event_hash             ||
//!   hardware_fingerprint           ||
//!   accumulated_depth: D(device,t) ||
//!   physical_entropy_seed          ||
//!   first_validator_attestation
//! )
//! ```

use crate::types::{BPI, GpsTimestampNs, UBHHash};
use serde::{Deserialize, Serialize};

/// Ontological Device Identity record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OntologicalDeviceIdentity {
    /// Current ODI hash (updates as depth accumulates).
    pub odi: BPI,
    /// Genesis event hash — hash of first boot UBH event.
    pub genesis_event_hash: UBHHash,
    /// Hardware fingerprint (CPU ID, MAC, TPM public key hash).
    pub hardware_fingerprint: UBHHash,
    /// Physical entropy seed from first boot.
    pub physical_entropy_seed: [u8; 32],
    /// First validator attestation signature.
    pub first_validator_attestation: [u8; 32],
    /// Accumulated Akashic Depth D(device, t).
    pub accumulated_depth: f64,
    /// Genesis timestamp (first boot).
    pub genesis_timestamp: GpsTimestampNs,
    /// Stolen flag — set by owner via TERMINATE event.
    pub is_stolen: bool,
}

impl OntologicalDeviceIdentity {
    /// Create an ODI at first boot.
    pub fn genesis(
        genesis_event_hash: UBHHash,
        hardware_fingerprint: UBHHash,
        physical_entropy_seed: [u8; 32],
        validator_attestation: [u8; 32],
        timestamp: GpsTimestampNs,
    ) -> Self {
        let odi = Self::compute_odi(
            &genesis_event_hash,
            &hardware_fingerprint,
            0.0,
            &physical_entropy_seed,
            &validator_attestation,
        );

        Self {
            odi,
            genesis_event_hash,
            hardware_fingerprint,
            physical_entropy_seed,
            first_validator_attestation: validator_attestation,
            accumulated_depth: 0.0,
            genesis_timestamp: timestamp,
            is_stolen: false,
        }
    }

    /// Recompute ODI after depth accumulation.
    pub fn update_depth(&mut self, new_depth: f64) {
        self.accumulated_depth = new_depth;
        self.odi = Self::compute_odi(
            &self.genesis_event_hash,
            &self.hardware_fingerprint,
            new_depth,
            &self.physical_entropy_seed,
            &self.first_validator_attestation,
        );
    }

    /// Mark device as stolen (issued by owner via verified BPI).
    pub fn mark_stolen(&mut self) {
        self.is_stolen = true;
    }

    fn compute_odi(
        genesis: &UBHHash,
        hw: &UBHHash,
        depth: f64,
        entropy_seed: &[u8; 32],
        attestation: &[u8; 32],
    ) -> BPI {
        let mut hasher = blake3::Hasher::new();
        hasher.update(genesis);
        hasher.update(hw);
        hasher.update(&depth.to_le_bytes());
        hasher.update(entropy_seed);
        hasher.update(attestation);
        *hasher.finalize().as_bytes()
    }

    /// Generate a hardware fingerprint from available device identifiers.
    pub fn compute_hardware_fingerprint(
        cpu_id: &[u8],
        mac_addresses: &[&[u8]],
        tpm_pubkey: Option<&[u8]>,
    ) -> UBHHash {
        let mut hasher = blake3::Hasher::new();
        hasher.update(cpu_id);
        for mac in mac_addresses {
            hasher.update(mac);
        }
        if let Some(tpm) = tpm_pubkey {
            hasher.update(tpm);
        }
        *hasher.finalize().as_bytes()
    }

    /// Detect if device has been cloned (cloned device has different genesis entropy).
    pub fn detect_clone(&self, claimed_genesis_hash: &UBHHash) -> bool {
        &self.genesis_event_hash != claimed_genesis_hash
    }

    /// Device age in seconds.
    pub fn age_seconds(&self, now: GpsTimestampNs) -> f64 {
        let age_ns = now.saturating_sub(self.genesis_timestamp);
        age_ns as f64 / 1_000_000_000.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_odi() -> OntologicalDeviceIdentity {
        OntologicalDeviceIdentity::genesis(
            [1u8; 32],
            [2u8; 32],
            [3u8; 32],
            [4u8; 32],
            1_000_000_000,
        )
    }

    #[test]
    fn odi_nonzero_at_genesis() {
        let odi = make_odi();
        assert_ne!(odi.odi, [0u8; 32]);
    }

    #[test]
    fn odi_changes_with_depth() {
        let mut odi = make_odi();
        let initial = odi.odi;
        odi.update_depth(1_000_000.0);
        assert_ne!(odi.odi, initial);
    }

    #[test]
    fn clone_detection_works() {
        let odi = make_odi();
        let fake_genesis = [99u8; 32];
        assert!(odi.detect_clone(&fake_genesis));
        assert!(!odi.detect_clone(&odi.genesis_event_hash));
    }
}
