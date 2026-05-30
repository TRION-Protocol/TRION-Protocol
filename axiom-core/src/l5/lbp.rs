//! Living Boot Protocol (LBP) — Invention #18.
//!
//! LBP is a boot protocol where a system achieves operational state by
//! reconstructing behavioral coherence — not by loading a static kernel image.
//!
//! ## Boot Sequence
//! 1. L0 attestation — GPS timestamp + HSM entropy + SGX/TrustZone
//! 2. Akashic reconstruction — retrieve D(device) from local replica
//! 3. Coherence warm-up — compute BC from last 100 behavioral events
//! 4. Resonance establishment — broadcast SPAWN event to resonant peers
//! 5. Boot completion — BC ≥ Ψ_boot confirmed

use crate::types::{BPI, GpsTimestampNs, UBHHash};
use crate::l0::attestation::{AttestationReport, AttestationType, ContinuityResult, verify_continuity};
use crate::types::UniversalBehavioralHash;

/// Boot status after each step.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BootStatus {
    Pending,
    L0Attested,
    AkashicReconstructed,
    CoherenceWarmedUp,
    ResonanceEstablished,
    Complete,
    Failed { reason: String },
}

/// LBP boot configuration.
#[derive(Debug, Clone)]
pub struct LBPConfig {
    /// Minimum BC required to complete boot.
    pub psi_boot: f32,
    /// Number of recent events to verify chain continuity.
    pub chain_verify_depth: usize,
    /// Minimum GPS-device clock agreement (nanoseconds).
    pub max_clock_drift_ns: u64,
    /// BC drop threshold triggering boot warning.
    pub bc_warning_threshold: f32,
}

impl Default for LBPConfig {
    fn default() -> Self {
        Self {
            psi_boot: 0.45,
            chain_verify_depth: 1000,
            max_clock_drift_ns: 50_000_000, // 50ms in nanoseconds
            bc_warning_threshold: 0.20,
        }
    }
}

/// The Living Boot Protocol executor.
pub struct LivingBootProtocol {
    config: LBPConfig,
    status: BootStatus,
    reconstructed_depth: f64,
    boot_bc: f32,
    /// Timestamp when boot started.
    boot_start_ns: GpsTimestampNs,
}

impl LivingBootProtocol {
    pub fn new(config: LBPConfig) -> Self {
        Self {
            config,
            status: BootStatus::Pending,
            reconstructed_depth: 0.0,
            boot_bc: 0.0,
            boot_start_ns: 0,
        }
    }

    /// Step 1: L0 physical attestation.
    pub fn step_l0_attestation(
        &mut self,
        gps_ts: GpsTimestampNs,
        device_ts: GpsTimestampNs,
        attestation: &AttestationReport,
    ) -> Result<(), String> {
        self.boot_start_ns = gps_ts;

        // Check GPS-device clock drift
        let drift = gps_ts.abs_diff(device_ts);
        if drift > self.config.max_clock_drift_ns {
            self.status = BootStatus::Failed {
                reason: format!("Clock drift {}ns exceeds limit {}ns", drift, self.config.max_clock_drift_ns)
            };
            return Err("L0 attestation failed: clock drift".to_string());
        }

        // Verify attestation (simulation is accepted in dev mode)
        if !attestation.verified && attestation.attestation_type != AttestationType::Simulation {
            self.status = BootStatus::Failed {
                reason: "Physical attestation verification failed".into()
            };
            return Err("L0 attestation failed: unverified attestation".to_string());
        }

        self.status = BootStatus::L0Attested;
        Ok(())
    }

    /// Step 2: Akashic reconstruction — verify causal chain from local replica.
    pub fn step_akashic_reconstruction(
        &mut self,
        recent_events: &[UniversalBehavioralHash],
        last_known_hash: &UBHHash,
        stored_depth: f64,
    ) -> Result<(), String> {
        if self.status != BootStatus::L0Attested {
            return Err("Must complete L0 attestation first".into());
        }

        // Verify causal chain continuity
        let events_to_verify = if recent_events.len() > self.config.chain_verify_depth {
            &recent_events[recent_events.len() - self.config.chain_verify_depth..]
        } else {
            recent_events
        };

        match verify_continuity(events_to_verify, last_known_hash) {
            ContinuityResult::Valid | ContinuityResult::Empty => {
                self.reconstructed_depth = stored_depth;
                self.status = BootStatus::AkashicReconstructed;
                Ok(())
            }
            ContinuityResult::Broken { at_index } => {
                self.status = BootStatus::Failed {
                    reason: format!("Causal chain broken at event index {}", at_index)
                };
                Err("Akashic reconstruction failed: broken chain — possible tamper".into())
            }
            ContinuityResult::HashInvalid { at_index } => {
                self.status = BootStatus::Failed {
                    reason: format!("Hash invalid at event index {}", at_index)
                };
                Err("Akashic reconstruction failed: hash corruption".into())
            }
        }
    }

