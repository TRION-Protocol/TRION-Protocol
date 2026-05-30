//! L0 physical attestation — SGX, TrustZone, TPM 2.0.
//!
//! Validator nodes run hardware attestation to prove their physical
//! environment has not been manipulated. Events signed by physically-attested
//! validators carry higher Σ (Sigma) plane weight.

use crate::types::{GpsTimestampNs, UBHHash};
use serde::{Deserialize, Serialize};

/// Hardware attestation report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttestationReport {
    /// Attestation technology used.
    pub attestation_type: AttestationType,
    /// Hash of the code running inside the trusted environment.
    pub code_measurement: UBHHash,
    /// Timestamp when attestation was performed.
    pub attested_at: GpsTimestampNs,
    /// Raw attestation quote bytes (SGX quote / TrustZone token / TPM PCR).
    pub quote: Vec<u8>,
    /// Signature over the quote.
    pub signature: Vec<u8>,
    /// Whether attestation was verified successfully.
    pub verified: bool,
}

/// Attestation technology.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AttestationType {
    /// Intel SGX remote attestation.
    IntelSGX,
    /// ARM TrustZone attestation.
    ArmTrustZone,
    /// TPM 2.0 Platform Configuration Register attestation.
    Tpm2,
    /// Software simulation (testing only — no security guarantees).
    Simulation,
    /// No attestation available.
    None,
}

/// Verify causal chain continuity.
///
/// Checks: UBH[n].prior_hash == UBH[n-1].self_hash for all events.
/// This implements Cross-Layer Invariant I5.
pub fn verify_continuity(
    events: &[crate::types::UniversalBehavioralHash],
    expected_first_prior: &UBHHash,
) -> ContinuityResult {
    if events.is_empty() {
        return ContinuityResult::Empty;
    }

    // First event's prior_hash must match expected
    if &events[0].prior_hash != expected_first_prior {
        return ContinuityResult::Broken { at_index: 0 };
    }

    // Each subsequent event's prior_hash must equal previous self_hash
    for i in 1..events.len() {
        if events[i].prior_hash != events[i - 1].self_hash {
            return ContinuityResult::Broken { at_index: i };
        }
        // Also verify self_hash integrity
        if !events[i].verify_self_hash() {
            return ContinuityResult::HashInvalid { at_index: i };
        }
    }

    ContinuityResult::Valid
}

/// Result of causal chain continuity check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ContinuityResult {
    /// Chain is valid.
    Valid,
    /// Chain is empty.
    Empty,
    /// Chain is broken at this index.
    Broken { at_index: usize },
    /// Self-hash is invalid at this index (tamper detected).
    HashInvalid { at_index: usize },
}

impl ContinuityResult {
    pub fn is_valid(&self) -> bool {
        matches!(self, Self::Valid | Self::Empty)
    }
}

/// Produce a simulation attestation report (for testing / development nodes).
pub fn simulate_attestation(code_hash: UBHHash, timestamp: GpsTimestampNs) -> AttestationReport {
    let mut hasher = blake3::Hasher::new();
    hasher.update(&code_hash);
    hasher.update(&timestamp.to_le_bytes());
    let sig = hasher.finalize();

    AttestationReport {
        attestation_type: AttestationType::Simulation,
        code_measurement: code_hash,
        attested_at: timestamp,
        quote: code_hash.to_vec(),
        signature: sig.as_bytes().to_vec(),
        verified: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::l0::entropy::SimulationEntropySource;
    use crate::l1::ubh::UBHEngine;
    use crate::l0::entropy::EntropySource;

    #[test]
    fn continuity_valid_chain() {
        let entropy = SimulationEntropySource::from_u64(1);
        let genesis_bpi = [1u8; 32];
        let mut engine = UBHEngine::new(genesis_bpi, Box::new(SimulationEntropySource::from_u64(1)));

        let e1 = engine.emit_event(crate::types::UBEType::Spawn, vec![]);
        let e2 = engine.emit_event(crate::types::UBEType::Execute, vec![]);
        let e3 = engine.emit_event(crate::types::UBEType::Write, vec![]);

        let genesis_hash = [0u8; 32];
        let result = verify_continuity(&[e1, e2, e3], &genesis_hash);
        assert_eq!(result, ContinuityResult::Valid);
    }

    #[test]
    fn simulation_attestation_is_verified() {
        let code_hash = [42u8; 32];
        let report = simulate_attestation(code_hash, 1_000_000_000);
        assert!(report.verified);
        assert_eq!(report.attestation_type, AttestationType::Simulation);
    }
}
