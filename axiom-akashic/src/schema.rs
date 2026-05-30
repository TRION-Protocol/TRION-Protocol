//! TimescaleDB schema management — DDL for the Akashic Index.

/// The full TimescaleDB schema for AXIOM.
/// See sql/akashic_schema.sql for executable form.
pub struct AkashicSchema;

impl AkashicSchema {
    /// Full schema DDL as a static string (for embedded migrations).
    pub fn ddl() -> &'static str {
        include_str!("../../sql/akashic_schema.sql")
    }
}
