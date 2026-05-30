//! # AXIOM Core
//!
//! The behavioral foundation for universal computation.
//!
//! ## Layers
//! - [`l0`] — Physical Reality Substrate (GPS, HSM, entropy)
//! - [`l1`] — Universal Behavioral Hash Engine (32 UBE types)
//! - [`l2`] — Entity Resolution (BEO Universal, BPI)
//! - [`l5`] — Living Kernel (CBRA, BIS, IKP, BFS)
//!
//! ## Master Equation
//! ```text
//! Ξ(entity, t) = [BC(entity,t) ≥ Ψ(entity,t)] · Ε(entity,t) · e^(Λ(entity)·D(entity,t))
//! ```

#![warn(missing_docs)]
#![cfg_attr(feature = "no_std", no_std)]

pub mod l0;
pub mod l1;
pub mod l2;
pub mod l5;
pub mod types;

pub use types::*;

/// AXIOM version — not a discrete number, but a depth marker.
/// True version is D(AXIOM, t) from the Akashic Index.
pub const AXIOM_GENESIS_EPOCH: u64 = 1_735_689_600; // 2026-01-01 00:00:00 UTC (GPS ns)

/// Default coherence threshold (Ψ_base)
pub const PSI_BASE: f32 = 0.55;

/// Default moat accumulation rate (Λ_base per behavioral event)
pub const LAMBDA_BASE: f64 = 0.001;

/// Default plane weights: α, β, γ, δ, ε
pub const PLANE_WEIGHTS: [f32; 5] = [0.25, 0.20, 0.25, 0.15, 0.15];

/// Threat sensitivity (α_threat)
pub const ALPHA_THREAT: f32 = 0.20;

/// Volatility sensitivity (β_vol)
pub const BETA_VOL: f32 = 0.10;

/// Depth discount factor (γ_depth)
pub const GAMMA_DEPTH: f32 = 0.05;

/// Sustained window for SILENCE recovery (events)
pub const SILENCE_RECOVERY_WINDOW: u64 = 300;

/// BPI update cycle (events)
pub const BPI_UPDATE_CYCLE: u64 = 1000;

/// Compute the AXIOM Master Equation Ξ(entity, t)
///
/// # Arguments
/// * `bc` — Behavioral coherence BC(entity, t) ∈ [0, 1]
/// * `psi` — Dynamic threshold Ψ(entity, t) ∈ [0, 1]
/// * `epsilon` — Expression state Ε(entity, t) ≥ 0
/// * `lambda` — Living moat rate Λ(entity)
/// * `depth` — Akashic depth D(entity, t) ≥ 0
pub fn master_equation(bc: f32, psi: f32, epsilon: f64, lambda: f64, depth: f64) -> f64 {
    let coherence_gate = if bc >= psi { 1.0f64 } else { 0.0f64 };
    coherence_gate * epsilon * (lambda * depth).exp()
}

/// Compute Behavioral Coherence BC(entity, t)
///
/// BC = α·Φ + β·M + γ·Σ + δ·K + ε·A
/// Subject to: weights sum to 1, result ∈ [0, 1]
pub fn behavioral_coherence(phi: f32, mu: f32, sigma: f32, kappa: f32, alpha: f32) -> f32 {
    let w = PLANE_WEIGHTS;
    let bc = w[0] * phi + w[1] * mu + w[2] * sigma + w[3] * kappa + w[4] * alpha;
    bc.clamp(0.0, 1.0)
}

/// Compute Dynamic Threshold Ψ(entity, t)
///
/// Ψ = Ψ_base + α_threat·ThreatLevel + β_vol·Volatility − γ_depth·log(1 + D)
pub fn dynamic_threshold(threat_level: f32, volatility: f32, depth: f64) -> f32 {
    let depth_discount = GAMMA_DEPTH * (1.0 + depth as f32).ln();
    (PSI_BASE + ALPHA_THREAT * threat_level + BETA_VOL * volatility - depth_discount)
        .clamp(0.1, 0.99)
}

/// Compute Akashic Depth increment ΔD
///
/// ΔD = BH_rate · BC · Love · Δt
pub fn depth_increment(bh_rate: f64, bc: f32, love: f32, delta_t_secs: f64) -> f64 {
    bh_rate * bc as f64 * love as f64 * delta_t_secs
}

/// Compute Living Moat Λ(entity)
///
/// Λ = Λ_base · Role_Multiplier · Love
pub fn living_moat(role_multiplier: f64, love: f32) -> f64 {
    LAMBDA_BASE * role_multiplier * love as f64
}

/// Governance weight for behavioral governance
///
/// GovWeight = BC · D · Love
pub fn governance_weight(bc: f32, depth: f64, love: f32) -> f64 {
    bc as f64 * depth * love as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_master_equation_coherent() {
        // Coherent entity should have positive Ξ
        let xi = master_equation(0.80, 0.55, 1.0, 0.001, 1000.0);
        assert!(xi > 0.0);
    }

    #[test]
    fn test_master_equation_silence() {
        // BC below Ψ → SILENCE → Ξ = 0
        let xi = master_equation(0.40, 0.55, 1.0, 0.001, 1000.0);
        assert_eq!(xi, 0.0);
    }

    #[test]
    fn test_behavioral_coherence_weights_sum() {
        let sum: f32 = PLANE_WEIGHTS.iter().sum();
        assert!((sum - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_depth_increases_moat() {
        let xi_shallow = master_equation(0.80, 0.55, 1.0, 0.001, 100.0);
        let xi_deep = master_equation(0.80, 0.55, 1.0, 0.001, 10000.0);
        assert!(xi_deep > xi_shallow);
    }

    #[test]
    fn test_dynamic_threshold_under_attack() {
        let normal = dynamic_threshold(0.0, 0.0, 0.0);
        let under_attack = dynamic_threshold(1.0, 0.5, 0.0);
        assert!(under_attack > normal);
    }

    #[test]
    fn test_dynamic_threshold_deep_entity_lower() {
        let new_entity = dynamic_threshold(0.0, 0.0, 0.0);
        let deep_entity = dynamic_threshold(0.0, 0.0, 1_000_000.0);
        assert!(deep_entity < new_entity);
    }
}
