/**
 * @file blake3_minimal.c
 * @brief Minimal Blake3 implementation for bare-metal devices.
 *
 * Stripped-down Blake3 for microcontrollers.
 * Supports only the hash function (no keyed mode, no XOF).
 * Code size: ~1.5KB on ARM Cortex-M0+ with -Os.
 *
 * Based on the public domain Blake3 reference implementation.
 * Adapted for no_std bare-metal environments.
 *
 * Author: Hudu Yusuf (Analys), @The_analys
 * License: CC0 1.0 Universal
 */

#include "blake3_minimal.h"
#include <string.h>

/* Blake3 constants */
#define BLAKE3_IV_0 0x6A09E667UL
#define BLAKE3_IV_1 0xBB67AE85UL
#define BLAKE3_IV_2 0x3C6EF372UL
#define BLAKE3_IV_3 0xA54FF53AUL
#define BLAKE3_IV_4 0x510E527FUL
#define BLAKE3_IV_5 0x9B05688CUL
#define BLAKE3_IV_6 0x1F83D9ABUL
#define BLAKE3_IV_7 0x5BE0CD19UL

/* Domain flags */
#define CHUNK_START  0x01
#define CHUNK_END    0x02
#define PARENT       0x04
#define ROOT         0x08

static const uint32_t IV[8] = {
    BLAKE3_IV_0, BLAKE3_IV_1, BLAKE3_IV_2, BLAKE3_IV_3,
    BLAKE3_IV_4, BLAKE3_IV_5, BLAKE3_IV_6, BLAKE3_IV_7
};

static const uint8_t MSG_SCHEDULE[7][16] = {
    {0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15},
    {2,6,3,10,7,0,4,13,1,11,12,5,9,14,15,8},
    {3,4,10,12,13,2,7,14,6,5,9,0,11,15,8,1},
    {10,7,12,9,14,3,13,15,4,0,11,2,5,8,1,6},
    {12,13,9,11,15,10,14,8,7,2,5,3,0,1,6,4},
    {9,14,11,5,8,12,15,1,13,3,0,10,2,6,4,7},
    {11,15,5,0,1,9,8,6,14,10,2,12,3,4,7,13},
};

#define ROTR32(x,n) (((x) >> (n)) | ((x) << (32-(n))))

static void g(uint32_t *state, int a, int b, int c, int d, uint32_t mx, uint32_t my) {
    state[a] = state[a] + state[b] + mx;
    state[d] = ROTR32(state[d] ^ state[a], 16);
    state[c] = state[c] + state[d];
    state[b] = ROTR32(state[b] ^ state[c], 12);
    state[a] = state[a] + state[b] + my;
    state[d] = ROTR32(state[d] ^ state[a], 8);
    state[c] = state[c] + state[d];
    state[b] = ROTR32(state[b] ^ state[c], 7);
}

static void round_fn(uint32_t *state, const uint32_t *msg, int r) {
    const uint8_t *s = MSG_SCHEDULE[r % 7];
    g(state,0,4,8,12,msg[s[0]],msg[s[1]]);
    g(state,1,5,9,13,msg[s[2]],msg[s[3]]);
    g(state,2,6,10,14,msg[s[4]],msg[s[5]]);
    g(state,3,7,11,15,msg[s[6]],msg[s[7]]);
    g(state,0,5,10,15,msg[s[8]],msg[s[9]]);
    g(state,1,6,11,12,msg[s[10]],msg[s[11]]);
    g(state,2,7,8,13,msg[s[12]],msg[s[13]]);
    g(state,3,4,9,14,msg[s[14]],msg[s[15]]);
}

static void compress(
    const uint32_t *chaining_value,
    const uint32_t *block_words,
    uint64_t counter,
    uint32_t block_len,
    uint32_t flags,
    uint32_t out[16]
) {
    uint32_t state[16];
    memcpy(&state[0], chaining_value, 8 * sizeof(uint32_t));
    memcpy(&state[8], IV, 4 * sizeof(uint32_t));
    state[12] = (uint32_t)(counter & 0xFFFFFFFF);
    state[13] = (uint32_t)(counter >> 32);
    state[14] = block_len;
    state[15] = flags;

    for (int r = 0; r < 7; r++) {
        round_fn(state, block_words, r);
    }

    for (int i = 0; i < 8; i++) {
        out[i]   = state[i] ^ state[i+8];
        out[i+8] = state[i+8] ^ chaining_value[i];
    }
}

static uint32_t load32_le(const uint8_t *b) {
    return ((uint32_t)b[0]) | ((uint32_t)b[1]<<8) | ((uint32_t)b[2]<<16) | ((uint32_t)b[3]<<24);
}

static void store32_le(uint8_t *b, uint32_t v) {
    b[0]=(uint8_t)v; b[1]=(uint8_t)(v>>8); b[2]=(uint8_t)(v>>16); b[3]=(uint8_t)(v>>24);
}

/* ============================================================ */
/* PUBLIC API                                                     */
/* ============================================================ */

void blake3_init(blake3_hasher_t *h) {
    memset(h, 0, sizeof(*h));
    memcpy(h->chaining_value, IV, 8*4);
    h->flags = CHUNK_START;
}

void blake3_update(blake3_hasher_t *h, const void *input, size_t len) {
    const uint8_t *in = (const uint8_t *)input;

    while (len > 0) {
        if (h->buf_len == 64) {
            /* Process buffered block */
            uint32_t block_words[16];
            for (int i = 0; i < 16; i++) {
                block_words[i] = load32_le(&h->buf[i*4]);
            }
            uint32_t out[16];
            compress(h->chaining_value, block_words, 0, 64, h->flags & ~CHUNK_END, out);
            memcpy(h->chaining_value, out, 8*4);
            h->flags &= ~CHUNK_START;
            h->buf_len = 0;
            h->blocks_compressed++;
        }

        size_t take = len < (size_t)(64 - h->buf_len) ? len : (size_t)(64 - h->buf_len);
        memcpy(h->buf + h->buf_len, in, take);
        h->buf_len += (uint8_t)take;
        in += take;
        len -= take;
    }
}

void blake3_finalize(blake3_hasher_t *h, uint8_t out[32]) {
    /* Pad the last block */
    memset(h->buf + h->buf_len, 0, 64 - h->buf_len);

    uint32_t block_words[16];
    for (int i = 0; i < 16; i++) {
        block_words[i] = load32_le(&h->buf[i*4]);
    }

    uint32_t flags = h->flags | CHUNK_END | ROOT;
    uint32_t result[16];
    compress(h->chaining_value, block_words, 0, h->buf_len, flags, result);

    /* Output first 256 bits (32 bytes) */
    for (int i = 0; i < 8; i++) {
        store32_le(out + i*4, result[i]);
    }
}

void blake3_hash(const void *input, size_t len, uint8_t out[32]) {
    blake3_hasher_t h;
    blake3_init(&h);
    blake3_update(&h, input, len);
    blake3_finalize(&h, out);
}
