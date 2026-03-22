// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./TRIONGuard.sol";

contract MockLendingVault is TRIONGuard {
    mapping(address => uint256) public balances;

    constructor(address _oracle) TRIONGuard(_oracle) {}

    // Normal user behavior
    function deposit(bytes32 txId) external payable onlyWhenCoherent(txId) {
        balances[msg.sender] += msg.value;
    }

    // Simulated exploit (flash loan / unbacked mint)
    function flashLoanAttack(bytes32 txId, uint256 amount)
        external
        onlyWhenCoherent(txId)
    {
        // simulate exploit condition bypass
        require(amount < address(this).balance, "Fake check bypass");
        balances[msg.sender] += amount;
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
