//! Behavioral File System (BFS) — Invention #14.
//!
//! BFS is a file system where files are behavioral entities with Akashic Depth,
//! behavioral coherence, fitness scores, and love coefficients.
//! File persistence is governed by fitness — not manual deletion.
//!
//! ## File Lifecycle
//! ```text
//! F(file) > 0.80: Active, high-priority cache
//! F(file) > 0.60: Normal operation
//! F(file) > 0.40: Aging, flagged for review
//! F(file) < 0.40: Candidate for tier-2 storage
//! F(file) < 0.20: Archive (Filecoin/IPFS)
//! F(file) → 0:    Deep archive — never deleted from Akashic Index
//! ```

use crate::types::{BPI, UBHHash, GpsTimestampNs};
use std::collections::HashMap;

/// A file in the Behavioral File System.
#[derive(Debug, Clone)]
pub struct BFile {
    /// Blake3 hash of content.
    pub content_hash: UBHHash,
    /// File's own BPI — files are entities.
    pub entity_bpi: BPI,
    /// D(BFile, t): accumulates with each access.
    pub depth: f64,
    /// BC(BFile, t): access pattern coherence.
    pub coherence: f32,
    /// Love(BFile): purpose/utility score.
    pub love: f32,
    /// F(BFile, t) = BC × Love × (depth/age).
    pub fitness: f32,
    /// Merkle root of all access events.
    pub access_chain_root: UBHHash,
    /// Total accesses since creation.
    pub access_count: u64,
    /// Total write/modification count.
    pub write_count: u32,
    /// GPS timestamp of creation.
    pub created_at: GpsTimestampNs,
    /// GPS timestamp of last access.
    pub last_accessed: GpsTimestampNs,
    /// Creator-declared purpose.
    pub declared_purpose: String,
    /// Storage tier.
    pub tier: StorageTier,
}

/// BFS storage tiers based on fitness.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageTier {
    /// F > 0.80 — in-memory hot cache.
    Hot,
    /// F > 0.60 — active on-disk storage.
    Active,
    /// F > 0.40 — aging, flagged.
    Aging,
    /// F > 0.20 — tier-2 cold storage.
    Cold,
    /// F > 0.0 — IPFS/Filecoin archive.
    Archive,
    /// F ≈ 0 — deep archive, Akashic Index only.
    DeepArchive,
}

impl BFile {
    /// Create a new BFile.
    pub fn new(
        content: &[u8],
        purpose: &str,
        love: f32,
        creator_bpi: &BPI,
        timestamp: GpsTimestampNs,
    ) -> Self {
        let content_hash = *blake3::hash(content).as_bytes();
        let entity_bpi = Self::compute_bpi(&content_hash, creator_bpi, purpose, timestamp);

        Self {
            content_hash,
            entity_bpi,
            depth: 0.0,
            coherence: 1.0,
            love: love.clamp(0.0, 1.0),
            fitness: love,
            access_chain_root: [0u8; 32],
            access_count: 0,
            write_count: 0,
            created_at: timestamp,
            last_accessed: timestamp,
            declared_purpose: purpose.to_string(),
            tier: StorageTier::Active,
        }
    }

    /// Record a file access — updates depth and coherence.
    pub fn record_access(&mut self, accessor_bpi: &BPI, timestamp: GpsTimestampNs) {
        self.access_count += 1;
        self.last_accessed = timestamp;
        // Depth grows with each access (simplified: +1 per access)
        self.depth += self.coherence as f64 * self.love as f64;
        self.update_access_chain(accessor_bpi, timestamp);
        self.recompute_fitness(timestamp);
    }

    /// Record a file modification.
    pub fn record_write(&mut self, new_content_hash: UBHHash, timestamp: GpsTimestampNs) {
        self.content_hash = new_content_hash;
        self.write_count += 1;
        self.record_access(&self.entity_bpi.clone(), timestamp);
    }

    /// Recompute fitness score.
    ///
    /// F(file) = BC × Love × (depth/age_events)
    pub fn recompute_fitness(&mut self, now: GpsTimestampNs) {
        let age_events = self.access_count.max(1) as f32;
        let depth_normalized = (self.depth as f32 / age_events).min(1.0);
        self.fitness = (self.coherence * self.love * (1.0 + depth_normalized) / 2.0).clamp(0.0, 1.0);
        self.tier = StorageTier::from_fitness(self.fitness);
    }

    /// Update behavioral coherence (BC) for anomalous access.
    pub fn update_coherence(&mut self, new_bc: f32) {
        self.coherence = new_bc.clamp(0.0, 1.0);
    }

    fn update_access_chain(&mut self, accessor_bpi: &BPI, timestamp: GpsTimestampNs) {
        let mut h = blake3::Hasher::new();
        h.update(&self.access_chain_root);
        h.update(accessor_bpi);
        h.update(&timestamp.to_le_bytes());
        h.update(&self.access_count.to_le_bytes());
        self.access_chain_root = *h.finalize().as_bytes();
    }

    fn compute_bpi(
        content_hash: &UBHHash,
        creator_bpi: &BPI,
        purpose: &str,
        timestamp: GpsTimestampNs,
    ) -> BPI {
        let mut h = blake3::Hasher::new();
        h.update(content_hash);
        h.update(creator_bpi);
        h.update(purpose.as_bytes());
        h.update(&timestamp.to_le_bytes());
        *h.finalize().as_bytes()
    }
}

