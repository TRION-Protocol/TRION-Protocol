# AXIOM Coherence Engine — Layer 4
#
# Streams behavioral events from Kafka and computes five-plane BC scores.
# Publishes coherence updates back to Kafka for L5 and L6 consumption.
#
# Author: Hudu Yusuf (Analys), @The_analys
# License: CC0 1.0 Universal

from .engine import CoherenceEngine
from .planes import CoherencePlanes, compute_bc
from .models import BehavioralLSTM, TrajectoryPredictor
from .beo_resolver import BEOResolver

__all__ = ["CoherenceEngine", "CoherencePlanes", "compute_bc", "BehavioralLSTM", "TrajectoryPredictor", "BEOResolver"]
__version__ = "D(AXIOM,t)"  # No discrete version — only depth
