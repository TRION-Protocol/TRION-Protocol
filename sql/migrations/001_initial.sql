-- AXIOM Akashic Index — Migration 001: Initial Schema
--
-- This migration creates the full Akashic Index schema.
-- Run this on a fresh PostgreSQL 16 instance with TimescaleDB extension.
--
-- Usage:
--   psql $DATABASE_URL -f sql/migrations/001_initial.sql
--
-- Author: Hudu Yusuf (Analys), @The_analys
-- License: CC0 1.0 Universal

-- Record migration metadata
CREATE TABLE IF NOT EXISTS schema_migrations (
    version         TEXT        PRIMARY KEY,
    applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    description     TEXT        NOT NULL
);

INSERT INTO schema_migrations (version, description)
VALUES ('001', 'Initial AXIOM Akashic Index schema')
ON CONFLICT DO NOTHING;

-- Apply the full schema
\i akashic_schema.sql
