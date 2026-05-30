/**
 * AXIOM SDK Client — main entry point for communicating with AXIOM nodes.
 *
 * Supports three transport modes:
 *   - gRPC: For server-to-server and high-throughput applications
 *   - REST: For web and mobile applications
 *   - WebSocket: For real-time streaming (coherence updates, BIS alerts)
 */

import {
    TruthState,
    UniversalBehavioralHash,
    UBEType,
    ResonanceVector,
    BISInterrupt,
    NodeHealth,
    CoherencePlanes,
    BEOResult,
} from './types';

import { masterEquation, computeBC, computePsi, computeResonance } from './index';

export interface AXIOMClientConfig {
    /** gRPC or REST endpoint for the AXIOM node. */
    endpoint: string;
    /** Authentication: validator BPI or API key. */
    authBpi?: string;
    apiKey?: string;
    /** Transport: 'grpc' | 'rest' | 'websocket'. Default: 'rest'. */
    transport?: 'grpc' | 'rest' | 'websocket';
    /** Timeout in milliseconds. Default: 10000. */
    timeoutMs?: number;
}

/**
 * AXIOM SDK Client.
 *
 * Implements the Cross-Domain Behavioral Interface (CDBI — Invention #17).
 * Every entity type (device, contract, AI model, human) uses this same interface.
 */
export class AXIOMClient {
    private config: Required<AXIOMClientConfig>;
    private wsConnection?: WebSocket;
    private coherenceCallbacks = new Map<string, (state: TruthState) => void>();
    private bisCallbacks = new Map<string, (interrupt: BISInterrupt) => void>();

    constructor(config: AXIOMClientConfig) {
        this.config = {
            transport: 'rest',
            timeoutMs: 10_000,
            authBpi: '',
            apiKey: '',
            ...config,
        };
    }

    // ── CDBI: Identity ──────────────────────────────────────────────────────

    /**
     * Get the current BPI for an entity.
     * CDBI: get_bpi(t: Timestamp) -> BPI
     */
    async getBPI(entityBpi: string): Promise<string> {
        const resp = await this.get<{ bpi: string }>(`/api/v1/entity/${entityBpi}/bpi`);
        return resp.bpi;
    }

    /**
     * Get Akashic Depth D(entity, t).
     * CDBI: get_depth(t: Timestamp) -> f64
     */
    async getDepth(entityBpi: string): Promise<number> {
        const resp = await this.get<{ depth: number }>(`/api/v1/entity/${entityBpi}/depth`);
        return resp.depth;
    }

    // ── CDBI: Coherence ─────────────────────────────────────────────────────

    /**
     * Get BC(entity, t) — behavioral coherence score.
     * CDBI: get_coherence(t: Timestamp) -> f32
     */
    async getCoherence(entityBpi: string): Promise<number> {
        const state = await this.getTruthState(entityBpi);
        return state.bc;
    }

    /**
     * Get Ψ(entity, t) — dynamic threshold.
     * CDBI: get_threshold(t: Timestamp) -> f32
     */
    async getThreshold(entityBpi: string): Promise<number> {
        const state = await this.getTruthState(entityBpi);
        return state.psi;
    }

    /**
     * Check if entity is SILENCED (BC < Ψ).
     * CDBI: is_silent(t: Timestamp) -> bool
     */
    async isSilenced(entityBpi: string): Promise<boolean> {
        const resp = await this.get<{ silenced: boolean }>(`/api/v1/entity/${entityBpi}/silence`);
        return resp.silenced;
    }

    // ── CDBI: Behavioral History ────────────────────────────────────────────

    /**
     * Get behavioral events in a time range.
     * CDBI: get_events(from: Timestamp, to: Timestamp) -> Vec<UBH>
     */
    async getEvents(
        entityBpi: string,
        fromNs: bigint,
        toNs: bigint,
    ): Promise<UniversalBehavioralHash[]> {
        return this.get<UniversalBehavioralHash[]>(
            `/api/v1/entity/${entityBpi}/events?from=${fromNs}&to=${toNs}`,
        );
    }

    // ── CDBI: Communication (RCP) ──────────────────────────────────────────

    /**
     * Get the 32-dim resonance frequency vector RF(entity, t).
     * CDBI: get_resonance_vector(t: Timestamp) -> [f32; 32]
     */
    async getResonanceVector(entityBpi: string): Promise<ResonanceVector> {
        const resp = await this.get<{ rf: number[] }>(`/api/v1/entity/${entityBpi}/resonance`);
        return new Float32Array(resp.rf);
    }

    /**
     * Compute RCP resonance between two entities.
     * CDBI: get_resonance_with(other: &BehavioralEntity) -> f32
     */
    async getResonanceWith(entityBpiA: string, entityBpiB: string): Promise<number> {
        const [rfA, rfB] = await Promise.all([
            this.getResonanceVector(entityBpiA),
            this.getResonanceVector(entityBpiB),
        ]);
        return computeResonance(rfA, rfB);
    }

    // ── CDBI: Truth State ──────────────────────────────────────────────────

