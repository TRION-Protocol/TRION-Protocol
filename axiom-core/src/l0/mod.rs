//! # Layer 0 — Physical Reality Substrate
//!
//! Provides unforgeable, physics-grounded time and entropy.
//!
//! ## Components
//! - GPS primary timestamping (nanosecond precision)
//! - Hardware Security Module (HSM) entropy
//! - Physical sensor integration
//! - Validator node physical attestation (SGX / TrustZone)
//!
//! ## Formula
//! ```text
//! H_L0(t) = H_GPS(t) + H_HSM(t) + H_sensors(t) + H_thermal(t)
//! H_L0(t) > H_min always (guaranteed by physics)
//! ```

pub mod entropy;
pub mod attestation;

pub use entropy::EntropySource;
pub use attestation::AttestationReport;
