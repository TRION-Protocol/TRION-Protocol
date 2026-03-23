// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/ITRIONOracleV3.sol";

abstract contract TRIONGuardV3 {
    ITRIONOracleV3 public immutable trionOracle;
    bool public trionBypassEnabled; 

    error TRION_ExecutionBlocked(uint32 coherence, uint32 threshold);
    error TRION_SignalStaleOrMissing();

    constructor(address _oracle) {
        trionOracle = ITRIONOracleV3(_oracle);
    }

    modifier onlyWhenCoherent() {
        if (!trionBypassEnabled) {
            bytes32 txId = keccak256(abi.encode(address(this), msg.sender, msg.data, block.chainid));
            (bool isSafe, uint32 c, uint32 t) = trionOracle.verifyExecution(txId);
            
            if (!isSafe) {
                if (c == 0 && t == 0) revert TRION_SignalStaleOrMissing();
                revert TRION_ExecutionBlocked(c, t);
            }
        }
        _;
    }

    modifier onlyWhenCoherentCrossChain(uint256 originChainId) {
        if (!trionBypassEnabled) {
            bytes32 txId = keccak256(abi.encode(address(this), msg.sender, msg.data, block.chainid, originChainId));
            (bool isSafe, uint32 c, uint32 t) = trionOracle.verifyExecution(txId);
            if (!isSafe) revert TRION_ExecutionBlocked(c, t);
        }
        _;
    }

    function _toggleTrionBypass(bool _status) internal virtual {
        trionBypassEnabled = _status;
    }
}
