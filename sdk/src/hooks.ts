/**
 * React hooks for AXIOM SDK integration.
 *
 * Drop-in hooks for React applications to subscribe to behavioral
 * coherence updates and truth state snapshots.
 */

// Note: These hooks require React as a peer dependency.
// Install: npm install react
// In Next.js / Vite: import these directly.

import { AXIOMClient } from './client';
import { TruthState, BISInterrupt, BISLevel } from './types';

let _client: AXIOMClient | null = null;

/**
 * Initialize the global AXIOM client.
 * Call once in your app root before using hooks.
 */
export function initAXIOM(endpoint: string, apiKey?: string): void {
    _client = new AXIOMClient({ endpoint, apiKey });
}

function getClient(): AXIOMClient {
    if (!_client) {
        throw new Error('AXIOM client not initialized. Call initAXIOM() first.');
    }
    return _client;
}

/**
 * useAXIOM — provides direct access to the AXIOM client.
 */
export function useAXIOM(): AXIOMClient {
    return getClient();
}

/**
 * useEntityTruthState — subscribes to real-time truth state for an entity.
 *
 * Returns Ξ(entity, t), BC, Ψ, D, SILENCE state, and love coefficient.
 *
 * @example
 * function WalletCard({ bpi }: { bpi: string }) {
 *   const state = useEntityTruthState(bpi);
 *   if (!state) return <Loading />;
 *   return (
 *     <div>
 *       <span>BC: {(state.bc * 100).toFixed(1)}%</span>
 *       {state.silence === 'silenced' && <SilenceAlert />}
 *     </div>
 *   );
 * }
 */
export function useEntityTruthState(
    entityBpi: string | null | undefined,
): TruthState | null {
    // Framework-agnostic implementation (no React import required at module level)
    // In React projects: wrap this in useState/useEffect
    // In Vue: wrap in ref/watchEffect
    // In Svelte: use as a store
    if (!entityBpi) return null;

    // Placeholder — actual implementation requires React/Vue/Svelte primitives
    // See docs/sdk_integration.md for framework-specific examples
    return null;
}

/**
 * useEntityCoherence — subscribes to BC score updates only.
 *
 * Lighter weight than useEntityTruthState when you only need BC.
 */
export function useEntityCoherence(entityBpi: string | null | undefined): number | null {
    if (!entityBpi) return null;
    return null; // Placeholder — see docs
}

/**
 * createCoherenceStore — creates a framework-agnostic coherence store.
 *
 * Works with any reactive framework (React, Vue, Svelte, Angular, Solid).
 *
 * @example
 * const store = createCoherenceStore('0xabcd...1234');
 * store.subscribe((state) => console.log('BC:', state.bc));
 * store.unsubscribe();
 */
export function createCoherenceStore(entityBpi: string): {
    subscribe: (cb: (state: TruthState) => void) => void;
    unsubscribe: () => void;
    getSnapshot: () => TruthState | null;
} {
    let subscriber: ((state: TruthState) => void) | null = null;
    let snapshot: TruthState | null = null;
    let unsubWs: (() => void) | null = null;

    return {
        subscribe(cb) {
            subscriber = cb;
            const client = getClient();

            // Initial fetch
            client.getTruthState(entityBpi).then((state) => {
                snapshot = state;
                subscriber?.(state);
            }).catch(() => {});

            // Real-time subscription
            unsubWs = client.subscribeCoherence(entityBpi, (state) => {
                snapshot = state;
                subscriber?.(state);
            });
        },
        unsubscribe() {
            subscriber = null;
            unsubWs?.();
        },
        getSnapshot() {
            return snapshot;
        },
    };
}

/**
 * createBISAlertStore — creates a BIS interrupt stream for an entity.
 *
 * Fires callback when behavioral anomaly is detected.
 */
export function createBISAlertStore(
    entityBpi: string,
    minLevel: BISLevel = BISLevel.L2,
): {
    subscribe: (cb: (interrupt: BISInterrupt) => void) => void;
    unsubscribe: () => void;
} {
    let subscriber: ((interrupt: BISInterrupt) => void) | null = null;
    let unsubWs: (() => void) | null = null;

    return {
        subscribe(cb) {
            subscriber = cb;
            const client = getClient();
            unsubWs = client.subscribeBIS(entityBpi, (interrupt) => {
                if (interrupt.level >= minLevel) {
                    subscriber?.(interrupt);
                }
            });
        },
        unsubscribe() {
            subscriber = null;
            unsubWs?.();
        },
    };
}
