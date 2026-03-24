// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ITRIONOracle.sol";

// Legacy v1 guard — used only by test contracts.
abstract contract TRIONGuard {
    ITRIONOracle public trionOracle;

    constructor(address oracle) {
        trionOracle = ITRIONOracle(oracle);
    }

    modifier onlyWhenCoherent(bytes32 txId) {
        require(trionOracle.isSafe(txId), "TRION: Thermodynamic Collapse Detected");
        _;
    }
}
