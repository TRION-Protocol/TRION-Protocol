// AXIOM BIS Interrupt Handler — ARM64 (AArch64)
//
// Behavioral Interrupt System handler for ARM64 systems.
// Compatible with: Apple Silicon, AWS Graviton, Raspberry Pi 4 (64-bit),
//                  ARM Cortex-A53/A55/A57/A72/A76, Qualcomm Snapdragon.
//
// Like the x86-64 handler, this captures full behavioral context
// (entity BPI, BC score, trajectory anomaly) as the interrupt payload —
// not just "interrupt occurred" but "WHY it occurred" with full diagnosis.
//
// Author: Hudu Yusuf (Analys), @The_analys
// License: CC0 1.0 Universal
// Syntax: GNU as (AT&T with AArch64 mnemonics)

.arch armv8-a

// ============================================================================
// EXTERNAL SYMBOLS
// ============================================================================

.extern axiom_bis_handle_l1
.extern axiom_bis_handle_l2
.extern axiom_bis_handle_l3
.extern axiom_bis_handle_l4
.extern axiom_silence_entity

// ============================================================================
// CONSTANTS
// ============================================================================

.equ BIS_LEVEL_L1, 1
.equ BIS_LEVEL_L2, 2
.equ BIS_LEVEL_L3, 3
.equ BIS_LEVEL_L4, 4

// BISInterrupt offsets (same as x86-64)
.equ BIS_ENTITY_BPI,    0
.equ BIS_TRAJ_SCORE,    32
.equ BIS_LEVEL,         36
.equ BIS_BC,            40
.equ BIS_DEPTH,         44
.equ BIS_GPS_TIMESTAMP, 52
.equ BIS_CAUSAL_CTX,    60
.equ BIS_STRUCT_SIZE,   96   // 92 bytes + 4 padding for alignment

// ============================================================================
// TEXT SECTION
// ============================================================================

.section .text

// ============================================================================
// axiom_bis_entry — main BIS interrupt entry point for ARM64
//
// C signature (AAPCS64):
//   void axiom_bis_entry(
//       const uint8_t  *entity_bpi,      // x0
//       float           traj_score,       // s0
//       float           bc_at_interrupt,  // s1
//       double          depth,            // d2
//       uint64_t        gps_timestamp,    // x1
//       const uint8_t  *causal_context    // x2
//   );
// ============================================================================

