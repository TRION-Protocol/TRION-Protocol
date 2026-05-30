-- ============================================================================
-- AXIOM Akashic Index — TimescaleDB Schema
-- Layer 3: Living Akashic Index
-- 
-- Author: Hudu Yusuf (Analys), @The_analys
-- License: CC0 1.0 Universal (Public Domain)
-- ============================================================================

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ============================================================================
-- CORE TABLE: akashic_events
--
-- The immutable record of all behavioral events.
-- Every UBH (Universal Behavioral Hash) is stored here exactly once.
-- Append-Only enforced by ROW SECURITY and trigger.
-- ============================================================================

CREATE TABLE IF NOT EXISTS akashic_events (
    -- Time partition column (TimescaleDB uses this for chunking)
    gps_timestamp       BIGINT      NOT NULL,  -- GPS nanoseconds since epoch
    device_timestamp    BIGINT      NOT NULL,  -- Device clock nanoseconds

    -- Entity identity
    entity_bpi          BYTEA       NOT NULL,  -- 32-byte Behavioral Process Identity hash
    
    -- Event classification
    event_type          SMALLINT    NOT NULL,  -- UBEType enum (1-32)
    event_subtype       SMALLINT    NOT NULL DEFAULT 0,

    -- Causal chain (the behavioral ledger)
    prior_hash          BYTEA       NOT NULL,  -- UBH[n-1].self_hash
    causal_context      BYTEA       NOT NULL,  -- Rolling causal context hash
    self_hash           BYTEA       NOT NULL,  -- Blake3 of all other fields (PK equivalent)

    -- Environment
    environment_hash    BYTEA       NOT NULL,  -- L0 environmental context hash

    -- Payload (max 4KB by application constraint)
    event_payload       BYTEA       NOT NULL DEFAULT '',

    -- Physical attestation
    entropy_proof       BYTEA       NOT NULL,  -- L0 GPS+HSM entropy proof
    validator_sig       BYTEA       NOT NULL,  -- Validator node signature

    -- Derived (computed by coherence engine, stored for fast retrieval)
    bc_at_event         REAL        NOT NULL DEFAULT 0.0,  -- BC(entity,t) snapshot
    depth_at_event      DOUBLE PRECISION NOT NULL DEFAULT 0.0,  -- D(entity,t) snapshot

    -- Constraints
    CONSTRAINT ubh_self_hash_unique UNIQUE (self_hash),
    CONSTRAINT ubh_event_type_valid CHECK (event_type BETWEEN 1 AND 32),
    CONSTRAINT ubh_bc_range CHECK (bc_at_event BETWEEN 0.0 AND 1.0),
    CONSTRAINT ubh_depth_nonneg CHECK (depth_at_event >= 0.0),
    CONSTRAINT ubh_bpi_length CHECK (length(entity_bpi) = 32),
    CONSTRAINT ubh_prior_hash_length CHECK (length(prior_hash) = 32),
    CONSTRAINT ubh_self_hash_length CHECK (length(self_hash) = 32)
);

-- Convert to TimescaleDB hypertable (partition by GPS timestamp, 1-day chunks)
SELECT create_hypertable(
    'akashic_events',
    by_range('gps_timestamp', 86400000000000)  -- 1 day in nanoseconds
);

-- ============================================================================
-- APPEND-ONLY ENFORCEMENT
-- No UPDATE or DELETE is permitted on akashic_events.
-- Invariant I1: Events are never modified or deleted.
-- ============================================================================

CREATE OR REPLACE FUNCTION enforce_append_only()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'AXIOM Invariant I1: akashic_events is append-only. UPDATE is forbidden.';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'AXIOM Invariant I1: akashic_events is append-only. DELETE is forbidden.';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER akashic_append_only
    BEFORE UPDATE OR DELETE ON akashic_events
    FOR EACH ROW EXECUTE FUNCTION enforce_append_only();

-- ============================================================================
-- INDEXES for common query patterns
-- ============================================================================

-- Entity time-range queries (most common)
CREATE INDEX IF NOT EXISTS idx_akashic_bpi_ts
    ON akashic_events (entity_bpi, gps_timestamp DESC);

-- Self-hash lookups (chain verification)
CREATE INDEX IF NOT EXISTS idx_akashic_self_hash
    ON akashic_events (self_hash);

-- Prior-hash lookups (chain traversal)
CREATE INDEX IF NOT EXISTS idx_akashic_prior_hash
    ON akashic_events (prior_hash);

-- Event type analytics
CREATE INDEX IF NOT EXISTS idx_akashic_event_type
    ON akashic_events (event_type, gps_timestamp DESC);

