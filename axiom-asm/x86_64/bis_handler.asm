; AXIOM Behavioral Interrupt System (BIS) — x86-64 Assembly Handler
;
; This module implements the low-level BIS interrupt entry point for x86-64.
; Called by the Living Kernel when TRAJ(entity, t) exceeds a threshold.
;
; Unlike hardware IRQ handlers that save/restore only CPU state,
; the BIS handler captures full behavioral context including:
;   - Current process BPI (behavioral identity)
;   - BC score at interrupt time
;   - Trajectory anomaly score
;   - Causal context hash
;
; This is the meaning of "interrupts that carry diagnosis" (§7.9).
;
; Author: Hudu Yusuf (Analys), @The_analys
; License: CC0 1.0 Universal
; Syntax: NASM (Intel syntax)

BITS 64
DEFAULT REL

; ============================================================================
; EXTERNAL SYMBOLS (from Rust Living Kernel)
; ============================================================================

extern axiom_bis_handle_l1      ; BIS Level 1: log to Akashic Index
extern axiom_bis_handle_l2      ; BIS Level 2: alert coherence engine
extern axiom_bis_handle_l3      ; BIS Level 3: invoke IKP INNATE_LAYER
extern axiom_bis_handle_l4      ; BIS Level 4: SILENCE entity immediately
extern axiom_silence_entity     ; Immediate SILENCE — no grace period

; ============================================================================
; CONSTANTS
; ============================================================================

%define BIS_LEVEL_L1  1
%define BIS_LEVEL_L2  2
%define BIS_LEVEL_L3  3
%define BIS_LEVEL_L4  4

%define TRAJ_SIGMA_1  (1 * 0x3F800000)  ; 1.0 in IEEE 754 single
%define TRAJ_SIGMA_2  (2 * 0x3F800000)
%define TRAJ_SIGMA_3  (3 * 0x3F800000)
%define TRAJ_SIGMA_5  0x40A00000        ; 5.0 in IEEE 754

; BIS interrupt context structure offsets (matches BISInterrupt Rust struct)
; struct BISInterrupt {
;   entity_bpi:         [u8; 32],  +0
;   traj_score:         f32,       +32
;   level:              u8,        +36
;   _pad:               [u8;3],    +37
;   bc_at_interrupt:    f32,       +40
;   depth_at_interrupt: f64,       +44
;   gps_timestamp:      u64,       +52
;   causal_context:     [u8; 32],  +60
; }                                total: 92 bytes

BIS_ENTITY_BPI      equ 0
BIS_TRAJ_SCORE      equ 32
BIS_LEVEL           equ 36
BIS_BC              equ 40
BIS_DEPTH           equ 44
BIS_GPS_TIMESTAMP   equ 52
BIS_CAUSAL_CONTEXT  equ 60

; ============================================================================
; SECTION: .text
; ============================================================================

section .text

; ============================================================================
; axiom_bis_entry — main BIS interrupt entry point
;
; C signature:
;   void axiom_bis_entry(
;       const uint8_t  *entity_bpi,     // rdi
;       float           traj_score,     // xmm0
;       float           bc_at_interrupt, // xmm1
;       double          depth,          // xmm2
;       uint64_t        gps_timestamp,  // rsi
;       const uint8_t  *causal_context  // rdx
;   );
;
; Determines BIS level from traj_score and dispatches to handler.
; ============================================================================

global axiom_bis_entry
axiom_bis_entry:
    ; System V ABI: save callee-saved registers
    push    rbx
    push    rbp
    push    r12
    push    r13
    push    r14
    push    r15
    sub     rsp, 128        ; Align stack + local space for BISInterrupt

    ; Save arguments
    mov     r12, rdi        ; entity_bpi pointer
    movss   xmm8, xmm0     ; traj_score
    movss   xmm9, xmm1     ; bc_at_interrupt
    movsd   xmm10, xmm2    ; depth
    mov     r13, rsi        ; gps_timestamp
    mov     r14, rdx        ; causal_context

    ; Build BISInterrupt on stack
    lea     rbp, [rsp + 8]  ; BISInterrupt starts here (16-byte aligned)

    ; Copy entity_bpi (32 bytes)
    mov     rcx, 4
    mov     rsi, r12
    lea     rdi, [rbp + BIS_ENTITY_BPI]
    rep     movsq

    ; Store traj_score
    movss   [rbp + BIS_TRAJ_SCORE], xmm8

    ; Store bc_at_interrupt
    movss   [rbp + BIS_BC], xmm9

    ; Store depth
    movsd   [rbp + BIS_DEPTH], xmm10

    ; Store GPS timestamp
    mov     [rbp + BIS_GPS_TIMESTAMP], r13

    ; Copy causal_context (32 bytes)
    mov     rcx, 4
    mov     rsi, r14
    lea     rdi, [rbp + BIS_CAUSAL_CONTEXT]
    rep     movsq

    ; ── Classify BIS level from traj_score ──────────────────────────────────
    ;
    ; TRAJ < 1σ: Normal — no interrupt (should not reach here)
    ; TRAJ ≥ 1σ: L1 — log
    ; TRAJ ≥ 2σ: L2 — alert
    ; TRAJ ≥ 3σ: L3 — IKP
    ; TRAJ ≥ 5σ: L4 — SILENCE immediately

    movss   xmm0, xmm8      ; traj_score in xmm0

    ; Compare against 5.0 (L4 emergency)
    mov     eax, 0x40A00000  ; 5.0f
    movd    xmm7, eax
    ucomiss xmm0, xmm7
    jae     .dispatch_l4

    ; Compare against 3.0 (L3 critical)
    mov     eax, 0x40400000  ; 3.0f
    movd    xmm7, eax
    ucomiss xmm0, xmm7
    jae     .dispatch_l3

    ; Compare against 2.0 (L2 warning)
    mov     eax, 0x40000000  ; 2.0f
    movd    xmm7, eax
    ucomiss xmm0, xmm7
    jae     .dispatch_l2

    ; ≥ 1.0 → L1 informational
    jmp     .dispatch_l1

