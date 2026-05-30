/**
 * @file axiom_minimal.h
 * @brief AXIOM Minimal Runtime for bare-metal devices.
 *
 * Ultra-lightweight AXIOM implementation for microcontrollers:
 *   - ARM Cortex-M0+ (4KB flash)
 *   - RISC-V (RV32I)
 *   - ESP32 / ESP8266
 *
 * Implements:
 *   - UBH event generation (Blake3 minimal)
 *   - BPI computation (simplified for small flash)
 *   - BC score storage (4 planes, no Σ)
 *   - GPS timestamp integration
 *   - SILENCE enforcement
 *
 * Target flash budget: 4KB code, 512B RAM
 *
 * Author: Hudu Yusuf (Analys), @The_analys
 * License: CC0 1.0 Universal
 */

#pragma once

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ============================================================ */
/* VERSION                                                        */
/* ============================================================ */

#define AXIOM_VERSION_STRING "D(AXIOM,t)"  /* No discrete version */
#define AXIOM_GENESIS_EPOCH_NS 1735689600000000000ULL  /* 2026-01-01 UTC in GPS ns */

/* ============================================================ */
/* CONSTANTS                                                      */
/* ============================================================ */

#define AXIOM_BPI_SIZE       32U   /* Behavioral Process Identity: 32 bytes */
#define AXIOM_HASH_SIZE      32U   /* Blake3 hash output: 32 bytes */
#define AXIOM_UBH_PAYLOAD_MAX 64U  /* Max payload on IoT devices */

#define AXIOM_PSI_BASE_Q16   36045U  /* 0.55 × 2^16 = 36045 (Q16 fixed-point) */
#define AXIOM_SCALE_Q16      65535U  /* 1.0 × 2^16 (Q16 full scale) */

#define AXIOM_UBE_TYPE_COUNT 32U
#define AXIOM_BPI_UPDATE_CYCLE 1000U  /* Update BPI every 1000 events */
#define AXIOM_SILENCE_RECOVERY 300U   /* 300 events above Ψ to lift SILENCE */

/* ============================================================ */
/* UBE TYPE ENUM (C99)                                           */
/* ============================================================ */

typedef enum {
    AXIOM_UBE_TRANSFER    = 1,
    AXIOM_UBE_SWAP        = 2,
    AXIOM_UBE_LIQUIDITY   = 3,
    AXIOM_UBE_STAKE       = 4,
    AXIOM_UBE_UNSTAKE     = 5,
    AXIOM_UBE_GOVERNANCE  = 6,
    AXIOM_UBE_PROPOSAL    = 7,
    AXIOM_UBE_BORROW      = 8,
    AXIOM_UBE_REPAY       = 9,
    AXIOM_UBE_LIQUIDATE   = 10,
    AXIOM_UBE_BRIDGE      = 11,
    AXIOM_UBE_DEPLOY      = 12,
    AXIOM_UBE_UPGRADE     = 13,
    AXIOM_UBE_MINT        = 14,
    AXIOM_UBE_BURN        = 15,
    AXIOM_UBE_ORACLE_UPDATE = 16,
    AXIOM_UBE_MEV_CAPTURE = 17,
    AXIOM_UBE_FLASH_LOAN  = 18,
    AXIOM_UBE_AIRDROP     = 19,
    AXIOM_UBE_CLAIM       = 20,
    AXIOM_UBE_EXECUTE     = 21,
    AXIOM_UBE_READ        = 22,
    AXIOM_UBE_WRITE       = 23,
    AXIOM_UBE_SPAWN       = 24,
    AXIOM_UBE_TERMINATE   = 25,
    AXIOM_UBE_COMMUNICATE = 26,
    AXIOM_UBE_SENSE       = 27,
    AXIOM_UBE_ACTUATE     = 28,
    AXIOM_UBE_LEARN       = 29,
    AXIOM_UBE_DECIDE      = 30,
    AXIOM_UBE_AUTHENTICATE = 31,
    AXIOM_UBE_TRANSFORM   = 32,
} axiom_ube_type_t;

