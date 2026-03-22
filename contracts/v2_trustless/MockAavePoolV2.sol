// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./TRIONGuardV2.sol";

/**
 * @title MockAavePoolV2 — Flash-loan target protected by TRION V2 Firewall
 * @notice Simulates an Aave-style flash-loan pool. Every call to flashLoan()
 *         is gated by the trionProtected modifier; the txId is deterministically
 *         derived from the caller and amount so the off-chain engine can
 *         pre-publish the appropriate signal before the tx lands on-chain.
 */
contract MockAavePoolV2 is TRIONGuardV2 {
    event FlashLoanExecuted(address indexed borrower, uint256 amount, bytes32 txId);

    constructor(address _oracle) TRIONGuardV2(_oracle) {}

    /**
     * @notice Attempt a flash loan.
     * @param amount Loan amount in wei.
     *
     * The txId is computed identically by the Rust L0 engine off-chain so that
     * it can sign and publish the correct signal before this call is made.
     */
    function flashLoan(uint256 amount)
        external
        trionProtected(_txId(msg.sender, amount))
    {
        bytes32 id = _txId(msg.sender, amount);
        emit FlashLoanExecuted(msg.sender, amount, id);
        // In a real pool: transfer tokens, call receiver, verify repayment.
        // Omitted here — TRION blocked this before we got here in the attack scenario.
    }

    function _txId(address sender, uint256 amount) internal pure returns (bytes32) {
        return keccak256(abi.encode(sender, amount));
    }
}
