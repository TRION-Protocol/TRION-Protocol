//! Core AkashicIndex implementation — TimescaleDB + Redis.

use axiom_core::types::{UniversalBehavioralHash, BPI, UBEType, GpsTimestampNs};
use anyhow::Result;
use sqlx::PgPool;
use std::sync::Arc;

/// TimescaleDB row for akashic_events table.
#[derive(Debug, sqlx::FromRow)]
pub struct AkashicEventRow {
    pub entity_bpi:       Vec<u8>,
    pub event_type:       i16,
    pub event_subtype:    i16,
    pub prior_hash:       Vec<u8>,
    pub causal_context:   Vec<u8>,
    pub gps_timestamp:    i64,
    pub device_timestamp: i64,
    pub environment_hash: Vec<u8>,
    pub event_payload:    Vec<u8>,
    pub entropy_proof:    Vec<u8>,
    pub validator_sig:    Vec<u8>,
    pub self_hash:        Vec<u8>,
    pub bc_at_event:      f32,
    pub depth_at_event:   f64,
}

impl From<AkashicEventRow> for UniversalBehavioralHash {
    fn from(row: AkashicEventRow) -> Self {
        let mut entity_bpi = [0u8; 32];
        let mut prior_hash = [0u8; 32];
        let mut causal_context = [0u8; 32];
        let mut environment_hash = [0u8; 32];
        let mut entropy_proof = [0u8; 32];
        let mut validator_sig = [0u8; 32];
        let mut self_hash = [0u8; 32];

        entity_bpi[..row.entity_bpi.len().min(32)].copy_from_slice(&row.entity_bpi[..row.entity_bpi.len().min(32)]);
        prior_hash[..row.prior_hash.len().min(32)].copy_from_slice(&row.prior_hash[..row.prior_hash.len().min(32)]);
        causal_context[..row.causal_context.len().min(32)].copy_from_slice(&row.causal_context[..row.causal_context.len().min(32)]);
        environment_hash[..row.environment_hash.len().min(32)].copy_from_slice(&row.environment_hash[..row.environment_hash.len().min(32)]);
        entropy_proof[..row.entropy_proof.len().min(32)].copy_from_slice(&row.entropy_proof[..row.entropy_proof.len().min(32)]);
        validator_sig[..row.validator_sig.len().min(32)].copy_from_slice(&row.validator_sig[..row.validator_sig.len().min(32)]);
        self_hash[..row.self_hash.len().min(32)].copy_from_slice(&row.self_hash[..row.self_hash.len().min(32)]);

        UniversalBehavioralHash {
            entity_bpi,
            event_type: UBEType::from_u8(row.event_type as u8).unwrap_or(UBEType::Execute),
            event_subtype: row.event_subtype as u8,
            prior_hash,
            causal_context,
            gps_timestamp: row.gps_timestamp as u64,
            device_timestamp: row.device_timestamp as u64,
            environment_hash,
            event_payload: row.event_payload,
            entropy_proof,
            validator_sig,
            self_hash,
            bc_at_event: row.bc_at_event,
            depth_at_event: row.depth_at_event,
        }
    }
}

/// The Living Akashic Index — the ground truth of all AXIOM behavior.
pub struct AkashicIndex {
    pool: Arc<PgPool>,
    redis: Option<redis::Client>,
}

impl AkashicIndex {
    /// Connect to TimescaleDB and Redis.
    pub async fn connect(database_url: &str, redis_url: Option<&str>) -> Result<Self> {
        let pool = PgPool::connect(database_url).await?;
        let redis = if let Some(url) = redis_url {
            Some(redis::Client::open(url)?)
        } else {
            None
        };
        Ok(Self { pool: Arc::new(pool), redis })
    }

