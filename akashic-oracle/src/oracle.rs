use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use sha3::{Digest, Sha3_256};
use std::sync::Arc;
use tokio::time::{timeout, Duration};

// ---------------------------------------------------------------------------
// State shared across Axum handlers
// ---------------------------------------------------------------------------

pub struct OracleState {
    pub db: Option<sqlx::PgPool>,
    pub faiss_url: String,
    pub http_client: reqwest::Client,
}

// ---------------------------------------------------------------------------
// TRIONSignal — exact JSON schema consumed by on-chain integrators
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct TRIONSignal {
    pub signal_id: String,
    pub signal_type: String,
    pub entity_id: String,
    pub signal_value: f64,
    pub confidence_interval: [f64; 2],
    pub coherence: f64,
    pub threshold: f64,
    pub margin: f64,
    pub plane_breakdown: PlaneBreakdown,
    pub temporal_coherence: f64,
    pub entropy: f64,
    pub akashic_depth: f64,
    pub data_source: String,
    pub timestamp_ms: i64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PlaneBreakdown {
    pub physical: f64,
    pub mental: f64,
    pub spiritual: f64,
    pub conscious: f64,
    pub anima: f64,
    pub limiting_plane: String,
}

// Response from the Python FAISS service
#[derive(Deserialize)]
struct FaissResponse {
    mental_m: f64,
    #[serde(default)]
    closest_archetype: String,
    #[serde(default)]
    prediction_interval: f64,
    #[serde(default)]
    status: String,
}

// Shape of /tmp/trion_latest.json written by trion-l0
#[derive(Deserialize)]
struct L0State {
    coherence_score: Option<f64>,
    entropy: Option<f64>,
    mu_t: Option<f64>,
    is_stable: Option<bool>,
    timestamp: Option<u64>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn hex_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn generate_signal_id() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let hash = Sha3_256::digest(now.to_le_bytes());
    format!("0x{}", hex_bytes(&hash[..16]))
}

// ---------------------------------------------------------------------------
// Deterministic SILENCE builder — emitted on any failure path
// ---------------------------------------------------------------------------

pub fn build_silence_signal(entity_id: String, reason: &str) -> TRIONSignal {
    let now = chrono::Utc::now().timestamp_millis();
    TRIONSignal {
        signal_id: generate_signal_id(),
        signal_type: "SILENCE".to_string(),
        entity_id,
        signal_value: 0.0,
        confidence_interval: [0.0, 0.0],
        coherence: 0.0,
        threshold: 1.0,
        margin: -1.0,
        plane_breakdown: PlaneBreakdown {
            physical: 0.0,
            mental: 0.0,
            spiritual: 0.0,
            conscious: 0.0,
            anima: 0.0,
            limiting_plane: reason.to_string(),
        },
        temporal_coherence: 0.0,
        entropy: 0.0,
        akashic_depth: 0.0,
        data_source: "SILENCE_GATE".to_string(),
        timestamp_ms: now,
    }
}

// ---------------------------------------------------------------------------
// Physical Plane Φ(t) — sourced from /tmp/trion_latest.json (L0 daemon)
// ---------------------------------------------------------------------------

async fn fetch_physical_plane() -> Result<(f64, f64, f64), String> {
    let path = std::env::var("L0_STATE_PATH")
        .unwrap_or_else(|_| "/tmp/trion_latest.json".to_string());

    let raw = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Cannot read L0 state file {}: {}", path, e))?;

    let state: L0State = serde_json::from_str(&raw)
        .map_err(|e| format!("L0 state parse error: {}", e))?;

    // Staleness guard: data older than 60s triggers SILENCE
    if let Some(ts) = state.timestamp {
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let age = now_secs.saturating_sub(ts);
        if age > 60 {
            return Err(format!("L0 state is stale ({}s old) — a stale oracle is worse than no oracle", age));
        }
    }

    // AnomalyHunter stability check
    if let Some(false) = state.is_stable {
        return Err("L0 AnomalyHunter flagged instability — physical plane degraded".to_string());
    }

    let phi = state.coherence_score.unwrap_or(0.0);
    let entropy = state.entropy.unwrap_or(1.0);
    let mu_t = state.mu_t.unwrap_or(phi);
    Ok((phi, entropy, mu_t))
}

// ---------------------------------------------------------------------------
// Mental Plane M(t) — Python FAISS service, 5ms timeout, fail-closed
// ---------------------------------------------------------------------------

async fn fetch_mental_plane(
    client: &reqwest::Client,
    faiss_url: &str,
    entity_id: &str,
) -> f64 {
    let url = format!("{}/similarity/{}", faiss_url, entity_id);

    match timeout(Duration::from_millis(5), client.get(&url).send()).await {
        Ok(Ok(resp)) => match resp.json::<FaissResponse>().await {
            Ok(data) => {
                tracing::debug!(
                    "FAISS M(t)={:.4} archetype={} pi={:.2} status={}",
                    data.mental_m,
                    data.closest_archetype,
                    data.prediction_interval,
                    data.status
                );
                data.mental_m
            }
            Err(e) => {
                tracing::warn!("FAISS parse error: {} — M(t)=0.0 (fail-closed)", e);
                0.0
            }
        },
        Ok(Err(e)) => {
            tracing::warn!("FAISS request error: {} — M(t)=0.0 (fail-closed)", e);
            0.0
        }
        Err(_) => {
            tracing::warn!("FAISS query timed out (>5ms) — M(t)=0.0 (fail-closed)");
            0.0
        }
    }
}

// ---------------------------------------------------------------------------
// Dynamic threshold Θ(t)
// Base 0.70; increases under high entropy or low physical coherence
// ---------------------------------------------------------------------------

fn calculate_dynamic_threshold(phi: f64, entropy: f64) -> f64 {
    let base = 0.70_f64;
    let entropy_penalty = if entropy > 1.5 { 0.05 } else { 0.0 };
    let stress_penalty = if phi < 0.6 { 0.05 } else { 0.0 };
    (base + entropy_penalty + stress_penalty).min(0.95)
}

fn determine_limiting_plane(p: f64, m: f64, s: f64, k: f64, a: f64) -> String {
    let planes = [
        ("PHYSICAL", p),
        ("MENTAL", m),
        ("SPIRITUAL", s),
        ("CONSCIOUS", k),
        ("ANIMA", a),
    ];
    planes
        .iter()
        .min_by(|x, y| x.1.partial_cmp(&y.1).unwrap())
        .map(|(name, _)| name.to_string())
        .unwrap_or_else(|| "UNKNOWN".to_string())
}

// ---------------------------------------------------------------------------
// GET /api/v1/signal/:entity_id
// ---------------------------------------------------------------------------

pub async fn get_trion_signal(
    State(state): State<Arc<OracleState>>,
    Path(entity_id): Path<String>,
) -> Json<TRIONSignal> {
    let now_ms = chrono::Utc::now().timestamp_millis();

    // ── 1. Physical Plane — 10ms hard timeout ────────────────────────────
    let (physical_phi, entropy, _mu_t) = match timeout(
        Duration::from_millis(10),
        fetch_physical_plane(),
    )
    .await
    {
        Ok(Ok(result)) => result,
        Ok(Err(reason)) => {
            tracing::warn!("Physical plane fault: {} — SILENCE emitted", reason);
            return Json(build_silence_signal(entity_id, &reason));
        }
        Err(_) => {
            tracing::warn!("Physical plane timed out — SILENCE emitted");
            return Json(build_silence_signal(entity_id, "PHYSICAL_TIMEOUT"));
        }
    };

    // ── 2. Mental Plane — FAISS HTTP, 5ms timeout ────────────────────────
    let mental_m = fetch_mental_plane(&state.http_client, &state.faiss_url, &entity_id).await;

    // ── 3. S, K, A planes — pending BFT / Annotation / NLP engines ───────
    let spiritual_s: f64 = 0.98; // BFT Validator consensus (not yet wired)
    let conscious_k: f64 = 0.85; // Annotation network (not yet wired)
    let anima_a: f64 = 0.90;     // Off-chain NLP engine (not yet wired)

    // ── 4. Master Equation C(t) ───────────────────────────────────────────
    let coherence_ct = (physical_phi * 0.25)
        + (mental_m * 0.30)
        + (spiritual_s * 0.25)
        + (conscious_k * 0.10)
        + (anima_a * 0.10);

    // ── 5. Dynamic threshold Θ(t) ─────────────────────────────────────────
    let threshold_theta = calculate_dynamic_threshold(physical_phi, entropy);
    let margin = coherence_ct - threshold_theta;
    let limiting_plane =
        determine_limiting_plane(physical_phi, mental_m, spiritual_s, conscious_k, anima_a);

    // ── 6. Execution Gate ─────────────────────────────────────────────────
    let (signal_type, signal_value) = if coherence_ct >= threshold_theta {
        ("VALUATION".to_string(), physical_phi)
    } else {
        tracing::warn!(
            "SILENCE: C(t)={:.4} < Θ(t)={:.4} | entity={}",
            coherence_ct, threshold_theta, entity_id
        );
        ("SILENCE".to_string(), 0.0)
    };

    Json(TRIONSignal {
        signal_id: generate_signal_id(),
        signal_type,
        entity_id,
        signal_value,
        confidence_interval: [signal_value * 0.98, signal_value * 1.02],
        coherence: coherence_ct,
        threshold: threshold_theta,
        margin,
        plane_breakdown: PlaneBreakdown {
            physical: physical_phi,
            mental: mental_m,
            spiritual: spiritual_s,
            conscious: conscious_k,
            anima: anima_a,
            limiting_plane,
        },
        temporal_coherence: 0.99,
        entropy,
        akashic_depth: 0.0,
        data_source: "L0_FILE".to_string(),
        timestamp_ms: now_ms,
    })
}

// ---------------------------------------------------------------------------
// GET /api/v1/health
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub db_connected: bool,
    pub faiss_url: String,
    pub timestamp_ms: i64,
}

pub async fn health(State(state): State<Arc<OracleState>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        db_connected: state.db.is_some(),
        faiss_url: state.faiss_url.clone(),
        timestamp_ms: chrono::Utc::now().timestamp_millis(),
    })
}
