/**
 * @file blake3_minimal.h
 * @brief Minimal Blake3 for bare-metal (no_std) devices.
 */

#pragma once

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    uint32_t chaining_value[8];
    uint8_t  buf[64];
    uint8_t  buf_len;
    uint8_t  blocks_compressed;
    uint8_t  flags;
    uint8_t  _pad;
} blake3_hasher_t;

void blake3_init(blake3_hasher_t *h);
void blake3_update(blake3_hasher_t *h, const void *input, size_t len);
void blake3_finalize(blake3_hasher_t *h, uint8_t out[32]);
void blake3_hash(const void *input, size_t len, uint8_t out[32]);

#ifdef __cplusplus
}
#endif
