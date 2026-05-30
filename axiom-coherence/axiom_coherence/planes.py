"""
Five-Plane Behavioral Coherence Model.

BC(entity, t) = α·Φ + β·M + γ·Σ + δ·K + ε·A

Where:
    Φ (phi)   = Causal Flux / Entropy plane  — weight α = 0.25
    M (mu)    = Model Confidence plane        — weight β = 0.20
    Σ (sigma) = Network Consensus plane       — weight γ = 0.25
    K (kappa) = Environmental Context plane   — weight δ = 0.15
    A (alpha) = Adaptive Intelligence plane   — weight ε = 0.15

All planes ∈ [0, 1], result BC ∈ [0, 1].
"""

from dataclasses import dataclass
from typing import List, Dict, Optional, Sequence
import math
import numpy as np

# Plane weights
ALPHA = 0.25  # Φ causal flux
BETA  = 0.20  # M model confidence
GAMMA = 0.25  # Σ network consensus
DELTA = 0.15  # K environmental context
EPSILON = 0.15  # A adaptive intelligence

# Verify weights sum to 1.0
_WEIGHT_SUM = ALPHA + BETA + GAMMA + DELTA + EPSILON
assert abs(_WEIGHT_SUM - 1.0) < 1e-9, f"Plane weights must sum to 1.0, got {_WEIGHT_SUM}"


@dataclass
class CoherencePlanes:
    """Five-plane coherence scores for one entity at one time."""
    phi: float       # Causal Flux / Entropy ∈ [0,1]
    mu: float        # Model Confidence ∈ [0,1]
    sigma: float     # Network Consensus ∈ [0,1]
    kappa: float     # Environmental Context ∈ [0,1]
    alpha: float     # Adaptive Intelligence ∈ [0,1]

    def bc(self) -> float:
        """Compute BC(entity, t) = α·Φ + β·M + γ·Σ + δ·K + ε·A."""
        score = (
            ALPHA * self.phi +
            BETA  * self.mu +
            GAMMA * self.sigma +
            DELTA * self.kappa +
            EPSILON * self.alpha
        )
        return max(0.0, min(1.0, score))

    def dominant_plane(self) -> str:
        """Identify which plane is most affecting coherence."""
        weighted = {
            'phi':   ALPHA * self.phi,
            'mu':    BETA  * self.mu,
            'sigma': GAMMA * self.sigma,
            'kappa': DELTA * self.kappa,
            'alpha': EPSILON * self.alpha,
        }
        return min(weighted, key=weighted.get)  # lowest-weighted = greatest drag


def compute_bc(phi: float, mu: float, sigma: float, kappa: float, alpha: float) -> float:
    """Compute BC(entity, t) from five raw plane values."""
    return CoherencePlanes(phi, mu, sigma, kappa, alpha).bc()


def compute_phi(events: list) -> float:
    """
    Φ: Causal Flux / Entropy plane.

    Measures causal continuity — how smoothly behavior transitions.
    High Φ: smooth causal chain, expected transitions.
    Low Φ: abrupt transitions, hash chain breaks, entropy spikes.

    Formula:
        Φ = 1 - (causal_breaks / total_events)
        Where causal_break = UBH[n].prior_hash ≠ UBH[n-1].self_hash
    """
    if not events:
        return 0.5  # Unknown — return default

    total = len(events)
    breaks = 0

    for i in range(1, total):
        # Check causal chain continuity
        prev = events[i - 1]
        curr = events[i]
        if hasattr(prev, 'self_hash') and hasattr(curr, 'prior_hash'):
            if prev.self_hash != curr.prior_hash:
                breaks += 1

    return 1.0 - (breaks / total)


def compute_mu(events: list, trajectory_model=None) -> float:
    """
    M: Model Confidence plane.

    Measures how well the entity's behavior matches the L4 LSTM prediction.
    High M: behavior is predictable within the entity's own established patterns.
    Low M: behavior deviates significantly from the trajectory model's prediction.

    Formula:
        M = 1 - P(anomaly | trajectory_model)
        Where P(anomaly) = 1 - p(observed_event | model_distribution)
    """
    if trajectory_model is None or not events:
        return 0.8  # Default confidence without model

    # Get last event type
    last_event_type = getattr(events[-1], 'event_type', 1)

    # Query trajectory model for probability of this event type
    try:
        prob = trajectory_model.probability_of(last_event_type)
        return max(0.0, min(1.0, prob * 32.0))  # Normalize from 1/32 base
    except Exception:
        return 0.8