-- ============================================================================
-- MATERIALIZED VIEW: entity_depth
--
-- Pre-computed cumulative Akashic Depth D(entity, t) per entity per hour.
-- Updated by TimescaleDB continuous aggregate.
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS entity_depth
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', to_timestamp(gps_timestamp / 1e9)) AS hour,
    entity_bpi,
    count(*)                           AS event_count,
    avg(bc_at_event)                   AS avg_bc,
    max(depth_at_event)                AS cumulative_depth,
    sum(bc_at_event * depth_at_event)  AS weighted_depth_sum
FROM akashic_events
GROUP BY time_bucket('1 hour', to_timestamp(gps_timestamp / 1e9)), entity_bpi
WITH NO DATA;

SELECT add_continuous_aggregate_policy('entity_depth',
    start_offset => INTERVAL '2 hours',
    end_offset   => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute'
);

-- ============================================================================
-- MATERIALIZED VIEW: entity_coherence_5min
--
-- Rolling 5-minute BC (behavioral coherence) aggregate per entity.
-- Primary input for the Coherence Engine.
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS entity_coherence_5min
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('5 minutes', to_timestamp(gps_timestamp / 1e9)) AS bucket,
    entity_bpi,
    count(*)                     AS events_in_window,
    avg(bc_at_event)             AS avg_bc,
    min(bc_at_event)             AS min_bc,
    max(bc_at_event)             AS max_bc,
    stddev(bc_at_event)          AS bc_stddev,
    -- Event type frequency distribution (for BIS trajectory analysis)
    count(*) FILTER (WHERE event_type = 21)  AS execute_count,
    count(*) FILTER (WHERE event_type = 22)  AS read_count,
    count(*) FILTER (WHERE event_type = 23)  AS write_count,
    count(*) FILTER (WHERE event_type = 24)  AS spawn_count,
    count(*) FILTER (WHERE event_type = 25)  AS terminate_count
FROM akashic_events
GROUP BY time_bucket('5 minutes', to_timestamp(gps_timestamp / 1e9)), entity_bpi
WITH NO DATA;

SELECT add_continuous_aggregate_policy('entity_coherence_5min',
    start_offset => INTERVAL '15 minutes',
    end_offset   => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute'
);

-- ============================================================================
-- TABLE: entity_truth_state
--
-- Latest Ξ(entity, t) truth state snapshot per entity.
-- Updated by coherence engine after every BC computation.
-- ============================================================================

CREATE TABLE IF NOT EXISTS entity_truth_state (
    entity_bpi      BYTEA       NOT NULL,
    bc              REAL        NOT NULL,  -- BC(entity, t) ∈ [0, 1]
    psi             REAL        NOT NULL,  -- Ψ(entity, t) dynamic threshold
    depth           DOUBLE PRECISION NOT NULL,  -- D(entity, t)
    love            REAL        NOT NULL,  -- Love coefficient
    xi              DOUBLE PRECISION NOT NULL,  -- Ξ(entity, t) master equation result
    silence_state   SMALLINT    NOT NULL DEFAULT 0,  -- 0=operational, 1=silenced, 2=recovering
    gps_timestamp   BIGINT      NOT NULL,

    PRIMARY KEY (entity_bpi),
    CONSTRAINT truth_bc_range  CHECK (bc  BETWEEN 0.0 AND 1.0),
    CONSTRAINT truth_psi_range CHECK (psi BETWEEN 0.0 AND 1.0),
    CONSTRAINT truth_love_range CHECK (love BETWEEN 0.0 AND 1.0),
    CONSTRAINT truth_depth_nonneg CHECK (depth >= 0.0)
);

CREATE INDEX IF NOT EXISTS idx_truth_state_xi
    ON entity_truth_state (xi DESC);

-- ============================================================================
-- TABLE: bis_interrupts
--
-- Behavioral Interrupt System log — all BIS events from L5.
-- ============================================================================

CREATE TABLE IF NOT EXISTS bis_interrupts (
    id              BIGSERIAL   PRIMARY KEY,
    gps_timestamp   BIGINT      NOT NULL,
    entity_bpi      BYTEA       NOT NULL,
    traj_score      REAL        NOT NULL,
    bis_level       SMALLINT    NOT NULL,  -- 1=L1, 2=L2, 3=L3, 4=L4
    bc_at_interrupt REAL        NOT NULL,
    depth_at_interrupt DOUBLE PRECISION NOT NULL,
    causal_context  BYTEA       NOT NULL,
    anomaly_types   SMALLINT[]  NOT NULL DEFAULT '{}',
    expected_types  SMALLINT[]  NOT NULL DEFAULT '{}',
    resolved        BOOLEAN     NOT NULL DEFAULT FALSE,
    resolved_by     BYTEA,  -- BPI of IKP component that resolved it

    CONSTRAINT bis_level_valid CHECK (bis_level BETWEEN 1 AND 4)
);

