/**
 * @file axiom_minimal.c
 * @brief AXIOM Minimal Runtime — implementation.
 *
 * Fits in 4KB of flash. Uses inline Blake3 (no external dependency).
 * Tested on: ARM Cortex-M0+, RISC-V RV32I, ESP32-S3.
 *
 * Author: Hudu Yusuf (Analys), @The_analys
 * License: CC0 1.0 Universal
 */

#include "axiom_minimal.h"
#include "blake3_minimal.h"

#include <string.h>
#include <stddef.h>

/* ============================================================ */
/* INTERNAL HELPERS                                               */
/* ============================================================ */

static void compute_self_hash(const axiom_ubh_t *ubh, uint8_t hash_out[32]) {
    blake3_hasher_t hasher;
    blake3_init(&hasher);
    blake3_update(&hasher, ubh->entity_bpi, AXIOM_BPI_SIZE);
    blake3_update(&hasher, &ubh->event_type, 1);
    blake3_update(&hasher, &ubh->event_subtype, 1);
    blake3_update(&hasher, &ubh->gps_timestamp_ns, 8);
    blake3_update(&hasher, ubh->prior_hash, AXIOM_HASH_SIZE);
    if (ubh->payload_len > 0) {
        blake3_update(&hasher, ubh->payload, ubh->payload_len);
    }
    blake3_finalize(&hasher, hash_out);
}

static void compute_bpi_hash(
    const uint8_t history_hash[32],
    const uint8_t spawner_bpi[32],
    const uint8_t purpose_hash[32],
    uint16_t love_q16,
    uint8_t bpi_out[32]
) {
    blake3_hasher_t hasher;
    blake3_init(&hasher);
    blake3_update(&hasher, history_hash, 32);
    blake3_update(&hasher, spawner_bpi, 32);
    blake3_update(&hasher, purpose_hash, 32);
    blake3_update(&hasher, &love_q16, 2);
    blake3_finalize(&hasher, bpi_out);
}

/* ============================================================ */
/* PUBLIC API                                                     */
/* ============================================================ */

axiom_result_t axiom_init(
    axiom_state_t *state,
    const char    *purpose_str,
    const uint8_t  entropy[32],
    uint64_t       gps_ns
) {
    if (!state) return AXIOM_ERR_NULL_STATE;

    memset(state, 0, sizeof(axiom_state_t));

    /* Compute genesis BPI from entropy + purpose */
    uint8_t purpose_hash[32];
    {
        blake3_hasher_t h;
        blake3_init(&h);
        if (purpose_str && *purpose_str) {
            blake3_update(&h, purpose_str, strlen(purpose_str));
        }
        blake3_finalize(&h, purpose_hash);
    }

    {
        blake3_hasher_t h;
        blake3_init(&h);
        blake3_update(&h, entropy, 32);
        blake3_update(&h, purpose_hash, 32);
        blake3_update(&h, &gps_ns, 8);
        blake3_finalize(&h, state->bpi);
    }

    /* Initialize spawner_bpi to zero (genesis has no spawner) */
    memset(state->spawner_bpi, 0, AXIOM_BPI_SIZE);

    /* Initialize prior_hash to zero (genesis prior is all zeros) */
    memset(state->prior_hash, 0, AXIOM_HASH_SIZE);

    /* Initialize coherence scores */
    state->bc_q16  = (uint16_t)(AXIOM_SCALE_Q16);  /* Genesis BC = 1.0 */
    state->psi_q16 = (uint16_t)(AXIOM_PSI_BASE_Q16); /* Default Ψ = 0.55 */
    state->love_q16 = (uint16_t)(AXIOM_SCALE_Q16); /* Default Love = 1.0 */

    state->silence = 0;
    state->event_count = 0;
    state->last_gps_ns = gps_ns;

    /* Emit genesis SPAWN event */
    axiom_ubh_t genesis_ubh;
    return axiom_emit_event(state, AXIOM_UBE_SPAWN, entropy, 8, &genesis_ubh);
}

