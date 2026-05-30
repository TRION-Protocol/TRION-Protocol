"""
AXIOM Coherence Engine — Layer 4.

Streams behavioral events from Kafka, computes five-plane BC(entity, t)
scores, and publishes CoherenceUpdate messages back to Kafka.

Uses a 60-second sliding window over behavioral events per entity.
Integrates with PyTorch LSTM for model confidence (M plane) and
trajectory pre-detection.

Implementation of §9.8 from the AXIOM whitepaper.
"""

import asyncio
import json
import logging
import math
import time
from collections import defaultdict, deque
from typing import Dict, List, Optional, Deque

import structlog

from .planes import (
    CoherencePlanes, compute_phi, compute_mu, compute_sigma,
    compute_kappa, compute_alpha, dynamic_threshold, compute_bc
)
from .models import TrajectoryPredictor

logger = structlog.get_logger()

# Constants
PSI_BASE = 0.55
ALPHA_THREAT = 0.20
BETA_VOL = 0.10
GAMMA_DEPTH = 0.05

WINDOW_SECONDS = 60
SLIDE_SECONDS = 1


class EntityState:
    """Per-entity coherence state maintained in memory."""

    def __init__(self, bpi: bytes):
        self.bpi = bpi
        self.bc = 0.8
        self.psi = PSI_BASE
        self.depth = 0.0
        self.love = 1.0
        self.silence = False
        self.event_window: Deque[dict] = deque(maxlen=10000)
        self.bc_history: List[float] = []
        self.threat_level = 0.0
        self.volatility = 0.0
        self.validator_sigs: Dict = {}
        self.learning_trajectory: List[float] = []
        self.silence_recovery_events = 0
        self.total_events = 0
        self.last_updated_ns = 0

    def update_bc(self, planes: CoherencePlanes):
        """Update BC from planes and check SILENCE condition."""
        new_bc = planes.bc()
        self.bc_history.append(new_bc)
        if len(self.bc_history) > 300:
            self.bc_history.pop(0)

        # Update volatility (std of last 60 BC scores)
        if len(self.bc_history) >= 10:
            recent = self.bc_history[-60:]
            mean = sum(recent) / len(recent)
            variance = sum((x - mean) ** 2 for x in recent) / len(recent)
            self.volatility = math.sqrt(variance)

        # Update dynamic threshold
        self.psi = dynamic_threshold(
            psi_base=PSI_BASE,
            threat_level=self.threat_level,
            volatility=self.volatility,
            depth=self.depth,
        )

        old_bc = self.bc
        self.bc = new_bc
        self.last_updated_ns = time.time_ns()

        # SILENCE check: BC < Ψ
        if new_bc < self.psi:
            self.silence = True
            self.silence_recovery_events = 0
            logger.warning(
                "entity_silenced",
                bpi=self.bpi.hex()[:16],
                bc=f"{new_bc:.4f}",
                psi=f"{self.psi:.4f}",
            )
        elif self.silence:
            # Recovery: require sustained BC ≥ Ψ for 300 events
            self.silence_recovery_events += 1
            if self.silence_recovery_events >= 300:
                self.silence = False
                logger.info(
                    "entity_silence_lifted",
                    bpi=self.bpi.hex()[:16],
                    bc=f"{new_bc:.4f}",
                )

    def xi(self, lambda_rate: float = 0.001) -> float:
        """Compute Ξ(entity, t) = [BC ≥ Ψ] · 1 · exp(Λ · D)."""
        if self.silence:
            return 0.0
        return math.exp(lambda_rate * self.depth)