SELECT create_hypertable(
    'bis_interrupts',
    by_range('gps_timestamp', 86400000000000)
);

CREATE INDEX IF NOT EXISTS idx_bis_entity_ts
    ON bis_interrupts (entity_bpi, gps_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_bis_level
    ON bis_interrupts (bis_level, gps_timestamp DESC);

-- ============================================================================
-- TABLE: rcp_connections
--
-- Resonance Communication Protocol connection state.
-- Active resonant connections between entities.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rcp_connections (
    entity_a        BYTEA       NOT NULL,
    entity_b        BYTEA       NOT NULL,
    resonance_score REAL        NOT NULL,
    established_at  BIGINT      NOT NULL,
    last_active     BIGINT      NOT NULL,
    packet_count    BIGINT      NOT NULL DEFAULT 0,

    PRIMARY KEY (entity_a, entity_b),
    CONSTRAINT rcp_resonance_valid CHECK (resonance_score BETWEEN 0.0 AND 1.0),
    CONSTRAINT rcp_above_threshold CHECK (resonance_score > 0.15)
);

-- ============================================================================
-- TABLE: ikp_immune_memory
--
-- IKP MEMORY_LAYER — permanent record of characterized attacks.
-- Used by CRISPR_LAYER for proactive immunization.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ikp_immune_memory (
    attack_signature    BYTEA       PRIMARY KEY,  -- 32-byte behavioral attack fingerprint
    crispr_edit         TEXT        NOT NULL,
    immunity_proof      BYTEA       NOT NULL,
    first_seen_ns       BIGINT      NOT NULL,
    seen_count          BIGINT      NOT NULL DEFAULT 1,
    prevented_count     BIGINT      NOT NULL DEFAULT 0,
    entity_type         TEXT        NOT NULL DEFAULT 'any'
);

-- ============================================================================
-- TABLE: resonance_frequency_vectors
--
-- Per-entity 32-dimensional behavioral frequency vectors.
-- Primary input for RCP resonance computation (cosine similarity).
-- ============================================================================

CREATE TABLE IF NOT EXISTS resonance_frequency_vectors (
    entity_bpi          BYTEA       PRIMARY KEY,
    rf_vector           REAL[32]    NOT NULL,  -- 32-dim UBE frequency vector
    computed_at         BIGINT      NOT NULL,
    event_window_count  INT         NOT NULL
);

-- ============================================================================
-- COMPRESSION POLICY (TimescaleDB Enterprise)
-- Compress chunks older than 7 days to columnar format.
-- ============================================================================

ALTER TABLE akashic_events SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'entity_bpi',
    timescaledb.compress_orderby = 'gps_timestamp DESC'
);

SELECT add_compression_policy('akashic_events', INTERVAL '7 days');

-- ============================================================================
-- RETENTION POLICY
-- Move events older than 1 year to IPFS (handled by external archival daemon).
-- EVENTS ARE NEVER DELETED from the Akashic Index — only tiered.
-- ============================================================================

-- Note: External archival daemon handles IPFS tiering.
-- TimescaleDB retention policy moves to cold storage, not deletion.

-- ============================================================================
-- INITIAL SYSTEM ENTITY: AXIOM Genesis
-- ============================================================================

INSERT INTO entity_truth_state (entity_bpi, bc, psi, depth, love, xi, gps_timestamp)
VALUES (
    decode('6178696f6d3a67656e657369733a323032363a626568617669', 'hex') || repeat(E'\\x00', 32-18),
    1.0,  -- Genesis BC = 1.0 (perfect coherence)
    0.55, -- Default Ψ threshold
    0.0,  -- Genesis depth = 0
    1.0,  -- Love = 1.0
    1.0,  -- Ξ = 1.0 at genesis
    1735689600000000000  -- 2026-01-01 00:00:00 UTC in nanoseconds (GPS epoch)
)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- GRANTS (adjust for your deployment)
-- ============================================================================

-- GRANT SELECT, INSERT ON akashic_events TO axiom_validator;
-- GRANT SELECT ON entity_depth TO axiom_coherence;
-- GRANT SELECT ON entity_coherence_5min TO axiom_coherence;
-- GRANT ALL ON entity_truth_state TO axiom_coherence;
-- GRANT ALL ON bis_interrupts TO axiom_kernel;
-- GRANT ALL ON rcp_connections TO axiom_rcp;
-- GRANT ALL ON ikp_immune_memory TO axiom_kernel;
-- GRANT ALL ON resonance_frequency_vectors TO axiom_rcp;