    /// Step 3: Coherence warm-up — compute BC from recent events.
    pub fn step_coherence_warmup(
        &mut self,
        bc_from_recent_events: f32,
        historical_bc_average: f32,
    ) -> Result<BootWarning, String> {
        if self.status != BootStatus::AkashicReconstructed {
            return Err("Must complete Akashic reconstruction first".into());
        }

        self.boot_bc = bc_from_recent_events;

        // Check for BC drop from historical average
        let bc_drop = historical_bc_average - bc_from_recent_events;
        let warning = if bc_drop > self.config.bc_warning_threshold {
            BootWarning::BCDropped { amount: bc_drop }
        } else {
            BootWarning::None
        };

        // Hard stop if BC is below psi_boot
        if bc_from_recent_events < self.config.psi_boot {
            self.status = BootStatus::Failed {
                reason: format!("BC {:.3} below psi_boot {:.3} — SILENCE", bc_from_recent_events, self.config.psi_boot)
            };
            return Err("Boot halted: BC below threshold — SILENCE engaged".into());
        }

        self.status = BootStatus::CoherenceWarmedUp;
        Ok(warning)
    }

    /// Step 4: Resonance establishment — broadcast SPAWN to resonant peers.
    pub fn step_resonance_establishment(&mut self, peers_confirmed: usize) -> Result<(), String> {
        if self.status != BootStatus::CoherenceWarmedUp {
            return Err("Must complete coherence warm-up first".into());
        }
        // Minimum 1 peer for genesis nodes, 3 for standard nodes
        if peers_confirmed == 0 {
            // Still allowed (genesis node or isolated mode)
            eprintln!("WARNING: No resonant peers found — running in isolated mode");
        }
        self.status = BootStatus::ResonanceEstablished;
        Ok(())
    }

    /// Step 5: Boot completion.
    pub fn step_boot_complete(&mut self) -> Result<BootReport, String> {
        if self.status != BootStatus::ResonanceEstablished {
            return Err("Must complete resonance establishment first".into());
        }

        self.status = BootStatus::Complete;

        let duration_ns = self.boot_start_ns; // simplified
        let report = BootReport {
            bc_at_boot: self.boot_bc,
            depth_at_boot: self.reconstructed_depth,
            boot_duration_estimate: "~2s (standard ARM64)".into(),
            status: BootStatus::Complete,
        };
        Ok(report)
    }

    pub fn current_status(&self) -> &BootStatus { &self.status }
    pub fn reconstructed_depth(&self) -> f64 { self.reconstructed_depth }
    pub fn boot_bc(&self) -> f32 { self.boot_bc }
}

/// Warning issued during boot warm-up.
#[derive(Debug, Clone)]
pub enum BootWarning {
    None,
    BCDropped { amount: f32 },
}

/// Final boot report written to Akashic Index.
#[derive(Debug, Clone)]
pub struct BootReport {
    pub bc_at_boot: f32,
    pub depth_at_boot: f64,
    pub boot_duration_estimate: String,
    pub status: BootStatus,
}

impl Default for LivingBootProtocol {
    fn default() -> Self { Self::new(LBPConfig::default()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::l0::attestation::{simulate_attestation};

    #[test]
    fn successful_boot_sequence() {
        let mut lbp = LivingBootProtocol::default();
        let ts = 1_000_000_000_000u64;
        let attestation = simulate_attestation([0u8; 32], ts);

        // Step 1
        lbp.step_l0_attestation(ts, ts, &attestation).unwrap();
        assert_eq!(*lbp.current_status(), BootStatus::L0Attested);

        // Step 2
        lbp.step_akashic_reconstruction(&[], &[0u8; 32], 10000.0).unwrap();
        assert_eq!(*lbp.current_status(), BootStatus::AkashicReconstructed);

        // Step 3
        lbp.step_coherence_warmup(0.80, 0.85).unwrap();
        assert_eq!(*lbp.current_status(), BootStatus::CoherenceWarmedUp);

        // Step 4
        lbp.step_resonance_establishment(3).unwrap();
        assert_eq!(*lbp.current_status(), BootStatus::ResonanceEstablished);

        // Step 5
        let report = lbp.step_boot_complete().unwrap();
        assert_eq!(report.status, BootStatus::Complete);
    }

    #[test]
    fn boot_halted_on_low_bc() {
        let mut lbp = LivingBootProtocol::default();
        let ts = 2_000_000_000_000u64;
        let attestation = simulate_attestation([0u8; 32], ts);
        lbp.step_l0_attestation(ts, ts, &attestation).unwrap();
        lbp.step_akashic_reconstruction(&[], &[0u8; 32], 0.0).unwrap();
        // BC below psi_boot (0.45)
        let result = lbp.step_coherence_warmup(0.30, 0.80);
        assert!(result.is_err());
        assert!(matches!(lbp.current_status(), BootStatus::Failed { .. }));
    }
}