axiom_result_t axiom_emit_event(
    axiom_state_t   *state,
    axiom_ube_type_t event_type,
    const uint8_t   *payload,
    uint16_t         payload_len,
    axiom_ubh_t     *out_ubh
) {
    if (!state) return AXIOM_ERR_NULL_STATE;

    /* SILENCE check — no output when BC < Ψ */
    if (state->silence) {
        return AXIOM_ERR_SILENCED;
    }

    /* Validate UBE type */
    if (event_type < 1 || event_type > 32) {
        return AXIOM_ERR_INVALID_UBE;
    }

    /* Clamp payload */
    if (payload_len > AXIOM_UBH_PAYLOAD_MAX) {
        payload_len = AXIOM_UBH_PAYLOAD_MAX;
    }

    /* Build UBH record */
    axiom_ubh_t ubh;
    memset(&ubh, 0, sizeof(ubh));

    memcpy(ubh.entity_bpi, state->bpi, AXIOM_BPI_SIZE);
    ubh.event_type    = (uint8_t)event_type;
    ubh.event_subtype = 0;
    ubh.gps_timestamp_ns = axiom_platform_get_gps_ns();
    memcpy(ubh.prior_hash, state->prior_hash, AXIOM_HASH_SIZE);

    if (payload && payload_len > 0) {
        memcpy(ubh.payload, payload, payload_len);
        ubh.payload_len = payload_len;
    }

    /* Compute self_hash */
    compute_self_hash(&ubh, ubh.self_hash);

    /* Update chain */
    memcpy(state->prior_hash, ubh.self_hash, AXIOM_HASH_SIZE);
    state->event_count++;
    state->last_gps_ns = ubh.gps_timestamp_ns;

    /* Update UBE frequency vector */
    uint8_t ube_idx = (uint8_t)(event_type - 1);
    if (state->ube_freq[ube_idx] < 0xFF) {
        state->ube_freq[ube_idx]++;
    }

    /* Update BPI every BPI_UPDATE_CYCLE events */
    if (state->event_count % AXIOM_BPI_UPDATE_CYCLE == 0) {
        uint8_t history_hash[32];
        blake3_hasher_t h;
        blake3_init(&h);
        blake3_update(&h, state->prior_hash, 32);
        blake3_update(&h, &state->event_count, 4);
        blake3_finalize(&h, history_hash);

        uint8_t purpose_hash[32];
        memset(purpose_hash, 0, 32); /* Stored externally on IoT */

        compute_bpi_hash(
            history_hash, state->spawner_bpi, purpose_hash,
            state->love_q16, state->bpi
        );
    }

    /* Update local BC estimate every 100 events */
    if (state->event_count % 100 == 0) {
        uint16_t estimated_bc = axiom_estimate_bc_local(state);
        axiom_update_bc(state, estimated_bc);
    }

    /* Persist to non-volatile storage */
    axiom_platform_persist_ubh(&ubh);

    /* Copy to caller if requested */
    if (out_ubh) {
        memcpy(out_ubh, &ubh, sizeof(ubh));
    }

    return AXIOM_OK;
}

void axiom_update_bc(axiom_state_t *state, uint16_t bc_q16) {
    if (!state) return;

    state->bc_q16 = bc_q16;

    /* SILENCE check: BC < Ψ → SILENCE */
    if (bc_q16 < state->psi_q16) {
        state->silence = 1;
    } else {
        /* For SILENCE recovery: need 300 events above Ψ (tracked by caller) */
        state->silence = 0;
    }
}

bool axiom_is_silenced(const axiom_state_t *state) {
    if (!state) return true;
    return state->silence != 0;
}

void axiom_get_bpi(const axiom_state_t *state, uint8_t bpi_out[AXIOM_BPI_SIZE]) {
    if (!state || !bpi_out) return;
    memcpy(bpi_out, state->bpi, AXIOM_BPI_SIZE);
}

uint16_t axiom_estimate_bc_local(const axiom_state_t *state) {
    if (!state || state->event_count == 0) {
        return (uint16_t)(AXIOM_SCALE_Q16 * 80 / 100); /* Default 0.80 */
    }

    /* Φ: Causal continuity — estimate from hash chain (simplified: always 1.0 on IoT) */
    uint32_t phi_q16 = AXIOM_SCALE_Q16;

    /* A: Behavioral diversity — ratio of UBE types used / 32 */
    uint8_t types_used = 0;
    for (int i = 0; i < AXIOM_UBE_TYPE_COUNT; i++) {
        if (state->ube_freq[i] > 0) types_used++;
    }
    uint32_t alpha_q16 = (uint32_t)types_used * AXIOM_SCALE_Q16 / AXIOM_UBE_TYPE_COUNT;

    /* BC ≈ 0.55·Φ + 0.45·A (simplified 2-plane on IoT, no network/model) */
    uint32_t bc_q16 = (55 * phi_q16 + 45 * alpha_q16) / 100;
    if (bc_q16 > AXIOM_SCALE_Q16) bc_q16 = AXIOM_SCALE_Q16;

    return (uint16_t)bc_q16;
}

bool axiom_verify_ubh(const axiom_ubh_t *ubh) {
    if (!ubh) return false;

    uint8_t computed[32];
    compute_self_hash(ubh, computed);
    return memcmp(computed, ubh->self_hash, 32) == 0;
}

void axiom_compute_odi(
    const uint8_t genesis_hash[32],
    const uint8_t hw_fingerprint[32],
    uint32_t      event_count,
    const uint8_t entropy_seed[32],
    uint8_t       odi_out[32]
) {
    blake3_hasher_t h;
    blake3_init(&h);
    blake3_update(&h, genesis_hash, 32);
    blake3_update(&h, hw_fingerprint, 32);
    blake3_update(&h, &event_count, 4);
    blake3_update(&h, entropy_seed, 32);
    blake3_finalize(&h, odi_out);
}

/* ============================================================ */
/* DEFAULT PLATFORM STUBS (override in platform-specific port)   */
/* ============================================================ */

/* These are weak symbols — platform ports override them */
#if defined(__GNUC__) || defined(__clang__)
__attribute__((weak))
#endif
uint64_t axiom_platform_get_gps_ns(void) {
    /* Default: return 0 (platform must implement real GPS timestamp) */
    return 0;
}

#if defined(__GNUC__) || defined(__clang__)
__attribute__((weak))
#endif
void axiom_platform_get_entropy(uint8_t entropy_out[32]) {
    /* Default: zero entropy (INSECURE — platform must override) */
    memset(entropy_out, 0, 32);
}

#if defined(__GNUC__) || defined(__clang__)
__attribute__((weak))
#endif
void axiom_platform_persist_ubh(const axiom_ubh_t *ubh) {
    /* Default: no-op (platform must implement flash write or radio TX) */
    (void)ubh;
}
