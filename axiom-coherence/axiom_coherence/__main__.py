"""
AXIOM Coherence Engine — entrypoint for `python -m axiom_coherence`.
"""

import asyncio
import logging
import os
import structlog

from .engine import CoherenceEngine

structlog.configure(
    wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
)
logger = structlog.get_logger()


async def main():
    logger.info("AXIOM Coherence Engine starting", version="D(AXIOM,t)")

    engine = CoherenceEngine()

    logger.info("Coherence engine ready", entities=0)

    # In production: consume from Kafka and process events
    # For now: run health check loop
    while True:
        metrics = engine.metrics()
        logger.info("engine_metrics", **metrics)
        await asyncio.sleep(60)


if __name__ == "__main__":
    asyncio.run(main())