def compute_sigma(events: list, validator_signatures: Optional[Dict] = None) -> float:
    """
    Σ: Network Consensus plane.

    Measures agreement among validator nodes about this entity's behavior.
    High Σ: multiple independent validators agree on BC score.
    Low Σ: validator disagreement, possible Sybil attack or network partition.

    Formula:
        Σ = (agreeing_validators / total_validators) × (1 - byzantine_ratio)
    """
    if not events:
        return 0.5

    if validator_signatures is None:
        # No validator data: return moderate consensus
        return 0.70

    total_validators = len(validator_signatures)
    if total_validators == 0:
        return 0.5

    # Count validators that have signed recent events
    signed_validators = sum(1 for sig in validator_signatures.values() if sig is not None)
    return min(1.0, signed_validators / max(1, total_validators))


def compute_kappa(events: list, current_context: Optional[Dict] = None,
                  historical_context: Optional[Dict] = None) -> float:
    """
    K: Environmental Context plane.

    Measures consistency between current behavioral context and expected context.
    High K: entity is operating in its known environment (right network, right time).
    Low K: entity is in unexpected context (stolen device, location anomaly).

    Formula:
        K = similarity(current_context, historical_context)
    """
    if not events:
        return 0.5

    if current_context is None or historical_context is None:
        return 0.75  # Assume reasonable context without data

    # Compare key context signals
    signals = []

    # Network context
    curr_net = current_context.get('network_hash', '')
    hist_net = historical_context.get('network_hash', '')
    if curr_net and hist_net:
        signals.append(1.0 if curr_net == hist_net else 0.3)

    # Time-of-day pattern
    curr_hour = current_context.get('hour_of_day', -1)
    hist_hours = historical_context.get('typical_hours', [])
    if curr_hour >= 0 and hist_hours:
        signals.append(1.0 if curr_hour in hist_hours else 0.5)

    # Geographic proximity
    curr_lat = current_context.get('lat', 0.0)
    hist_lat = historical_context.get('typical_lat', 0.0)
    if curr_lat and hist_lat:
        dist = abs(curr_lat - hist_lat)
        signals.append(max(0.0, 1.0 - dist / 5.0))  # >5° latitude = 0

    return sum(signals) / max(1, len(signals)) if signals else 0.75


def compute_alpha(events: list, learning_trajectory: Optional[List[float]] = None) -> float:
    """
    A: Adaptive Intelligence plane.

    Measures whether the entity is demonstrating positive learning and adaptation.
    High A: entity is improving, solving novel problems, demonstrating intelligence.
    Low A: entity is stagnating, repeating errors, not adapting to environment.

    Formula:
        A = (positive_adaptations / (positive_adaptations + regressions))
    """
    if not events or learning_trajectory is None:
        return 0.7  # Default moderate adaptive intelligence

    if len(learning_trajectory) < 2:
        return 0.7

    # Count improvements vs regressions in the learning trajectory
    improvements = sum(1 for i in range(1, len(learning_trajectory))
                      if learning_trajectory[i] > learning_trajectory[i - 1])
    regressions = len(learning_trajectory) - 1 - improvements

    if improvements + regressions == 0:
        return 0.7

    return min(1.0, (improvements + 0.5) / (improvements + regressions + 1))


def dynamic_threshold(
    psi_base: float = 0.55,
    threat_level: float = 0.0,
    volatility: float = 0.0,
    depth: float = 0.0,
    alpha_threat: float = 0.20,
    beta_vol: float = 0.10,
    gamma_depth: float = 0.05,
) -> float:
    """
    Ψ(entity, t) = Ψ_base + α_threat·ThreatLevel + β_vol·Volatility − γ_depth·log(1+D)

    Dynamic coherence threshold that adapts to:
    - Threat level (raises during active attacks)
    - Volatility (raises in uncertain conditions)
    - Depth (lowers for deeply-established entities — earned trust)
    """
    psi = (
        psi_base
        + alpha_threat * threat_level
        + beta_vol * volatility
        - gamma_depth * math.log(1 + depth)
    )
    return max(0.10, min(0.99, psi))
