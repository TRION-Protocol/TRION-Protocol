// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.24;

/**
 * @title AkashicProof
 * @notice On-chain Merkle root anchoring for the Akashic Index.
 *
 * The Akashic Index (TimescaleDB) stores behavioral events off-chain.
 * AkashicProof anchors Merkle roots on-chain, allowing verifiable
 * proofs of inclusion for any historical UBH event.
 *
 * Enables Behavioral Zero-Knowledge Proofs (BZKP — Invention #4):
 * Prove BC > Ψ without revealing individual plane values.
 *
 * @custom:invention-04 Behavioral Zero-Knowledge Proofs
 */
contract AkashicProof {

    struct AnchoredRoot {
        bytes32 merkleRoot;   // Merkle root of akashic_events chunk
        uint64  fromTimestamp; // GPS ns — start of this chunk
        uint64  toTimestamp;   // GPS ns — end of this chunk
        uint64  eventCount;    // Events included in this root
        uint64  anchoredAt;    // Block timestamp
        bytes32 prevRoot;      // Links to previous anchored root (causal chain)
    }

    /// Ordered anchored roots (causal chain of Akashic commitments)
    AnchoredRoot[] public anchoredRoots;

    /// Latest anchored root
    bytes32 public latestRoot;

    /// Anchor frequency: roots anchored every N seconds (default 3600 = 1 hour)
    uint256 public constant ANCHOR_INTERVAL = 3600;

    address public immutable oracle;

    event RootAnchored(
        bytes32 indexed merkleRoot,
        uint64 fromTimestamp,
        uint64 toTimestamp,
        uint64 eventCount,
        uint256 indexed rootIndex
    );

    event BZKPVerified(
        bytes32 indexed entityBpi,
        bytes32 indexed rootUsed,
        bool    bcAboveThreshold
    );

    modifier onlyOracle() {
        require(msg.sender == oracle, "AkashicProof: only oracle");
        _;
    }

    constructor(address _oracle) {
        oracle = _oracle;
    }

    /**
     * @notice Anchor a new Merkle root from the Akashic Index.
     *
     * Called by L3 archival daemon after each chunk is finalized.
     */
    function anchorRoot(
        bytes32 merkleRoot,
        uint64  fromTimestamp,
        uint64  toTimestamp,
        uint64  eventCount
    ) external onlyOracle {
        bytes32 prevRoot = anchoredRoots.length > 0
            ? anchoredRoots[anchoredRoots.length - 1].merkleRoot
            : bytes32(0);

        anchoredRoots.push(AnchoredRoot({
            merkleRoot:     merkleRoot,
            fromTimestamp:  fromTimestamp,
            toTimestamp:    toTimestamp,
            eventCount:     eventCount,
            anchoredAt:     uint64(block.timestamp),
            prevRoot:       prevRoot
        }));

        latestRoot = merkleRoot;

        emit RootAnchored(merkleRoot, fromTimestamp, toTimestamp, eventCount,
                          anchoredRoots.length - 1);
    }

    /**
     * @notice Verify Merkle inclusion proof for a UBH event.
     *
     * Proves that a specific behavioral event exists in the Akashic Index
     * without revealing the full event data.
     *
     * @param ubhSelfHash   Blake3 self_hash of the event to prove
     * @param merkleRoot    Root to prove against
     * @param proof         Merkle proof (sibling hashes)
     * @param leafIndex     Position of leaf in the Merkle tree
     */
    function verifyInclusion(
        bytes32 ubhSelfHash,
        bytes32 merkleRoot,
        bytes32[] calldata proof,
        uint256 leafIndex
    ) external pure returns (bool) {
        bytes32 computed = ubhSelfHash;
        uint256 index = leafIndex;

        for (uint i = 0; i < proof.length; i++) {
            if (index % 2 == 0) {
                computed = keccak256(abi.encodePacked(computed, proof[i]));
            } else {
                computed = keccak256(abi.encodePacked(proof[i], computed));
            }
            index /= 2;
        }

        return computed == merkleRoot;
    }

    /**
     * @notice Verify a Behavioral ZK Proof (BZKP).
     *
     * BZKP proves: BC(entity, t) > Ψ(entity, t)
     * without revealing: Φ, M, Σ, K, A individual plane values
     * or the specific UBH events that produced BC.
     *
     * In production: delegates to deployed Barretenberg/Noir verifier.
     */
    function verifyBZKP(
        bytes32 entityBpi,
        bytes32 anchoredRoot,
        bytes   calldata zkProof
    ) external returns (bool) {
        // Verify the anchored root exists in our chain
        bool rootExists = false;
        for (uint i = 0; i < anchoredRoots.length; i++) {
            if (anchoredRoots[i].merkleRoot == anchoredRoot) {
                rootExists = true;
                break;
            }
        }
        require(rootExists, "AkashicProof: root not anchored");

        // In production: call Noir Barretenberg verifier contract
        // bool verified = barretenbergVerifier.verify(zkProof, [entityBpi, anchoredRoot]);
        bool verified = zkProof.length >= 64; // Simplified stub

        emit BZKPVerified(entityBpi, anchoredRoot, verified);
        return verified;
    }

    /// @notice Total anchored roots.
    function rootCount() external view returns (uint256) {
        return anchoredRoots.length;
    }
}
