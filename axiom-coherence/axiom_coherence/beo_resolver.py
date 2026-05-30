"""
BEO Universal Resolver — Python implementation with FAISS.

Resolves behavioral identity across multiple entity representations
using FAISS for efficient high-dimensional similarity search.

From §9.6: L2 Entity Resolution uses FAISS (Inner Product similarity)
on 128-dimensional behavioral fingerprint vectors.
"""

import numpy as np
from typing import Optional, List, Tuple
import structlog

logger = structlog.get_logger()


class BEOResolver:
    """
    BEO Universal resolver using FAISS for fast similarity search.

    Behavioral fingerprint vector (128-dim):
        [0..31]   : UBE type frequency (32 dims, L1-normalized)
        [32..63]  : Temporal pattern features (inter-event timing distribution)
        [64..95]  : Co-occurrence matrix features (which events co-occur)
        [96..127] : Depth-weighted recency features (recent vs historical)
    """

    FINGERPRINT_DIM = 128
    MERGE_THRESHOLD = 0.75   # > 0.75 → same entity
    SEPARATE_THRESHOLD = 0.30  # < 0.30 → distinct entities

    def __init__(self, use_gpu: bool = False):
        try:
            import faiss
            self._faiss = faiss
            self.index = faiss.IndexFlatIP(self.FINGERPRINT_DIM)  # Inner product
            self._use_gpu = use_gpu
            if use_gpu:
                try:
                    res = faiss.StandardGpuResources()
                    self.index = faiss.index_cpu_to_gpu(res, 0, self.index)
                except Exception:
                    logger.warning("FAISS GPU not available, using CPU")
        except ImportError:
            self._faiss = None
            self.index = None
            logger.warning("FAISS not available — using brute-force cosine similarity")

        self.entity_registry: dict = {}  # index_id → bpi_hex
        self.fingerprints: dict = {}     # bpi_hex → fingerprint
        self._next_id = 0

    def register_entity(self, bpi: bytes, fingerprint: np.ndarray) -> None:
        """
        Register an entity's behavioral fingerprint.

        The fingerprint is L2-normalized before indexing (required for
        cosine similarity via inner product with unit vectors).
        """
        if fingerprint.shape != (self.FINGERPRINT_DIM,):
            raise ValueError(f"Fingerprint must be {self.FINGERPRINT_DIM}-dimensional")

        norm = np.linalg.norm(fingerprint)
        if norm < 1e-9:
            return  # Zero vector — entity has no behavioral signal yet

        normalized = (fingerprint / norm).astype(np.float32)
        bpi_hex = bpi.hex()

        if self._faiss and self.index is not None:
            self.index.add(normalized.reshape(1, -1))
        else:
            self.fingerprints[bpi_hex] = normalized

        self.entity_registry[self._next_id] = bpi_hex
        self._next_id += 1
        logger.debug("entity_registered", bpi=bpi_hex[:16])

    def resolve(self, fingerprint: np.ndarray, k: int = 5) -> List[Tuple[str, float]]:
        """
        Find the k most similar entities to the given fingerprint.

        Returns list of (bpi_hex, similarity_score) where similarity > 0.75
        indicates same-entity confidence.
        """
        norm = np.linalg.norm(fingerprint)
        if norm < 1e-9:
            return []

        query = (fingerprint / norm).astype(np.float32).reshape(1, -1)

        if self._faiss and self.index is not None and self.index.ntotal > 0:
            k = min(k, self.index.ntotal)
            distances, indices = self.index.search(query, k)
            results = [
                (self.entity_registry[int(idx)], float(dist))
                for idx, dist in zip(indices[0], distances[0])
                if idx >= 0 and int(idx) in self.entity_registry and dist > 0.0
            ]
        else:
            # Brute-force fallback
            results = []
            for bpi_hex, fp in self.fingerprints.items():
                sim = float(np.dot(query[0], fp))
                results.append((bpi_hex, sim))
            results.sort(key=lambda x: -x[1])
            results = results[:k]

        # Filter to same-entity candidates
        return [(bpi, score) for bpi, score in results if score > self.SEPARATE_THRESHOLD]

    def is_same_entity(self, fp_a: np.ndarray, fp_b: np.ndarray) -> Tuple[bool, float]:
        """
        Directly compare two behavioral fingerprints.

        Returns (is_same, confidence_score).
        """
        na = np.linalg.norm(fp_a)
        nb = np.linalg.norm(fp_b)
        if na < 1e-9 or nb < 1e-9:
            return False, 0.0

        similarity = float(np.dot(fp_a / na, fp_b / nb))
        return similarity > self.MERGE_THRESHOLD, similarity

    @staticmethod
    def compute_fingerprint(events: list, depth: float = 0.0) -> np.ndarray:
        """
        Compute a 128-dimensional behavioral fingerprint from a list of UBH events.

        Structure:
            [0..31]   : UBE type frequency (L1-normalized)
            [32..63]  : Inter-event timing distribution (32 time buckets)
            [64..95]  : UBE co-occurrence pairs (compressed)
            [96..127] : Depth-weighted recency (exponential decay on recent events)
        """
        fp = np.zeros(128, dtype=np.float32)
        if not events:
            return fp

        # [0..31]: UBE type frequency
        for e in events:
            ube = getattr(e, 'event_type', None) or e.get('event_type', 1)
            if hasattr(ube, 'value'):
                ube = ube.value
            idx = max(0, min(31, int(ube) - 1))
            fp[idx] += 1.0

        total = fp[:32].sum()
        if total > 0:
            fp[:32] /= total

        # [32..63]: Timing distribution (simplified: random for now, real = GPS deltas)
        timestamps = [
            e.get('gps_timestamp', 0) if isinstance(e, dict)
            else getattr(e, 'gps_timestamp', 0)
            for e in events
        ]
        if len(timestamps) > 1:
            deltas = np.diff(sorted(timestamps))
            if len(deltas) > 0 and deltas.max() > 0:
                # Map deltas into 32 log-scale buckets
                for delta in deltas:
                    if delta > 0:
                        bucket = min(31, int(np.log10(max(1, delta)) * 5))
                        fp[32 + bucket] += 1.0
                fp[32:64] /= max(1.0, fp[32:64].sum())

        # [64..95]: Co-occurrence features (simplified)
        for i in range(1, min(len(events), 100)):
            e1 = events[i - 1]
            e2 = events[i]
            t1 = getattr(e1, 'event_type', None) or e1.get('event_type', 1)
            t2 = getattr(e2, 'event_type', None) or e2.get('event_type', 1)
            if hasattr(t1, 'value'): t1 = t1.value
            if hasattr(t2, 'value'): t2 = t2.value
            pair_idx = (int(t1) * 32 + int(t2)) % 32
            fp[64 + pair_idx] += 1.0
        fp[64:96] /= max(1.0, fp[64:96].sum())

        # [96..127]: Depth-weighted recency (recent events matter more)
        decay_rate = 0.95
        for i, e in enumerate(reversed(events[-32:])):
            ube = getattr(e, 'event_type', None) or e.get('event_type', 1)
            if hasattr(ube, 'value'): ube = ube.value
            idx = max(0, min(31, int(ube) - 1))
            fp[96 + idx] += (decay_rate ** i)
        fp[96:128] /= max(1.0, fp[96:128].sum())

        return fp
