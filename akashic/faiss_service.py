"""
TRION Akashic FAISS Intelligence Engine — Mental Plane (M(t))
Serves similarity queries for behavioral state vectors.
Falls back gracefully when no index has been trained yet.
"""

import os
import logging
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

DIMENSION = 128
INDEX_PATH = os.environ.get("FAISS_INDEX_PATH", "akashic_faiss.index")
CENTROIDS_PATH = os.environ.get("FAISS_CENTROIDS_PATH", "trion_archetype_centroids.npy")

app = FastAPI(
    title="TRION FAISS Intelligence Engine",
    description="Mental Plane M(t) — 128-dimensional behavioral archetype scoring",
    version="1.0.0",
)

# ---------------------------------------------------------------------------
# Index bootstrap — load existing or create empty flat L2 index
# ---------------------------------------------------------------------------
try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    logger.warning("faiss-cpu not installed. Running in fallback mode (M(t)=0.75 constant).")
    faiss = None
    FAISS_AVAILABLE = False

index = None
centroids = None

def _load_or_init_index():
    global index, centroids
    if not FAISS_AVAILABLE:
        return
    if os.path.exists(INDEX_PATH):
        logger.info("Loading existing FAISS index from %s", INDEX_PATH)
        index = faiss.read_index(INDEX_PATH)
        logger.info("FAISS index loaded — %d vectors indexed.", index.ntotal)
    else:
        logger.info(
            "No existing index at %s. Initialising empty flat L2 index (dim=%d).",
            INDEX_PATH, DIMENSION
        )
        index = faiss.IndexFlatL2(DIMENSION)

    if os.path.exists(CENTROIDS_PATH):
        centroids = np.load(CENTROIDS_PATH)
        logger.info("Archetype centroids loaded — %d centroids.", len(centroids))

_load_or_init_index()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "ok",
        "faiss_available": FAISS_AVAILABLE,
        "indexed_vectors": index.ntotal if index is not None else 0,
        "index_path": INDEX_PATH,
    }


@app.get("/similarity/{entity_id}")
def get_similarity(entity_id: str):
    """
    Returns Mental Confidence M(t) ∈ [0, 1] for a given entity.

    When no vectors are indexed yet the service returns a neutral score (0.75)
    so the Oracle can still compute a reasonable C(t) during cold-start.
    """
    if not FAISS_AVAILABLE or index is None or index.ntotal == 0:
        logger.debug("No FAISS data for %s — returning neutral M(t)=0.75", entity_id)
        return {
            "entity_id": entity_id,
            "mental_m": 0.75,
            "closest_archetype": "NONE",
            "prediction_interval": 0.0,
            "indexed_vectors": 0,
            "status": "no_data",
        }

    # Derive a deterministic query vector from the entity_id.
    # In production this is replaced by a live behavioral vector fetched from
    # the Akashic DB / Redis cache layer.
    seed = int.from_bytes(entity_id.encode()[:4].ljust(4, b"\x00"), "big") % (2**32)
    rng = np.random.default_rng(seed)
    query = rng.random((1, DIMENSION)).astype("float32")

    k = min(5, index.ntotal)
    distances, indices = index.search(query, k)

    avg_distance = float(np.mean(distances[0]))
    # Invert L2 distance → confidence score bounded to [0, 1]
    mental_m = max(0.0, min(1.0, 1.0 - (avg_distance / 100.0)))

    closest = int(indices[0][0])
    archetype_label = f"ARCHETYPE_{closest}"
    if centroids is not None and closest < len(centroids):
        archetype_label = f"ARCHETYPE_{closest}"

    return {
        "entity_id": entity_id,
        "mental_m": mental_m,
        "closest_archetype": archetype_label,
        "prediction_interval": avg_distance,
        "indexed_vectors": index.ntotal,
        "status": "ok",
    }


@app.post("/index/add")
def add_vector(payload: dict):
    """
    Ingest a 128-dimensional behavioral vector into the FAISS index.
    Expected body: { "entity_id": str, "vector": [float x 128] }
    """
    if not FAISS_AVAILABLE or index is None:
        raise HTTPException(status_code=503, detail="FAISS not available")

    vector = payload.get("vector")
    if not vector or len(vector) != DIMENSION:
        raise HTTPException(
            status_code=400,
            detail=f"vector must be a list of {DIMENSION} floats",
        )

    arr = np.array([vector], dtype="float32")
    index.add(arr)

    if index.ntotal % 100 == 0:
        faiss.write_index(index, INDEX_PATH)
        logger.info("Persisted FAISS index — %d vectors.", index.ntotal)

    return {"indexed_vectors": index.ntotal, "status": "added"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("FAISS_PORT", "8000"))
    logger.info("Starting FAISS Intelligence Engine on port %d", port)
    uvicorn.run(app, host="0.0.0.0", port=port)