.dispatch_l4:
    ; L4: Emergency — SILENCE entity immediately (no logging delay)
    mov     byte [rbp + BIS_LEVEL], BIS_LEVEL_L4

    ; Call SILENCE directly before handler (time-critical)
    mov     rdi, rbp        ; BISInterrupt pointer
    call    axiom_silence_entity
    
    ; Then call L4 handler for full interrupt processing
    mov     rdi, rbp
    call    axiom_bis_handle_l4
    jmp     .done

.dispatch_l3:
    mov     byte [rbp + BIS_LEVEL], BIS_LEVEL_L3
    mov     rdi, rbp
    call    axiom_bis_handle_l3
    jmp     .done

.dispatch_l2:
    mov     byte [rbp + BIS_LEVEL], BIS_LEVEL_L2
    mov     rdi, rbp
    call    axiom_bis_handle_l2
    jmp     .done

.dispatch_l1:
    mov     byte [rbp + BIS_LEVEL], BIS_LEVEL_L1
    mov     rdi, rbp
    call    axiom_bis_handle_l1

.done:
    ; Restore stack and return
    add     rsp, 128
    pop     r15
    pop     r14
    pop     r13
    pop     r12
    pop     rbp
    pop     rbx
    ret

; ============================================================================
; axiom_bis_nmi_handler — Non-Maskable Interrupt handler for BIS Level 4.
;
; Installed in the IDT for NMI (vector 2) to handle L4 emergencies.
; BIS Level 4 (TRAJ ≥ 5σ) triggers an NMI to guarantee delivery
; even when interrupts are disabled.
;
; Note: This is the Living Kernel's equivalent of a hardware watchdog —
; but instead of detecting clock freeze, it detects behavioral emergency.
; ============================================================================

global axiom_bis_nmi_handler
axiom_bis_nmi_handler:
    ; NMI context: interrupts are already disabled
    push    rax
    push    rcx
    push    rdx
    push    rsi
    push    rdi
    push    r8
    push    r9
    push    r10
    push    r11

    ; Read BIS NMI context from NMI-dedicated memory page
    ; (populated by the BIS controller before raising NMI)
    mov     rdi, [rel axiom_bis_nmi_context_ptr]
    test    rdi, rdi
    jz      .nmi_done

    call    axiom_bis_handle_l4

.nmi_done:
    pop     r11
    pop     r10
    pop     r9
    pop     r8
    pop     rdi
    pop     rsi
    pop     rdx
    pop     rcx
    pop     rax
    iretq

; NMI context pointer (set by BIS controller before NMI trigger)
global axiom_bis_nmi_context_ptr
axiom_bis_nmi_context_ptr:
    dq 0

; ============================================================================
; axiom_read_hardware_entropy — Read hardware entropy for L0 substrate.
;
; Uses RDRAND instruction (Intel/AMD) for hardware random number generation.
; Falls back to RDTSC timing jitter if RDRAND not available.
;
; C signature: uint64_t axiom_read_hardware_entropy(void);
; ============================================================================

global axiom_read_hardware_entropy
axiom_read_hardware_entropy:
    ; Try RDRAND first
    rdrand  rax
    jc      .rdrand_ok

    ; Fallback: RDTSC timing jitter
    rdtsc
    shl     rdax, 32
    or      rax, rdx
    ; XOR with stack pointer for additional entropy
    xor     rax, rsp

.rdrand_ok:
    ret

; ============================================================================
; axiom_cpuid_fingerprint — Read CPU hardware fingerprint for ODI.
;
; C signature: void axiom_cpuid_fingerprint(uint32_t out[4]);
; rdi = output pointer
; ============================================================================

global axiom_cpuid_fingerprint
axiom_cpuid_fingerprint:
    push    rbx
    push    rcx
    push    rdx

    ; CPUID leaf 0: vendor string
    xor     eax, eax
    cpuid
    mov     [rdi],    eax
    mov     [rdi+4],  ebx
    mov     [rdi+8],  ecx
    mov     [rdi+12], edx

    pop     rdx
    pop     rcx
    pop     rbx
    ret

section .data
    bis_handler_version db "AXIOM BIS x86-64 handler D(AXIOM,t)", 0
