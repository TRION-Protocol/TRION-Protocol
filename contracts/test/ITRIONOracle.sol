// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Legacy v1 interface — used only by test contracts.
interface ITRIONOracle {
    function isSafe(bytes32 txId) external view returns (bool);
}
