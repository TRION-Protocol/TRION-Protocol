//! # Layer 2 — Entity Resolution (BEO Universal)
//!
//! Resolves behavioral identity across multiple representations of the same entity
//! (multi-device, multi-account, multi-domain).
//!
//! TRION's Behavioral Entity Object (BEO) resolved blockchain wallets belonging
//! to the same real-world actor. BEO Universal extends this to resolve all entity types.

pub mod beo;
pub mod bpi;
pub mod odi;

pub use beo::{BEOResolver, BEOConfidence, BEOResult};
pub use bpi::BehavioralProcessIdentity;
pub use odi::OntologicalDeviceIdentity;
