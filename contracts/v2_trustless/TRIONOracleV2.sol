// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title TRIONOracleV2 — Trustless Signal Oracle
 * @notice Stores 256-bit packed behavioral signals published by
 *         cryptographically-verified off-chain validators (the Rust L0 engine).
 *
 * Packed signal layout (uint256):
 *   Bits   0–1   : signalType  (0=SAFE, 1=WARN, 2=SILENCE)
 *   Bits   2–16  : reserved
 *   Bits  17–48  : coherence   (scaled ×1e6, uint32)
 *   Bits  49–80  : threshold   (scaled ×1e6, uint32)
 *   Bits  81–255 : reserved / future use
 */
contract TRIONOracleV2 {
    // ─── State ────────────────────────────────────────────────────────────────

    address public owner;

    /// @notice Authorised off-chain validator set (Rust L0 engine wallets)
    mapping(address => bool) public validators;

    /// @notice Latest packed signal per transaction id
    mapping(bytes32 => uint256) public signals;

    /// @notice Block number when the signal was last updated
    mapping(bytes32 => uint256) public signalBlock;

    // ─── Events ───────────────────────────────────────────────────────────────

    event ValidatorAdded(address indexed validator);
    event ValidatorRemoved(address indexed validator);
    event SignalPublished(
        bytes32 indexed txId,
        uint256 packedSignal,
        address indexed validator,
        uint8  signalType,
        uint32 coherence,
        uint32 threshold
    );

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "TRIONv2: not owner");
        _;
    }

    function addValidator(address v) external onlyOwner {
        validators[v] = true;
        emit ValidatorAdded(v);
    }

    function removeValidator(address v) external onlyOwner {
        validators[v] = false;
        emit ValidatorRemoved(v);
    }

    // ─── Core ─────────────────────────────────────────────────────────────────

    /**
     * @notice Publish a packed signal for a given transaction id.
     * @param txId         Keccak256 identifier of the pending transaction.
     * @param packedSignal 256-bit packed behavioral signal from the L0 engine.
     * @param signature    EIP-191 personal_sign signature over
     *                     keccak256(abi.encodePacked(txId, packedSignal)).
     *
     * The contract recovers the signer from the signature and verifies it is
     * an authorised validator — zero trusted intermediaries required.
     */
    function publishSignal(
        bytes32 txId,
        uint256 packedSignal,
        bytes calldata signature
    ) external {
        // 1. Reconstruct the message hash the validator signed
        bytes32 msgHash = keccak256(abi.encodePacked(txId, packedSignal));

        // 2. Apply EIP-191 prefix  ("\x19Ethereum Signed Message:\n32")
        bytes32 ethHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash)
        );

        // 3. Recover signer via ecrecover
        address signer = _recover(ethHash, signature);
        require(validators[signer], "TRIONv2: unauthorized validator");

        // 4. Store signal
        signals[txId]     = packedSignal;
        signalBlock[txId] = block.number;

        // 5. Decode for the event (convenience — no storage cost)
        uint8  signalType = uint8(packedSignal & 0x3);
        uint32 coherence  = uint32((packedSignal >> 17) & 0xFFFFFFFF);
        uint32 threshold  = uint32((packedSignal >> 49) & 0xFFFFFFFF);

        emit SignalPublished(txId, packedSignal, signer, signalType, coherence, threshold);
    }

    // ─── View ─────────────────────────────────────────────────────────────────

    function getSignal(bytes32 txId) external view returns (uint256) {
        return signals[txId];
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _recover(bytes32 hash, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "TRIONv2: bad sig length");
        bytes32 r;
        bytes32 s;
        uint8   v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "TRIONv2: bad sig v");
        address recovered = ecrecover(hash, v, r, s);
        require(recovered != address(0), "TRIONv2: ecrecover failed");
        return recovered;
    }
}
