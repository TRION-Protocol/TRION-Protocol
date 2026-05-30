/**
 * AXIOM TypeScript SDK
 *
 * Universal interface to the AXIOM behavioral truth substrate.
 * Implements the Cross-Domain Behavioral Interface (CDBI — Invention #17).
 *
 * @packageDocumentation
 * @author Hudu Yusuf (Analys), @The_analys
 * @license CC0-1.0
 */

export { AXIOMClient, AXIOMClientConfig } from './client';
export {
    UBEType,
    TruthState,
    CoherencePlanes,
    BISInterrupt,
    BISLevel,
    SilenceState,
    EntityRole,
    RCPPacket,
    UniversalBehavioralHash,
    BEOResult,
    BEOConfidence,
} from './types';
export { BehavioralEntity } from './cdbi';
export { useAXIOM, useEntityTruthState, useEntityCoherence } from './hooks';

/** AXIOM SDK version — always "D(AXIOM,t)", no discrete version. */
export const AXIOM_VERSION = 'D(AXIOM,t)';

/**
 * The AXIOM Master Equation: Ξ(entity, t) = [BC ≥ Ψ] · Ε · exp(Λ · D)
 */
export function masterEquation(
    bc: number,
    psi: number,
    epsilon: number,
    lambda: number,
    depth: number,
): number {
    const coherenceGate = bc >= psi ? 1.0 : 0.0;
    return coherenceGate * epsilon * Math.exp(lambda * depth);
}

/**
 * Compute BC(entity, t) = α·Φ + β·M + γ·Σ + δ·K + ε·A
 */
export function computeBC(planes: {
    phi: number;
    mu: number;
    sigma: number;
    kappa: number;
    alpha: number;
}): number {
    const result =
        0.25 * planes.phi +
        0.20 * planes.mu +
        0.25 * planes.sigma +
        0.15 * planes.kappa +
        0.15 * planes.alpha;
    return Math.max(0, Math.min(1, result));
}

/**
 * Compute dynamic threshold Ψ(entity, t)
 * Ψ = Ψ_base + α_threat·ThreatLevel + β_vol·Volatility − γ_depth·log(1+D)
 */
export function computePsi(
    threatLevel: number = 0,
    volatility: number = 0,
    depth: number = 0,
): number {
    const psiBase = 0.55;
    const alphaThreat = 0.20;
    const betaVol = 0.10;
    const gammaDepth = 0.05;

    const psi =
        psiBase +
        alphaThreat * threatLevel +
        betaVol * volatility -
        gammaDepth * Math.log(1 + depth);

    return Math.max(0.10, Math.min(0.99, psi));
}

/**
 * Compute RCP resonance (cosine similarity of RF vectors).
 * RCP(Ei, Ej) = RF(Ei)·RF(Ej) / (|RF(Ei)| · |RF(Ej)|)
 */
export function computeResonance(rfA: Float32Array, rfB: Float32Array): number {
    if (rfA.length !== rfB.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < rfA.length; i++) {
        dot += rfA[i] * rfB[i];
        normA += rfA[i] * rfA[i];
        normB += rfB[i] * rfB[i];
    }
    if (normA < 1e-9 || normB < 1e-9) return 0;
    return dot / Math.sqrt(normA * normB);
}

/** Governance weight GovWeight = BC × D × Love */
export function governanceWeight(bc: number, depth: number, love: number): number {
    return bc * depth * love;
}
