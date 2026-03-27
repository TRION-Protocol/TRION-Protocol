mod oracle;

use axum::{routing::get, Router};
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

#[tokio::main]
async fn main() {
    dotenv::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("akashic_oracle=info".parse().unwrap())
                .add_directive("tower_http=warn".parse().unwrap()),
        )
        .init();

    tracing::info!("╔══════════════════════════════════════════════════╗");
    tracing::info!("║      TRION Akashic Oracle — L2 Query Engine      ║");
    tracing::info!("╚══════════════════════════════════════════════════╝");

    let db_pool = match std::env::var("DATABASE_URL") {
        Ok(url) => match sqlx::PgPool::connect(&url).await {
            Ok(pool) => {
                tracing::info!("TimescaleDB connected");
                Some(pool)
            }
            Err(e) => {
                tracing::warn!("TimescaleDB unavailable: {}. Running in L0-file mode.", e);
                None
            }
        },
        Err(_) => {
            tracing::warn!("DATABASE_URL not set. Sourcing Φ(t) from /tmp/trion_latest.json");
            None
        }
    };

    let faiss_url = std::env::var("FAISS_SERVICE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:8000".to_string());

    tracing::info!("FAISS service endpoint: {}", faiss_url);

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(5))
        .build()
        .expect("Failed to build HTTP client");

    let state = Arc::new(oracle::OracleState {
        db: db_pool,
        faiss_url,
        http_client,
    });

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/v1/signal/:entity_id", get(oracle::get_trion_signal))
        .route("/api/v1/health", get(oracle::health))
        .with_state(state)
        .layer(cors);

    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(3002);

    let addr = format!("0.0.0.0:{}", port);
    tracing::info!("Oracle API listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("Failed to bind {}: {}", addr, e));

    axum::serve(listener, app).await.unwrap();
}