/* ============================================================ */
/* CORE DATA STRUCTURES                                           */
/* ============================================================ */

/**
 * @brief Minimal Universal Behavioral Hash for IoT devices.
 *
 * Reduced from full UBH for flash budget:
 * - entity_bpi:    32 bytes
 * - event_type:     1 byte
 * - gps_timestamp:  8 bytes
 * - prior_hash:    32 bytes
 * - self_hash:     32 bytes
 * - payload:       up to 64 bytes
 * Total: ~169 bytes per event
 */
typedef struct {
    uint8_t  entity_bpi[AXIOM_BPI_SIZE];    /**< 32-byte BPI */
    uint8_t  event_type;                     /**< UBE type (1-32) */
    uint8_t  event_subtype;                  /**< Subtype (0 = standard) */
    uint64_t gps_timestamp_ns;              /**< GPS nanoseconds */
    uint8_t  prior_hash[AXIOM_HASH_SIZE];   /**< Hash of previous event */
    uint8_t  self_hash[AXIOM_HASH_SIZE];    /**< Blake3 of this event */
    uint16_t payload_len;                   /**< Length of payload data */
    uint8_t  payload[AXIOM_UBH_PAYLOAD_MAX]; /**< Event payload */
} axiom_ubh_t;

/**
 * @brief AXIOM state for one entity on a bare-metal device.
 *
 * Fits in 512 bytes of RAM. All state for one IoT entity.
 */
typedef struct {
    /* Identity */
    uint8_t  bpi[AXIOM_BPI_SIZE];           /**< Current BPI */
    uint8_t  spawner_bpi[AXIOM_BPI_SIZE];   /**< Spawner entity BPI */
    uint8_t  prior_hash[AXIOM_HASH_SIZE];   /**< Last event self_hash */

    /* Behavioral coherence (Q16 fixed-point, ∈ [0, 65535]) */
    uint16_t bc_q16;       /**< BC(entity,t) × 2^16 */
    uint16_t psi_q16;      /**< Ψ(entity,t) × 2^16 */

    /* Akashic depth (event count as proxy for IoT) */
    uint32_t event_count;  /**< Total events emitted since genesis */

    /* Status flags */
    uint8_t  silence;      /**< 1 = SILENCED (BC < Ψ) */
    uint8_t  pad[3];       /**< Alignment padding */

    /* UBE type frequency vector (32 bytes — one per UBE type) */
    uint8_t  ube_freq[AXIOM_UBE_TYPE_COUNT];  /**< Event frequency counts (saturating) */

    /* GPS state */
    uint64_t last_gps_ns;  /**< Last GPS timestamp received */

    /* Love coefficient (Q16) */
    uint16_t love_q16;     /**< Love × 2^16, default = 65535 (1.0) */

    uint16_t _pad2;        /**< Alignment */
} axiom_state_t;

/* ============================================================ */
/* RESULT CODES                                                   */
/* ============================================================ */

typedef enum {
    AXIOM_OK              = 0,
    AXIOM_ERR_SILENCED    = 1,   /**< Entity is SILENCED — event rejected */
    AXIOM_ERR_INVALID_UBE = 2,   /**< Invalid UBE type */
    AXIOM_ERR_PAYLOAD_TOO_LARGE = 3,
    AXIOM_ERR_NULL_STATE  = 4,
    AXIOM_ERR_HASH_FAIL   = 5,
} axiom_result_t;

/* ============================================================ */
/* API FUNCTIONS                                                  */
/* ============================================================ */

/**
 * @brief Initialize an AXIOM entity state.
 *
 * Must be called before any other axiom_* function.
 * Generates genesis BPI from device entropy.
 *
 * @param state        Pre-allocated state structure
 * @param purpose_str  Null-terminated purpose declaration
 * @param entropy      32 bytes of hardware entropy (from /dev/hwrng or TPM)
 * @param gps_ns       Current GPS timestamp in nanoseconds
 * @return AXIOM_OK on success
 */
axiom_result_t axiom_init(
    axiom_state_t *state,
    const char    *purpose_str,
    const uint8_t  entropy[32],
    uint64_t       gps_ns
);

