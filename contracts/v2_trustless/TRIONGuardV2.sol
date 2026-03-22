// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./TRIONOracleV2.sol";

/**
 * @title TRIONGuardV2 — On-chain Behavioral Execution Firewall (V2)
 * @notice Modifier that decodes the 256-bit packed signal from the oracle and
 *         enforces whitepaper rules before any protected function may execute.
 *
 * Enforcement logic:
 *   • signalType == 2 (SILENCE) → unconditional revert  "TRION: SILENCE"
 *   • coherence < threshold     → revert                "TRION: COHERENCE_BELOW_THRESHOLD"
 *   • otherwise                 → execution proceeds
 *
 * Packed signal layout (mirrors TRIONOracleV2):
 *   Bits   0–1   : signalType  (0=SAFE, 1=WARN, 2=SILENCE)
 *   Bits   2–16  : reserved
 *   Bits  17–48  : coherence   (scaled ×1e6, uint32)
 *   Bits  49–80  : threshold   (scaled ×1e6, uint32)
 */
abstract contract TRIONGuardV2 {
    TRIONOracleV2 public immutable oracle;

    // Bit-field constants
    uint256 private constant MASK_SIGNAL_TYPE = 0x3;               // bits 0-1
    uint256 private constant SHIFT_COHERENCE  = 17;
    uint256 private constant MASK_COHERENCE   = 0xFFFFFFFF;        // 32 bits
    uint256 private constant SHIFT_THRESHOLD  = 49;
    uint256 private constant MASK_THRESHOLD   = 0xFFFFFFFF;        // 32 bits

    uint8 private constant SIGNAL_SILENCE = 2;

    event TRIONCheckPassed(bytes32 indexed txId, uint8 signalType, uint32 coherence, uint32 threshold);
    event TRIONCheckFailed(bytes32 indexed txId, uint8 signalType, uint32 coherence, uint32 threshold, string reason);

    constructor(address _oracle) {
        oracle = TRIONOracleV2(_oracle);
    }

    /**
     * @notice Modifier that enforces pre-execution behavioral coherence check.
     * @param txId The transaction identifier to look up in the oracle.
     */
    modifier trionProtected(bytes32 txId) {
        uint256 packed = oracle.getSignal(txId);

        // Decode packed signal via bitwise shifts
        uint8  signalType = uint8(packed & MASK_SIGNAL_TYPE);
        uint32 coherence  = uint32((packed >> SHIFT_COHERENCE) & MASK_COHERENCE);
        uint32 threshold  = uint32((packed >> SHIFT_THRESHOLD) & MASK_THRESHOLD);

        // Rule 1: SILENCE signal → hard block regardless of coherence
        if (signalType == SIGNAL_SILENCE) {
            emit TRIONCheckFailed(txId, signalType, coherence, threshold, "SILENCE");
            revert("TRION: SILENCE");
        }

        // Rule 2: coherence below dynamic threshold → block
        if (coherence < threshold) {
            emit TRIONCheckFailed(txId, signalType, coherence, threshold, "COHERENCE_BELOW_THRESHOLD");
            revert("TRION: COHERENCE_BELOW_THRESHOLD");
        }

        emit TRIONCheckPassed(txId, signalType, coherence, threshold);
        _;
    }
}
