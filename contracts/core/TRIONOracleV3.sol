// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/ITRIONOracleV3.sol";

/**
 * @title  TRIONOracleV3
 * @notice On-chain store for 256-bit packed behavioral signals.
 *         Signals are published by a quorum of ECDSA-verified validators
 *         and are bound to a specific txId, chain, and contract address.
 *
 * Packed signal layout (uint256):
 *   Bits   0–7   : status     (1=SAFE, 2=WARN, 3=SILENCE)
 *   Bits   8–39  : coherence  C(t)   scaled ×1e6
 *   Bits  40–71  : threshold  Θ(t)   scaled ×1e6
 *   Bits  72–135 : blockNum
 *   Bits 136–199 : timestamp  (unix seconds)
 */
contract TRIONOracleV3 is ITRIONOracleV3, Ownable {
    using ECDSA for bytes32;

    struct Signal {
        uint256 packedData;
        bool initialized;
    }

    mapping(bytes32 => Signal) public signals;
    mapping(address => bool)   public isValidator;
    uint256 public quorumRequired = 2;

    constructor() Ownable(msg.sender) {
        isValidator[msg.sender] = true;
    }

    /**
     * @notice Publish a signed behavioral signal for a given transaction id.
     * @param txId        Deterministic identifier for the pending transaction.
     * @param packedData  256-bit packed signal from the L0 engine.
     * @param signatures  ECDSA signatures from quorum validators, sorted ascending by signer address.
     */
    function publishSignal(bytes32 txId, uint256 packedData, bytes[] calldata signatures) external {
        require(!signals[txId].initialized, "TRION: Signal already etched");
        require(signatures.length >= quorumRequired, "TRION: Insufficient quorum");

        bytes32 messageHash = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encodePacked(block.chainid, address(this), txId, packedData))
        );

        address lastSigner = address(0);
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = messageHash.recover(signatures[i]);
            require(isValidator[signer], "TRION: Invalid validator");
            require(signer > lastSigner, "TRION: Signer ordering required");
            lastSigner = signer;
        }

        signals[txId] = Signal(packedData, true);

        uint8  status    = uint8(packedData & 0xFF);
        uint32 coherence = uint32((packedData >> 8)  & 0xFFFFFFFF);
        uint32 threshold = uint32((packedData >> 40) & 0xFFFFFFFF);
        uint64 blockNum  = uint64((packedData >> 72) & 0xFFFFFFFFFFFFFFFF);

        emit ThermodynamicSignalEtched(txId, status, coherence, threshold);
        if (status == 1) emit EntropyNominal(txId, coherence, threshold, blockNum);
        if (status != 1) emit ThermodynamicCollapseIntercepted(txId, msg.sender, coherence, threshold, packedData);
    }

    /**
     * @notice Verify whether a stored signal authorises execution.
     *         Returns false if the signal is missing, stale (>300 s), or block-expired (>50 blocks).
     */
    function verifyExecution(bytes32 txId)
        external
        view
        returns (bool isSafe, uint32 coherence, uint32 threshold)
    {
        Signal memory s = signals[txId];
        require(s.initialized, "TRION: No signal found");

        uint8  status    = uint8(s.packedData & 0xFF);
        coherence        = uint32((s.packedData >> 8)   & 0xFFFFFFFF);
        threshold        = uint32((s.packedData >> 40)  & 0xFFFFFFFF);
        uint64 blockNum  = uint64((s.packedData >> 72)  & 0xFFFFFFFFFFFFFFFF);
        uint64 timestamp = uint64((s.packedData >> 136) & 0xFFFFFFFFFFFFFFFF);

        bool fresh    = (block.timestamp - timestamp < 300);
        bool onBound  = (block.number    - blockNum  < 50);

        return (status == 1 && fresh && onBound, coherence, threshold);
    }

    /**
     * @notice Return all decoded fields of a stored signal.
     */
    function getSignalInfo(bytes32 txId)
        external
        view
        returns (uint8 status, uint32 coherence, uint32 threshold, uint64 blockNum, uint64 timestamp)
    {
        uint256 p = signals[txId].packedData;
        return (
            uint8(p & 0xFF),
            uint32((p >> 8)   & 0xFFFFFFFF),
            uint32((p >> 40)  & 0xFFFFFFFF),
            uint64((p >> 72)  & 0xFFFFFFFFFFFFFFFF),
            uint64((p >> 136) & 0xFFFFFFFFFFFFFFFF)
        );
    }

    function addValidator(address validator) external onlyOwner {
        isValidator[validator] = true;
    }

    function setQuorum(uint256 quorum) external onlyOwner {
        quorumRequired = quorum;
    }
}
