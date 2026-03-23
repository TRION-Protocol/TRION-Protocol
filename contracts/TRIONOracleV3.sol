// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/ITRIONOracleV3.sol";

contract TRIONOracleV3 is ITRIONOracleV3, Ownable {
    using ECDSA for bytes32;

    struct Signal {
        uint256 packedData; // [0-7: Status] [8-39: C(t)] [40-71: Threshold] [72-135: BlockNum] [136-199: Timestamp]
        bool initialized;
    }

    mapping(bytes32 => Signal) public signals;
    mapping(address => bool) public isValidator;
    uint256 public quorumRequired = 2; 

    constructor() Ownable(msg.sender) {
        isValidator[msg.sender] = true;
    }

    function publishSignal(bytes32 txId, uint256 packedData, bytes[] calldata signatures) external {
        require(!signals[txId].initialized, "TRION: Signal already etched");
        require(signatures.length >= quorumRequired, "TRION: Insufficient quorum");

        bytes32 messageHash = MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encodePacked(block.chainid, address(this), txId, packedData)));
        
        address lastSigner = address(0);
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = messageHash.recover(signatures[i]);
            require(isValidator[signer], "TRION: Invalid validator");
            require(signer > lastSigner, "TRION: Signer ordering required");
            lastSigner = signer;
        }

        signals[txId] = Signal(packedData, true);
        
        uint8 status = uint8(packedData & 0xFF);
        uint32 coherence = uint32((packedData >> 8) & 0xFFFFFFFF);
        uint32 threshold = uint32((packedData >> 40) & 0xFFFFFFFF);
        uint64 blockNum = uint64((packedData >> 72) & 0xFFFFFFFFFFFFFFFF);

        emit ThermodynamicSignalEtched(txId, status, coherence, threshold);
        if (status == 1) emit EntropyNominal(txId, coherence, threshold, blockNum);
        if (status != 1) emit ThermodynamicCollapseIntercepted(txId, msg.sender, coherence, threshold, packedData);
    }

    function verifyExecution(bytes32 txId) external view returns (bool status, uint32 coherence, uint32 threshold) {
        Signal memory s = signals[txId];
        require(s.initialized, "TRION: No signal found");

        uint8 sigStatus = uint8(s.packedData & 0xFF);
        coherence = uint32((s.packedData >> 8) & 0xFFFFFFFF);
        threshold = uint32((s.packedData >> 40) & 0xFFFFFFFF);
        uint64 blockNum = uint64((s.packedData >> 72) & 0xFFFFFFFFFFFFFFFF);
        uint64 timestamp = uint64((s.packedData >> 136) & 0xFFFFFFFFFFFFFFFF);

        bool isSafe = (sigStatus == 1);
        bool isRecent = (block.timestamp - timestamp < 300);
        bool blockBound = (block.number - blockNum < 50);

        return (isSafe && isRecent && blockBound, coherence, threshold);
    }

    function getSignalInfo(bytes32 txId) external view returns (uint8, uint32, uint32, uint64, uint64) {
        uint256 p = signals[txId].packedData;
        return (uint8(p & 0xFF), uint32((p >> 8) & 0xFFFFFFFF), uint32((p >> 40) & 0xFFFFFFFF), uint64((p >> 72) & 0xFFFFFFFFFFFFFFFF), uint64((p >> 136) & 0xFFFFFFFFFFFFFFFF));
    }

    function addValidator(address _v) external onlyOwner { isValidator[_v] = true; }
    function setQuorum(uint256 _q) external onlyOwner { quorumRequired = _q; }
}
