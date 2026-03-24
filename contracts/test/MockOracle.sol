// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ITRIONOracle.sol";

/**
 * @title  MockOracle
 * @notice Local Hardhat test double for the TRION oracle.
 *         Owner toggles network stability to simulate anomaly detection.
 */
contract MockOracle is ITRIONOracle {
    bool public isNetworkStable;
    address public owner;

    event NetworkStateChanged(bool isStable, string reason);

    constructor() {
        owner = msg.sender;
        isNetworkStable = true;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function isSafe(bytes32) external view override returns (bool) {
        return isNetworkStable;
    }

    function setNetworkStable(bool stable, string calldata reason) external onlyOwner {
        isNetworkStable = stable;
        emit NetworkStateChanged(stable, reason);
    }
}