.global axiom_bis_entry
.type   axiom_bis_entry, %function
axiom_bis_entry:
    // Save callee-saved registers (AAPCS64: x19-x28, d8-d15)
    stp     x19, x20, [sp, #-16]!
    stp     x21, x22, [sp, #-16]!
    stp     x23, x24, [sp, #-16]!
    stp     x29, x30, [sp, #-16]!

    // Allocate space for BISInterrupt on stack (96 bytes, 16-byte aligned)
    sub     sp, sp, #96

    // Save arguments in callee-saved registers
    mov     x19, x0          // entity_bpi
    fmov    s8,  s0          // traj_score
    fmov    s9,  s1          // bc_at_interrupt
    fmov    d10, d2          // depth
    mov     x20, x1          // gps_timestamp
    mov     x21, x2          // causal_context

    // Build BISInterrupt on stack
    // Copy entity_bpi (32 bytes = 4 × 8 bytes)
    ldp     x4, x5,  [x19]
    ldp     x6, x7,  [x19, #16]
    stp     x4, x5,  [sp, #BIS_ENTITY_BPI]
    stp     x6, x7,  [sp, #BIS_ENTITY_BPI+16]

    // Store traj_score
    str     s8,  [sp, #BIS_TRAJ_SCORE]

    // Store bc_at_interrupt
    str     s9,  [sp, #BIS_BC]

    // Store depth
    str     d10, [sp, #BIS_DEPTH]

    // Store GPS timestamp
    str     x20, [sp, #BIS_GPS_TIMESTAMP]

    // Copy causal_context (32 bytes)
    ldp     x4, x5,  [x21]
    ldp     x6, x7,  [x21, #16]
    stp     x4, x5,  [sp, #BIS_CAUSAL_CTX]
    stp     x6, x7,  [sp, #BIS_CAUSAL_CTX+16]

    // ── Classify BIS level from traj_score ──────────────────────────────────
    //
    // Load comparison constants using FMOV
    fmov    s5,  #5.0        // 5σ threshold (L4)
    fmov    s4,  #3.0        // 3σ threshold (L3)
    fmov    s3,  #2.0        // 2σ threshold (L2)

    // Compare traj_score (s8) against thresholds
    fcmp    s8, s5
    b.ge    .dispatch_l4

    fcmp    s8, s4
    b.ge    .dispatch_l3

    fcmp    s8, s3
    b.ge    .dispatch_l2

    b       .dispatch_l1

.dispatch_l4:
    mov     w0, #BIS_LEVEL_L4
    strb    w0, [sp, #BIS_LEVEL]

    // SILENCE entity immediately (time-critical, called first)
    mov     x0, sp
    bl      axiom_silence_entity

    // Then process full L4 handler
    mov     x0, sp
    bl      axiom_bis_handle_l4
    b       .done

.dispatch_l3:
    mov     w0, #BIS_LEVEL_L3
    strb    w0, [sp, #BIS_LEVEL]
    mov     x0, sp
    bl      axiom_bis_handle_l3
    b       .done

.dispatch_l2:
    mov     w0, #BIS_LEVEL_L2
    strb    w0, [sp, #BIS_LEVEL]
    mov     x0, sp
    bl      axiom_bis_handle_l2
    b       .done

.dispatch_l1:
    mov     w0, #BIS_LEVEL_L1
    strb    w0, [sp, #BIS_LEVEL]
    mov     x0, sp
    bl      axiom_bis_handle_l1

.done:
    // Restore stack
    add     sp, sp, #96
    ldp     x29, x30, [sp], #16
    ldp     x23, x24, [sp], #16
    ldp     x21, x22, [sp], #16
    ldp     x19, x20, [sp], #16
    ret

.size axiom_bis_entry, . - axiom_bis_entry

// ============================================================================
// axiom_read_hardware_entropy_arm — Read hardware entropy on ARM64.
//
// Uses ARMv8.5-A RNDR instruction if available.
// Falls back to CNTVCT_EL0 (virtual counter) timing jitter.
//
// C signature: uint64_t axiom_read_hardware_entropy_arm(void);
// Returns entropy in x0.
// ============================================================================

.global axiom_read_hardware_entropy_arm
.type   axiom_read_hardware_entropy_arm, %function
axiom_read_hardware_entropy_arm:
    // Try RNDR (ARMv8.5-A hardware random number)
    // mrs x0, rndr — encoded as: 0xD53B2400
    .inst 0xD53B2400     // mrs x0, rndr

    // NZCV C flag set = success, clear = failure
    b.cs    .entropy_ok

    // Fallback: read CNTVCT_EL0 (virtual counter, sub-nanosecond)
    mrs     x0, cntvct_el0

    // XOR with stack pointer for additional entropy
    mov     x1, sp
    eor     x0, x0, x1

.entropy_ok:
    ret

.size axiom_read_hardware_entropy_arm, . - axiom_read_hardware_entropy_arm

// ============================================================================
// axiom_bis_el1_handler — Exception Level 1 synchronous exception handler.
//
// Installed in the ARM64 vector table to capture behavioral anomalies
// that arrive via synchronous exceptions (e.g., illegal instruction,
// alignment fault triggered by anomalous process behavior).
// ============================================================================

.global axiom_bis_el1_handler
.type   axiom_bis_el1_handler, %function
axiom_bis_el1_handler:
    // Save all general purpose registers
    stp     x0,  x1,  [sp, #-16]!
    stp     x2,  x3,  [sp, #-16]!
    stp     x4,  x5,  [sp, #-16]!
    stp     x6,  x7,  [sp, #-16]!
    stp     x8,  x9,  [sp, #-16]!
    stp     x10, x11, [sp, #-16]!
    stp     x12, x13, [sp, #-16]!
    stp     x14, x15, [sp, #-16]!
    stp     x16, x17, [sp, #-16]!
    stp     x18, x19, [sp, #-16]!
    stp     x29, x30, [sp, #-16]!

    // Read exception syndrome register
    mrs     x0, esr_el1    // ESR_EL1: exception class + syndrome info
    mrs     x1, far_el1    // FAR_EL1: faulting address
    mrs     x2, elr_el1    // ELR_EL1: exception link register (PC at fault)

    // In production: translate exception to BIS L2 interrupt
    // and dispatch to axiom_bis_handle_l2()

    // Restore registers
    ldp     x29, x30, [sp], #16
    ldp     x18, x19, [sp], #16
    ldp     x16, x17, [sp], #16
    ldp     x14, x15, [sp], #16
    ldp     x12, x13, [sp], #16
    ldp     x10, x11, [sp], #16
    ldp     x8,  x9,  [sp], #16
    ldp     x6,  x7,  [sp], #16
    ldp     x4,  x5,  [sp], #16
    ldp     x2,  x3,  [sp], #16
    ldp     x0,  x1,  [sp], #16
    eret

.size axiom_bis_el1_handler, . - axiom_bis_el1_handler
