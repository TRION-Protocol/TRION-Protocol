//! Redis hot-path cache for the Akashic Index.
//!
//! The cache stores the most recent behavioral events per entity
//! for fast coherence computation without hitting TimescaleDB.

use axiom_core::types::UniversalBehavioralHash;
use anyhow::Result;

/// Redis key prefixes.
pub const KEY_UBH: &str = "ubh";
pub const KEY_BC: &str = "bc";
pub const KEY_DEPTH: &str = "depth";
pub const KEY_RF: &str = "rf"; // resonance frequency vector

/// Cache TTL (24 hours — events age into TimescaleDB).
pub const CACHE_TTL_SECS: u64 = 86400;

/// Format the Redis key for a UBH event.
pub fn ubh_key(bpi: &[u8; 32], timestamp_ns: u64) -> String {
    format!("{}:{}:{}", KEY_UBH, hex::encode(bpi), timestamp_ns)
}

/// Format the Redis key for an entity's current BC score.
pub fn bc_key(bpi: &[u8; 32]) -> String {
    format!("{}:{}", KEY_BC, hex::encode(bpi))
}

/// Format the Redis key for an entity's current depth.
pub fn depth_key(bpi: &[u8; 32]) -> String {
    format!("{}:{}", KEY_DEPTH, hex::encode(bpi))
}

/// Format the Redis key for an entity's resonance frequency vector.
pub fn rf_key(bpi: &[u8; 32]) -> String {
    format!("{}:{}", KEY_RF, hex::encode(bpi))
}
