// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITRIONOracleV3 {
    event ThermodynamicSignalEtched(bytes32 indexed txId, uint8 status, uint32 coherence, uint32 threshold);
    event EntropyNominal(bytes32 indexed txId, uint32 currentCoherence, uint32 threshold, uint64 blockNum);
    event ThermodynamicCollapseIntercepted(bytes32 indexed txId, address indexed targetVault, uint32 fatalCoherence, uint32 threshold, uint256 rawSignalData);

    function verifyExecution(bytes32 txId) external view returns (bool isSafe, uint32 coherence, uint32 threshold);
    
    function getSignalInfo(bytes32 txId) external view returns (uint8 status, uint32 coherence, uint32 threshold, uint64 blockNum, uint64 timestamp);
}