/**
 * @brief Emit a behavioral event.
 *
 * Core L1 operation. Generates UBH hash, updates chain, checks SILENCE.
 *
 * @param state      Entity state
 * @param event_type UBE type (1-32)
 * @param payload    Event payload (NULL if none)
 * @param payload_len Payload length (0 if none, max AXIOM_UBH_PAYLOAD_MAX)
 * @param out_ubh    Output UBH record (may be NULL if caller doesn't need it)
 * @return AXIOM_OK, AXIOM_ERR_SILENCED, or error code
 */
axiom_result_t axiom_emit_event(
    axiom_state_t *state,
    axiom_ube_type_t event_type,
    const uint8_t   *payload,
    uint16_t         payload_len,
    axiom_ubh_t     *out_ubh
);

/**
 * @brief Update behavioral coherence score (called by L4 or locally estimated).
 *
 * On IoT devices without connectivity to L4 Coherence Engine,
 * BC is estimated locally from event frequency patterns.
 *
 * @param state   Entity state
 * @param bc_q16  New BC value in Q16 fixed-point (0=0.0, 65535=1.0)
 */
void axiom_update_bc(axiom_state_t *state, uint16_t bc_q16);

/**
 * @brief Check if entity is currently SILENCED.
 *
 * @param state Entity state
 * @return true if BC < Ψ (entity must not emit output)
 */
bool axiom_is_silenced(const axiom_state_t *state);

/**
 * @brief Get the current Behavioral Process Identity.
 *
 * @param state   Entity state
 * @param bpi_out 32-byte buffer to receive BPI
 */
void axiom_get_bpi(const axiom_state_t *state, uint8_t bpi_out[AXIOM_BPI_SIZE]);

/**
 * @brief Compute local BC estimate from UBE frequency distribution.
 *
 * For IoT devices without L4 connectivity, BC is estimated locally
 * based on Φ (causal continuity) and A (behavioral diversity).
 *
 * @param state Entity state
 * @return Estimated BC in Q16
 */
uint16_t axiom_estimate_bc_local(const axiom_state_t *state);

/**
 * @brief Verify a UBH self_hash.
 *
 * @param ubh UBH record to verify
 * @return true if self_hash is valid
 */
bool axiom_verify_ubh(const axiom_ubh_t *ubh);

/**
 * @brief Compute Ontological Device Identity (ODI).
 *
 * ODI = Blake3(genesis_event_hash || hardware_fingerprint || depth || entropy)
 *
 * @param genesis_hash     Hash of first boot UBH event
 * @param hw_fingerprint   32 bytes of hardware fingerprint
 * @param event_count      Total events since genesis (proxy for depth on IoT)
 * @param entropy_seed     Original boot entropy (32 bytes)
 * @param odi_out          32-byte output buffer
 */
void axiom_compute_odi(
    const uint8_t genesis_hash[32],
    const uint8_t hw_fingerprint[32],
    uint32_t      event_count,
    const uint8_t entropy_seed[32],
    uint8_t       odi_out[32]
);

/**
 * @brief Platform hook: get GPS timestamp in nanoseconds.
 *
 * Must be implemented by the platform port (not provided by axiom_minimal.c).
 * On devices without GPS: return NTP timestamp + GPS epoch offset.
 * On devices without NTP: return RTC timestamp + estimate.
 */
uint64_t axiom_platform_get_gps_ns(void);

/**
 * @brief Platform hook: get hardware entropy (32 bytes).
 *
 * Must be implemented by the platform port.
 * Sources: /dev/hwrng, TPM, ADC noise, SRAM startup pattern, etc.
 */
void axiom_platform_get_entropy(uint8_t entropy_out[32]);

/**
 * @brief Platform hook: persist UBH to non-volatile memory.
 *
 * Called after every axiom_emit_event(). Platform stores to flash/EEPROM.
 * On devices with radio: transmit to Akashic Index gateway.
 */
void axiom_platform_persist_ubh(const axiom_ubh_t *ubh);

#ifdef __cplusplus
}
#endif
