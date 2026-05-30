/**
 * Cross-Domain Behavioral Interface (CDBI) — Invention #17.
 *
 * Single interface that works identically for:
 *   - Linux kernel processes
 *   - Smart contracts (via TRIONOracleV4)
 *   - IoT microcontrollers (via AXIOM-C runtime)
 *   - AI models (via AXIOM Python SDK)
 *   - Human users (via AXIOM identity daemon)
 *   - Physical sensors (via AXIOM WASM runtime)
 *
 * This is the meaning of "universal substrate."
 */

import { BPI, TruthState, UniversalBehavioralHash, ResonanceVector, UBEType } from './types';

/**
 * CDBI interface — implemented by every AXIOM entity.
 *
 * No entity type receives special treatment.
 * An AI model and a blockchain wallet are scored by the same formula.
 * A government institution and a microcontroller speak the same protocol.
 */
export interface BehavioralEntity {
    // ── Identity ──────────────────────────────────────────────────────────

    /** Get current BPI at time t. */
    getBPI(t?: Date): Promise<BPI>;

    /** Get D(entity, t) — Akashic Depth. */
    getDepth(t?: Date): Promise<number>;

    // ── Coherence ─────────────────────────────────────────────────────────

    /** Get BC(entity, t) ∈ [0, 1]. */
    getCoherence(t?: Date): Promise<number>;

    /** Get Ψ(entity, t) dynamic threshold. */
    getThreshold(t?: Date): Promise<number>;

    /** Is entity SILENCED? (BC < Ψ → output blocked). */
    isSilenced(t?: Date): Promise<boolean>;

    // ── Behavioral History ────────────────────────────────────────────────

    /** Get events between two timestamps. */
    getEvents(from: Date, to: Date): Promise<UniversalBehavioralHash[]>;

    // ── Communication (RCP) ───────────────────────────────────────────────

    /** Get 32-dim resonance frequency vector RF(entity, t). */
    getResonanceVector(t?: Date): Promise<ResonanceVector>;

    /** Compute RCP resonance with another entity. */
    getResonanceWith(other: BehavioralEntity): Promise<number>;

    // ── Truth State ───────────────────────────────────────────────────────

    /** Get Ξ(entity, t) — behavioral truth value. */
    getTruthState(t?: Date): Promise<TruthState>;

    // ── Event Emission ────────────────────────────────────────────────────

    /** Emit a behavioral event. Returns the UBH record. */
    emitEvent(eventType: UBEType, payload?: Uint8Array): Promise<UniversalBehavioralHash>;
}

/**
 * Minimal CDBI implementation for browser/Node.js entities.
 *
 * Wraps an AXIOMClient to expose the standard CDBI interface.
 */
export class LocalBehavioralEntity implements Partial<BehavioralEntity> {
    private bpi: string;
    private eventHistory: UniversalBehavioralHash[] = [];
    private rfVector = new Float32Array(32).fill(1.0 / 32.0);
    private bc = 0.8;
    private psi = 0.55;
    private depth = 0.0;
    private love = 1.0;

    constructor(bpi: string) {
        this.bpi = bpi;
    }

    async getBPI(): Promise<BPI> { return this.bpi; }
    async getDepth(): Promise<number> { return this.depth; }
    async getCoherence(): Promise<number> { return this.bc; }
    async getThreshold(): Promise<number> { return this.psi; }
    async isSilenced(): Promise<boolean> { return this.bc < this.psi; }
    async getEvents(): Promise<UniversalBehavioralHash[]> { return this.eventHistory; }
    async getResonanceVector(): Promise<ResonanceVector> { return this.rfVector; }

    async getTruthState(): Promise<TruthState> {
        const lambda = 0.001;
        const xi = this.bc >= this.psi
            ? Math.exp(lambda * this.depth)
            : 0;

        return {
            entityBpi: this.bpi,
            xi,
            bc: this.bc,
            psi: this.psi,
            depth: this.depth,
            silence: this.bc < this.psi ? 'silenced' as any : 'operational' as any,
            love: this.love,
            gpsTimestamp: BigInt(Date.now()) * 1_000_000n,
        };
    }

    async getResonanceWith(other: BehavioralEntity): Promise<number> {
        const otherRf = await other.getResonanceVector?.();
        if (!otherRf) return 0;
        const { computeResonance } = await import('./index');
        return computeResonance(this.rfVector, otherRf);
    }

    /** Update BC after receiving coherence update from L4 engine. */
    updateCoherence(bc: number, psi: number, depth: number): void {
        this.bc = bc;
        this.psi = psi;
        this.depth = depth;
        // Update RF vector from recent event history
        this.updateRF();
    }

    private updateRF(): void {
        const counts = new Float32Array(32);
        for (const e of this.eventHistory.slice(-1000)) {
            const idx = Math.max(0, Math.min(31, (e.eventType as number) - 1));
            counts[idx]++;
        }
        const total = counts.reduce((a, b) => a + b, 0) || 1;
        for (let i = 0; i < 32; i++) {
            this.rfVector[i] = counts[i] / total;
        }
    }
}