    /// Append a UBH record to the Akashic Index.
    ///
    /// This operation is APPEND-ONLY. No record is ever modified.
    /// The TimescaleDB constraint enforces this at the DB level.
    pub async fn append(&self, ubh: &UniversalBehavioralHash) -> Result<()> {
        // Verify self_hash before writing
        if !ubh.verify_self_hash() {
            anyhow::bail!("UBH self_hash verification failed — event rejected");
        }

        sqlx::query!(
            r#"
            INSERT INTO akashic_events (
                entity_bpi, event_type, event_subtype,
                prior_hash, causal_context,
                gps_timestamp, device_timestamp,
                environment_hash, event_payload,
                entropy_proof, validator_sig, self_hash,
                bc_at_event, depth_at_event
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
            "#,
            ubh.entity_bpi.as_slice(),
            ubh.event_type as i16,
            ubh.event_subtype as i16,
            ubh.prior_hash.as_slice(),
            ubh.causal_context.as_slice(),
            ubh.gps_timestamp as i64,
            ubh.device_timestamp as i64,
            ubh.environment_hash.as_slice(),
            ubh.event_payload.as_slice(),
            ubh.entropy_proof.as_slice(),
            ubh.validator_sig.as_slice(),
            ubh.self_hash.as_slice(),
            ubh.bc_at_event,
            ubh.depth_at_event,
        )
        .execute(self.pool.as_ref())
        .await?;

        // Write to Redis hot cache
        if let Some(redis_client) = &self.redis {
            let mut conn = redis_client.get_async_connection().await?;
            let key = format!("ubh:{}:{}", hex::encode(ubh.entity_bpi), ubh.gps_timestamp);
            let value = serde_json::to_vec(ubh)?;
            redis::AsyncCommands::set_ex(&mut conn, key, value, 86400u64).await?;
        }

        Ok(())
    }

    /// Get cumulative Akashic Depth D(entity, t).
    pub async fn get_depth(&self, bpi: &[u8]) -> Result<f64> {
        let row = sqlx::query!(
            r#"
            SELECT cumulative_depth
            FROM entity_depth
            WHERE entity_bpi = $1
            ORDER BY hour DESC
            LIMIT 1
            "#,
            bpi,
        )
        .fetch_optional(self.pool.as_ref())
        .await?;

        Ok(row.and_then(|r| r.cumulative_depth).unwrap_or(0.0))
    }

    /// Get events for an entity in a time range.
    pub async fn get_events(
        &self,
        bpi: &[u8],
        from_ns: GpsTimestampNs,
        to_ns: GpsTimestampNs,
    ) -> Result<Vec<UniversalBehavioralHash>> {
        let rows: Vec<AkashicEventRow> = sqlx::query_as!(
            AkashicEventRow,
            r#"
            SELECT entity_bpi, event_type, event_subtype,
                   prior_hash, causal_context,
                   gps_timestamp, device_timestamp,
                   environment_hash, event_payload,
                   entropy_proof, validator_sig, self_hash,
                   bc_at_event, depth_at_event
            FROM akashic_events
            WHERE entity_bpi = $1
              AND gps_timestamp BETWEEN $2 AND $3
            ORDER BY gps_timestamp ASC
            "#,
            bpi,
            from_ns as i64,
            to_ns as i64,
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        Ok(rows.into_iter().map(UniversalBehavioralHash::from).collect())
    }

    /// Get latest N events for an entity (from Redis cache when available).
    pub async fn get_latest_events(&self, bpi: &[u8], n: u32) -> Result<Vec<UniversalBehavioralHash>> {
        // Try Redis first
        if let Some(redis_client) = &self.redis {
            if let Ok(mut conn) = redis_client.get_async_connection().await {
                let pattern = format!("ubh:{}:*", hex::encode(bpi));
                let keys: Vec<String> = redis::AsyncCommands::keys(&mut conn, &pattern).await.unwrap_or_default();
                if !keys.is_empty() {
                    let mut sorted_keys = keys;
                    sorted_keys.sort(); // Timestamps in key — alphabetical = chronological
                    let take_from = sorted_keys.len().saturating_sub(n as usize);
                    let recent_keys = &sorted_keys[take_from..];

                    let mut events = Vec::new();
                    for key in recent_keys {
                        let val: Option<Vec<u8>> = redis::AsyncCommands::get(&mut conn, key).await.unwrap_or(None);
                        if let Some(bytes) = val {
                            if let Ok(ubh) = serde_json::from_slice::<UniversalBehavioralHash>(&bytes) {
                                events.push(ubh);
                            }
                        }
                    }
                    if !events.is_empty() {
                        return Ok(events);
                    }
                }
            }
        }

        // Fallback to TimescaleDB
        let rows: Vec<AkashicEventRow> = sqlx::query_as!(
            AkashicEventRow,
            r#"
            SELECT entity_bpi, event_type, event_subtype,
                   prior_hash, causal_context,
                   gps_timestamp, device_timestamp,
                   environment_hash, event_payload,
                   entropy_proof, validator_sig, self_hash,
                   bc_at_event, depth_at_event
            FROM akashic_events
            WHERE entity_bpi = $1
            ORDER BY gps_timestamp DESC
            LIMIT $2
            "#,
            bpi,
            n as i64,
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        let mut events: Vec<UniversalBehavioralHash> = rows.into_iter()
            .map(UniversalBehavioralHash::from)
            .collect();
        events.reverse(); // Return in chronological order
        Ok(events)
    }

    /// Get the Ξ (truth state) snapshot for an entity.
    pub async fn get_truth_state(&self, bpi: &[u8]) -> Result<Option<TruthStateRow>> {
        let row = sqlx::query_as!(
            TruthStateRow,
            r#"
            SELECT entity_bpi, bc, psi, depth, love, xi, gps_timestamp
            FROM entity_truth_state
            WHERE entity_bpi = $1
            ORDER BY gps_timestamp DESC
            LIMIT 1
            "#,
            bpi,
        )
        .fetch_optional(self.pool.as_ref())
        .await?;

        Ok(row)
    }

    /// Compute event frequency vector for RCP resonance (32-dim).
    pub async fn get_resonance_vector(&self, bpi: &[u8], window_secs: i64) -> Result<[f32; 32]> {
        let cutoff = chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0) - window_secs * 1_000_000_000;
        let rows = sqlx::query!(
            r#"
            SELECT event_type, count(*) as cnt
            FROM akashic_events
            WHERE entity_bpi = $1
              AND gps_timestamp > $2
            GROUP BY event_type
            "#,
            bpi,
            cutoff,
        )
        .fetch_all(self.pool.as_ref())
        .await?;

        let total: i64 = rows.iter().map(|r| r.cnt.unwrap_or(0)).sum();
        let total = total.max(1) as f32;

        let mut rf = [0f32; 32];
        for row in rows {
            let idx = (row.event_type as usize).saturating_sub(1).min(31);
            rf[idx] = row.cnt.unwrap_or(0) as f32 / total;
        }
        Ok(rf)
    }

    /// Count total events for an entity.
    pub async fn event_count(&self, bpi: &[u8]) -> Result<i64> {
        let row = sqlx::query!(
            "SELECT count(*) as cnt FROM akashic_events WHERE entity_bpi = $1",
            bpi,
        )
        .fetch_one(self.pool.as_ref())
        .await?;
        Ok(row.cnt.unwrap_or(0))
    }

    /// Pool health check.
    pub async fn ping(&self) -> Result<()> {
        sqlx::query!("SELECT 1 as ok").fetch_one(self.pool.as_ref()).await?;
        Ok(())
    }
}

/// Snapshot of entity truth state from entity_truth_state materialized view.
#[derive(Debug, sqlx::FromRow)]
pub struct TruthStateRow {
    pub entity_bpi: Vec<u8>,
    pub bc: f32,
    pub psi: f32,
    pub depth: f64,
    pub love: f32,
    pub xi: f64,
    pub gps_timestamp: i64,
}
