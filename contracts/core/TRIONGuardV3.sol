// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/ITRIONOracleV3.sol";

/**
 * @title  TRIONGuardV3
 * @notice Abstract base contract that DeFi protocols inherit to gate sensitive
 *         functions behind behavioral coherence verification.
 *
 * Usage:
 *   1. Inherit TRIONGuardV3 and pass the oracle address to the constructor.
 *   2. Add `onlyWhenCoherent` to any function that should be guarded.
 *   3. The off-chain relayer must publish a valid signal for the transaction's
 *      computed txId before the guarded call can succeed.
 */
abstract contract TRIONGuardV3 {
    ITRIONOracleV3 public immutable trionOracle;

    /// @notice When true, TRION verification is bypassed (emergency use only).
    bool public trionBypassEnabled;

    error TRION_ExecutionBlocked(uint32 coherence, uint32 threshold);
    error TRION_SignalStaleOrMissing();

    constructor(address oracle) {
        trionOracle = ITRIONOracleV3(oracle);
    }

    /**
     * @notice Guards a function against behaviorally incoherent execution.
     *         The txId is derived deterministically from the call context so that
     *         the off-chain engine can pre-compute and publish the correct signal.
     */
    modifier onlyWhenCoherent() {
        if (!trionBypassEnabled) {
            bytes32 txId = keccak256(abi.encode(address(this), msg.sender, msg.data, block.chainid));
            (bool safe, uint32 c, uint32 t) = trionOracle.verifyExecution(txId);
            if (!safe) {
                if (c == 0 && t == 0) revert TRION_SignalStaleOrMissing();
                revert TRION_ExecutionBlocked(c, t);
            }
        }
        _;
    }

    /**
     * @notice Variant for cross-chain calls where the origin chain id differs.
     */
    modifier onlyWhenCoherentCrossChain(uint256 originChainId) {
        if (!trionBypassEnabled) {
            bytes32 txId = keccak256(
                abi.encode(address(this), msg.sender, msg.data, block.chainid, originChainId)
            );
            (bool safe, uint32 c, uint32 t) = trionOracle.verifyExecution(txId);
            if (!safe) revert TRION_ExecutionBlocked(c, t);
        }
        _;
    }

    /// @dev Override in the inheriting contract to expose bypass toggle with appropriate access control.
    function _toggleTrionBypass(bool enabled) internal virtual {
        trionBypassEnabled = enabled;
    }
}
