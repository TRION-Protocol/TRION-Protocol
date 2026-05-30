//! # Layer 1 — Universal Behavioral Hash Engine
//!
//! Generates a cryptographic hash (Blake3) for every behavioral event,
//! encoding entity identity, event type, context, and causal chain.
//!
//! The UBH is the atomic unit of AXIOM. Every higher layer depends on UBH records.
//! A UBH record is immutable once written (Append Invariant I1).
//!
//! ## Chain Property
//! ```text
//! UBH[n].prior_hash = UBH[n-1].self_hash
//! ```
//! Inserting, modifying, or deleting any event breaks all subsequent hashes.

pub mod ubh;
pub use ubh::UBHEngine;