impl StorageTier {
    pub fn from_fitness(f: f32) -> Self {
        match f {
            f if f > 0.80 => Self::Hot,
            f if f > 0.60 => Self::Active,
            f if f > 0.40 => Self::Aging,
            f if f > 0.20 => Self::Cold,
            f if f > 0.01 => Self::Archive,
            _ => Self::DeepArchive,
        }
    }

    pub fn is_locally_served(&self) -> bool {
        !matches!(self, Self::Archive | Self::DeepArchive)
    }
}

/// The Behavioral File System.
pub struct BehavioralFileSystem {
    files: HashMap<BPI, BFile>,
    /// Akashic Index connection (writes go here, never deleted).
    akashic_written: u64,
}

impl BehavioralFileSystem {
    pub fn new() -> Self {
        Self {
            files: HashMap::new(),
            akashic_written: 0,
        }
    }

    /// Create a new file.
    pub fn create(
        &mut self,
        content: &[u8],
        purpose: &str,
        love: f32,
        creator_bpi: &BPI,
        timestamp: GpsTimestampNs,
    ) -> BPI {
        let file = BFile::new(content, purpose, love, creator_bpi, timestamp);
        let bpi = file.entity_bpi;
        self.akashic_written += 1;
        self.files.insert(bpi, file);
        bpi
    }

    /// Read a file (updates access chain).
    pub fn read(&mut self, bpi: &BPI, accessor: &BPI, timestamp: GpsTimestampNs) -> Option<&BFile> {
        if let Some(file) = self.files.get_mut(bpi) {
            // SILENCE: if BC drops, file enters read-only SILENCE
            if file.coherence < 0.55 {
                return None; // SILENCE — cannot serve compromised file
            }
            file.record_access(accessor, timestamp);
            self.files.get(bpi)
        } else {
            None
        }
    }

    /// Write to a file.
    pub fn write(&mut self, bpi: &BPI, new_content: &[u8], timestamp: GpsTimestampNs) -> bool {
        if let Some(file) = self.files.get_mut(bpi) {
            let new_hash = *blake3::hash(new_content).as_bytes();
            file.record_write(new_hash, timestamp);
            self.akashic_written += 1;
            true
        } else {
            false
        }
    }

    /// Get files by storage tier.
    pub fn files_by_tier(&self, tier: StorageTier) -> Vec<&BFile> {
        self.files.values().filter(|f| f.tier == tier).collect()
    }

    /// Reap files that should move to archive (fitness below threshold).
    pub fn reap(&mut self, now: GpsTimestampNs) -> Vec<BPI> {
        let to_archive: Vec<BPI> = self.files.values()
            .filter(|f| f.tier == StorageTier::Archive || f.tier == StorageTier::DeepArchive)
            .map(|f| f.entity_bpi)
            .collect();

        for bpi in &to_archive {
            // Files are NEVER deleted — only moved to archive.
            // In production: write to IPFS/Filecoin + remove from hot storage.
            if let Some(file) = self.files.get(bpi) {
                self.akashic_written += 1; // Record archival event
            }
        }

        to_archive
    }

    pub fn file_count(&self) -> usize { self.files.len() }
    pub fn akashic_events_written(&self) -> u64 { self.akashic_written }
}

impl Default for BehavioralFileSystem {
    fn default() -> Self { Self::new() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_file_has_bpi() {
        let mut bfs = BehavioralFileSystem::new();
        let creator = [1u8; 32];
        let bpi = bfs.create(b"hello world", "documentation", 0.8, &creator, 1_000_000);
        assert_ne!(bpi, [0u8; 32]);
    }

    #[test]
    fn access_increases_depth() {
        let mut bfs = BehavioralFileSystem::new();
        let creator = [1u8; 32];
        let bpi = bfs.create(b"content", "test", 0.9, &creator, 1000);
        let initial_depth = bfs.files[&bpi].depth;
        bfs.read(&bpi, &creator, 2000);
        assert!(bfs.files[&bpi].depth > initial_depth);
    }

    #[test]
    fn silenced_file_not_readable() {
        let mut bfs = BehavioralFileSystem::new();
        let creator = [1u8; 32];
        let bpi = bfs.create(b"secret", "sensitive", 0.9, &creator, 1000);
        // Simulate coherence drop below SILENCE threshold
        bfs.files.get_mut(&bpi).unwrap().coherence = 0.40;
        let result = bfs.read(&bpi, &creator, 2000);
        assert!(result.is_none());
    }

    #[test]
    fn storage_tier_from_fitness() {
        assert_eq!(StorageTier::from_fitness(0.9), StorageTier::Hot);
        assert_eq!(StorageTier::from_fitness(0.7), StorageTier::Active);
        assert_eq!(StorageTier::from_fitness(0.5), StorageTier::Aging);
        assert_eq!(StorageTier::from_fitness(0.3), StorageTier::Cold);
        assert_eq!(StorageTier::from_fitness(0.1), StorageTier::Archive);
        assert_eq!(StorageTier::from_fitness(0.0), StorageTier::DeepArchive);
    }
}
