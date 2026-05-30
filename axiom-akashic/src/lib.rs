//! # AXIOM Akashic Index — Layer 3
//!
//! The Living Akashic Index: eternal, append-only behavioral memory for all entities.
//!
//! ## Architecture
//! - **TimescaleDB**: Primary behavioral event store (time-series optimized)
//! - **Redis**: Hot-path cache (latest N events per entity)
//! - **IPFS**: Deep archival storage for aged UBH records
//! - **gRPC**: Service interface for L4 and L6 layers
//!
//! ## Invariants
//! - I1 (Append-Only): Events are never modified or deleted at the core level
//! - I2 (Cryptographic Consistency): Every event verifies against its self_hash
//! - I3 (Temporal Ordering): Events are always retrievable in GPS timestamp order
//! - I4 (Depth Monotonicity): D(entity, t) is strictly non-decreasing

pub mod akashic;
pub mod schema;
pub mod cache;
pub mod grpc;

pub use akashic::AkashicIndex;
pub use schema::AkashicSchema;
