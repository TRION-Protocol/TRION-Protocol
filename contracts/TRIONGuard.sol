// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ITRIONOracle
 * @dev Minimal interface to the TRION L0 Security Oracle.
 */
interface ITRIONOracle {
    function isNetworkStable() external view returns (bool);
}

/**
 * @title TRIONGuard
 * @dev Abstract base contract implementing the TRION execution firewall.
 *      Inheriting contracts gain the `trionProtected` modifier, which
 *      hard-blocks all guarded functions when the L0 engine signals
 *      a thermodynamic collapse (C(t) < mu(t)).
 */
abstract contract TRIONGuard {
    ITRIONOracle public immutable trionOracle;

    constructor(address _oracle) {
        require(_oracle != address(0), "TRION: zero oracle address");
        trionOracle = ITRIONOracle(_oracle);
    }

    /**
     * @dev Reverts with "TRION: SILENCE" if the network is in an anomalous
     *      state. Drop this on any function that should be frozen during
     *      a detected exploit or market collapse.
     */
    modifier trionProtected() {
        require(trionOracle.isNetworkStable(), "TRION: SILENCE");
        _;
    }
}