    /**
     * Get full Ξ(entity, t) truth state.
     * CDBI: get_truth_state(t: Timestamp) -> f64
     */
    async getTruthState(entityBpi: string): Promise<TruthState> {
        return this.get<TruthState>(`/api/v1/entity/${entityBpi}/truth`);
    }

    // ── CDBI: Event Emission ───────────────────────────────────────────────

    /**
     * Emit a behavioral event.
     * CDBI: emit_event(event_type: UBEType, payload: Vec<u8>) -> UBH
     */
    async emitEvent(
        entityBpi: string,
        eventType: UBEType,
        payload: Uint8Array = new Uint8Array(0),
        bcAtEvent: number = 0.8,
        depthAtEvent: number = 0.0,
    ): Promise<UniversalBehavioralHash> {
        return this.post<UniversalBehavioralHash>('/api/v1/events', {
            entityBpi,
            eventType,
            payload: Array.from(payload),
            bcAtEvent,
            depthAtEvent,
        });
    }

    // ── BEO: Entity Resolution ─────────────────────────────────────────────

    /**
     * Resolve whether two BPIs belong to the same real-world entity.
     */
    async resolveEntities(bpiA: string, bpiB: string): Promise<BEOResult> {
        return this.post<BEOResult>('/api/v1/beo/resolve', { bpiA, bpiB });
    }

    // ── Real-time Streaming ────────────────────────────────────────────────

    /**
     * Subscribe to real-time coherence updates for an entity.
     *
     * @param entityBpi Entity to subscribe to
     * @param callback  Called whenever BC changes significantly
     * @returns Unsubscribe function
     */
    subscribeCoherence(
        entityBpi: string,
        callback: (state: TruthState) => void,
    ): () => void {
        this.ensureWebSocket();
        this.coherenceCallbacks.set(entityBpi, callback);

        if (this.wsConnection?.readyState === WebSocket.OPEN) {
            this.wsConnection.send(JSON.stringify({
                type: 'subscribe_coherence',
                entityBpi,
            }));
        }

        return () => {
            this.coherenceCallbacks.delete(entityBpi);
            if (this.wsConnection?.readyState === WebSocket.OPEN) {
                this.wsConnection.send(JSON.stringify({
                    type: 'unsubscribe_coherence',
                    entityBpi,
                }));
            }
        };
    }

    /**
     * Subscribe to BIS interrupts for an entity.
     *
     * @param entityBpi Entity to monitor
     * @param callback  Called when BIS interrupt is generated
     */
    subscribeBIS(
        entityBpi: string,
        callback: (interrupt: BISInterrupt) => void,
    ): () => void {
        this.ensureWebSocket();
        this.bisCallbacks.set(entityBpi, callback);
        return () => this.bisCallbacks.delete(entityBpi);
    }

    // ── Node Management ────────────────────────────────────────────────────

    /** Health check for the AXIOM node. */
    async health(): Promise<NodeHealth> {
        return this.get<NodeHealth>('/api/v1/health');
    }

    /** Disconnect WebSocket. */
    disconnect(): void {
        this.wsConnection?.close();
        this.wsConnection = undefined;
    }

    // ── Internal ───────────────────────────────────────────────────────────

    private async get<T>(path: string): Promise<T> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

        try {
            const response = await fetch(`${this.config.endpoint}${path}`, {
                headers: this.authHeaders(),
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`AXIOM API error ${response.status}: ${await response.text()}`);
            }
            return response.json() as Promise<T>;
        } finally {
            clearTimeout(timeout);
        }
    }

    private async post<T>(path: string, body: unknown): Promise<T> {
        const response = await fetch(`${this.config.endpoint}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`AXIOM API error ${response.status}: ${await response.text()}`);
        }
        return response.json() as Promise<T>;
    }

    private authHeaders(): Record<string, string> {
        const headers: Record<string, string> = {};
        if (this.config.apiKey) headers['X-AXIOM-API-Key'] = this.config.apiKey;
        if (this.config.authBpi) headers['X-AXIOM-BPI'] = this.config.authBpi;
        return headers;
    }

    private ensureWebSocket(): void {
        if (this.wsConnection) return;

        const wsUrl = this.config.endpoint.replace(/^http/, 'ws') + '/ws';
        this.wsConnection = new WebSocket(wsUrl);

        this.wsConnection.onmessage = (event: MessageEvent) => {
            try {
                const msg = JSON.parse(event.data as string) as Record<string, unknown>;
                if (msg.type === 'coherence_update') {
                    const state = msg.state as TruthState;
                    this.coherenceCallbacks.get(state.entityBpi)?.(state);
                } else if (msg.type === 'bis_interrupt') {
                    const interrupt = msg.interrupt as BISInterrupt;
                    this.bisCallbacks.get(interrupt.entityBpi)?.(interrupt);
                }
            } catch { /* ignore malformed messages */ }
        };
    }
}

/**
 * Create an AXIOM client with default configuration.
 */
export function createAXIOMClient(endpoint: string, apiKey?: string): AXIOMClient {
    return new AXIOMClient({ endpoint, apiKey });
}
