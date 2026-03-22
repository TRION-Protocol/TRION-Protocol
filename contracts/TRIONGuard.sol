// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ITRIONOracle.sol";

abstract contract TRIONGuard {
    ITRIONOracle public trionOracle;

    constructor(address _oracle) {
        trionOracle = ITRIONOracle(_oracle);
    }

    modifier onlyWhenCoherent(bytes32 txId) {
        require(
            trionOracle.isSafe(txId),
            "TRION: Thermodynamic Collapse Detected"
        );
        _;
    }
}
