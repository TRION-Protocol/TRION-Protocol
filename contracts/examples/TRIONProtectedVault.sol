// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../core/TRIONGuardV3.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title  TRIONProtectedVault
 * @notice Reference implementation showing how a DeFi protocol integrates TRIONGuardV3.
 *
 *         Each sensitive entry-point is decorated with `onlyWhenCoherent`.
 *         Before the transaction reaches the chain, the off-chain relayer must
 *         publish a SAFE signal for the deterministic txId derived from the call.
 *         If the oracle returns a non-SAFE status the call reverts with
 *         TRION_ExecutionBlocked or TRION_SignalStaleOrMissing.
 */
contract TRIONProtectedVault is TRIONGuardV3, Ownable {
    mapping(address => uint256) public balances;

    constructor(address oracle) TRIONGuardV3(oracle) Ownable(msg.sender) {}

    function flashLoanAttack(address targetToken, uint256 amount) external onlyWhenCoherent {
        balances[targetToken] += amount;
    }

    function sybilLiquidityDrain(uint256 poolId, address[] calldata sybilWallets) external onlyWhenCoherent {
        for (uint256 i = 0; i < sybilWallets.length; i++) {
            balances[sybilWallets[i]] += poolId;
        }
    }

    function governanceHostileTakeover(bytes32 proposalHash) external onlyWhenCoherent {
        balances[msg.sender] = uint256(proposalHash);
    }

    /// @notice Owner-only emergency bypass — use only during oracle maintenance.
    function toggleFirewall(bool enabled) external onlyOwner {
        _toggleTrionBypass(enabled);
    }
}
