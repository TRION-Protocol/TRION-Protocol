// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title TRION Protocol L0 Security Oracle
 * @dev Implements the C(T) Anomaly Hunter from the TRION Whitepaper
 */
contract TrionOracle is EIP712 {
    using ECDSA for bytes32;

    address public trionRelayer;

    // Whitepaper State Variables
    uint256 public latestBlockNumber;
    uint256 public currentCoherenceScore; // C(T) scaled by 1e6
    uint256 public dynamicBaseline;       // mu(T) scaled by 1e6
    bool public isNetworkStable;          // True if C(T) >= mu(T)

    // EIP-712 TypeHash for secure updates
    bytes32 private constant STATE_TYPEHASH = keccak256("NetworkState(uint256 blockNumber,uint256 cTScore,uint256 muTBaseline,bool isStable)");

    event NetworkStateUpdated(uint256 blockNumber, uint256 cTScore, bool isStable);
    error NetworkAnomalyDetected();
    error InvalidSignature();
    error OutdatedBlock();

    constructor(address _relayer) EIP712("TRION_Protocol", "1") {
        trionRelayer = _relayer;
        isNetworkStable = true;
    }

    function updateNetworkState(
        uint256 _blockNumber, uint256 _cTScore, uint256 _muTBaseline, bool _isStable, bytes calldata _signature
    ) external {
        if (_blockNumber <= latestBlockNumber) revert OutdatedBlock();
        bytes32 structHash = keccak256(abi.encode(STATE_TYPEHASH, _blockNumber, _cTScore, _muTBaseline, _isStable));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, _signature);
        if (signer != trionRelayer) revert InvalidSignature();

        latestBlockNumber = _blockNumber;
        currentCoherenceScore = _cTScore;
        dynamicBaseline = _muTBaseline;
        isNetworkStable = _isStable;
        emit NetworkStateUpdated(_blockNumber, _cTScore, _isStable);
    }

    modifier onlyStableNetwork() {
        if (!isNetworkStable) revert NetworkAnomalyDetected();
        _;
    }
}
