//! gRPC service interface for the Akashic Index (L3).
//!
//! Exposes the AkashicIndex over gRPC so that L4 (coherence engine)
//! and L6 (RCP daemon) can query and ingest behavioral records.
//!
//! The full protobuf definitions live in `proto/ubh.proto` and
//! `proto/coherence.proto`.  This module wires them to the
//! AkashicIndex implementation once a real gRPC runtime (tonic) is
//! added to the workspace.  For now it provides placeholder stubs so
//! the crate compiles without the optional dependency.

use crate::akashic::AkashicIndex;

/// gRPC server handle for the Akashic Index.
///
/// Wraps an `AkashicIndex` and (when tonic is enabled) exposes:
///  - `IngestUBH`  — store a new UBH record
///  - `QueryDepth` — return the current behavioral depth for an entity
///  - `StreamEvents` — server-side stream of events for a BPI
pub struct AkashicGrpcServer {
    _index: AkashicIndex,
}

impl AkashicGrpcServer {
    /// Create a new gRPC server wrapping the given index.
    pub fn new(index: AkashicIndex) -> Self {
        Self { _index: index }
    }

    /// Bind to `addr` and serve requests.
    ///
    /// Currently a no-op stub — enable the `grpc` crate feature and
    /// add `tonic` to `axiom-akashic/Cargo.toml` to activate.
    pub async fn serve(self, addr: &str) -> Result<(), Box<dyn std::error::Error>> {
        tracing::info!(addr = addr, "AkashicGrpcServer::serve — stub, not yet active");
        Ok(())
    }
}