class CoherenceEngine:
    """
    AXIOM Coherence Engine — Layer 4.

    Computes BC(entity, t) for all registered entities using the
    five-plane weighted model.

    Can run standalone (processing a queue) or integrated with
    Apache Flink via Kafka.
    """

    def __init__(
        self,
        trajectory_predictor: Optional[TrajectoryPredictor] = None,
        window_seconds: int = WINDOW_SECONDS,
    ):
        self.states: Dict[bytes, EntityState] = {}
        self.predictor = trajectory_predictor or TrajectoryPredictor()
        self.window_seconds = window_seconds
        self._processed = 0
        self._silenced = 0
        self._recovered = 0

    def register_entity(self, bpi: bytes, initial_depth: float = 0.0,
                        love: float = 1.0) -> EntityState:
        """Register an entity for coherence tracking."""
        if bpi not in self.states:
            state = EntityState(bpi)
            state.depth = initial_depth
            state.love = love
            self.states[bpi] = state
            logger.info("entity_registered", bpi=bpi.hex()[:16], depth=initial_depth)
        return self.states[bpi]

    def process_event(self, event: dict) -> Optional[dict]:
        """
        Process a UBH behavioral event.

        Returns a CoherenceUpdate dict if BC changed significantly,
        or None if the change is within noise.

        Args:
            event: dict with keys:
                entity_bpi (bytes), event_type (int), bc_at_event (float),
                depth_at_event (float), gps_timestamp (int)
        """
        bpi = event.get("entity_bpi")
        if bpi is None:
            return None

        if bpi not in self.states:
            self.register_entity(bpi)

        state = self.states[bpi]
        state.event_window.append(event)
        state.total_events += 1
        state.depth = event.get("depth_at_event", state.depth)

        # Observe in trajectory predictor (M plane)
        self.predictor.observe(
            bpi,
            event.get("event_type", 1),
            event.get("bc_at_event", 0.8),
            event.get("depth_at_event", 0.0),
            event.get("gps_timestamp", 0),
        )

        # Get events within sliding window
        window_events = self._get_window_events(state)

        # Compute five planes
        phi   = compute_phi(window_events)
        mu    = compute_mu(window_events, trajectory_model=None)
        sigma = compute_sigma(window_events, state.validator_sigs or None)
        kappa = compute_kappa(window_events)
        alpha = compute_alpha(window_events, state.learning_trajectory or None)

        planes = CoherencePlanes(phi, mu, sigma, kappa, alpha)
        old_bc = state.bc
        state.update_bc(planes)

        self._processed += 1

        # Pre-detection: check if next event is anomalous
        is_anomalous = self.predictor.is_anomalous(bpi, event.get("event_type", 1))

        # Only emit CoherenceUpdate if meaningful change
        if abs(state.bc - old_bc) > 0.005 or state.silence or is_anomalous:
            return self._build_coherence_update(state, planes, is_anomalous)

        return None

    def process_window(self, bpi: bytes, window_events: List[dict]) -> dict:
        """
        Process a full event window for an entity — used by Flink WindowFunction.

        Equivalent to CoherenceWindowFunction.apply() in §9.8.
        """
        if bpi not in self.states:
            self.register_entity(bpi)

        state = self.states[bpi]

        phi   = compute_phi(window_events)
        mu    = compute_mu(window_events)
        sigma = compute_sigma(window_events)
        kappa = compute_kappa(window_events)
        alpha = compute_alpha(window_events)

        bc = compute_bc(phi, mu, sigma, kappa, alpha)

        return {
            "entity_bpi": bpi.hex(),
            "bc": bc,
            "phi": phi,
            "mu": mu,
            "sigma": sigma,
            "kappa": kappa,
            "alpha": alpha,
            "timestamp": time.time_ns(),
        }

    def get_truth_state(self, bpi: bytes) -> Optional[dict]:
        """Get Ξ(entity, t) truth state snapshot."""
        state = self.states.get(bpi)
        if not state:
            return None
        return {
            "entity_bpi": bpi.hex(),
            "bc": state.bc,
            "psi": state.psi,
            "depth": state.depth,
            "love": state.love,
            "xi": state.xi(),
            "silence": state.silence,
            "total_events": state.total_events,
        }

    def is_silenced(self, bpi: bytes) -> bool:
        """SILENCE check: BC(entity,t) < Ψ(entity,t)?"""
        state = self.states.get(bpi)
        return state.silence if state else False

    def raise_threat_level(self, bpi: bytes, threat: float) -> None:
        """Raise Ψ threshold for an entity under attack."""
        if state := self.states.get(bpi):
            state.threat_level = max(state.threat_level, min(1.0, threat))
            state.psi = dynamic_threshold(
                threat_level=state.threat_level,
                depth=state.depth,
            )
            logger.info(
                "threat_raised",
                bpi=bpi.hex()[:16],
                threat=threat,
                new_psi=state.psi,
            )

    def metrics(self) -> dict:
        """Engine performance metrics."""
        silenced = sum(1 for s in self.states.values() if s.silence)
        return {
            "entities_tracked": len(self.states),
            "events_processed": self._processed,
            "entities_silenced": silenced,
        }

    def _get_window_events(self, state: EntityState) -> List[dict]:
        """Get events within the sliding window."""
        now_ns = time.time_ns()
        cutoff_ns = now_ns - self.window_seconds * 1_000_000_000
        return [
            e for e in state.event_window
            if e.get("gps_timestamp", 0) >= cutoff_ns
        ]

    def _build_coherence_update(
        self, state: EntityState, planes: CoherencePlanes, anomaly: bool
    ) -> dict:
        return {
            "entity_bpi": state.bpi.hex(),
            "bc": state.bc,
            "psi": state.psi,
            "depth": state.depth,
            "silence": state.silence,
            "xi": state.xi(),
            "planes": {
                "phi": planes.phi,
                "mu": planes.mu,
                "sigma": planes.sigma,
                "kappa": planes.kappa,
                "alpha": planes.alpha,
            },
            "anomaly_detected": anomaly,
            "timestamp_ns": state.last_updated_ns,
        }
