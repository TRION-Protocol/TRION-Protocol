// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.24;

import "./TRIONOracleV4.sol";

/**
 * @title BehavioralIdentity
 * @notice On-chain Behavioral Process Identity (BPI) registry.
 *
 * Every entity registers its BPI here. Identity is causal and self-updating.
 * Governance weight is computed from BC × D × Love (CBRA principle).
 *
 * @custom:invention-10 Behavioral Process Identity (BPI)
 * @custom:invention-11 Coherence-Based Resource Allocation (CBRA)
 */

struct IdentityRecord {
    bytes32 bpi;           // Current BPI hash (updates every BPI_CYCLE events)
    bytes32 spawnerBpi;    // BPI of entity that created this entity
    bytes32 purposeHash;   // Hash of declared purpose
    uint32  love;          // Love coefficient × 1e6
    uint64  genesisBlock;  // Block when entity was first registered
    uint64  lastUpdated;   // Block of last BPI update
    uint64  updateCycle;   // How many BPI update cycles have occurred
    bool    active;        // False if entity was TERMINATEd
}

contract BehavioralIdentity {

    TRIONOracleV4 public immutable oracle;

    /// entity BPI → identity record
    mapping(bytes32 => IdentityRecord) public identities;

    /// address → BPI (for EOA-based entities)
    mapping(address => bytes32) public addressToBpi;

    /// Total registered entities
    uint256 public totalEntities;

    event EntityRegistered(
        bytes32 indexed bpi,
        bytes32 indexed spawnerBpi,
        bytes32 purposeHash,
        uint32  love,
        uint64  genesisBlock
    );

    event BPIUpdated(
        bytes32 indexed oldBpi,
        bytes32 indexed newBpi,
        uint64  updateCycle
    );

    event EntityTerminated(
        bytes32 indexed bpi,
        bytes32 indexed terminatedBy,
        uint64  timestamp
    );

    modifier onlyActive(bytes32 bpi) {
        require(identities[bpi].active, "BehavioralIdentity: entity not active");
        _;
    }

    modifier notSilenced(bytes32 bpi) {
        require(!oracle.isSilenced(bpi), "BehavioralIdentity: entity is SILENCED");
        _;
    }

    constructor(address oracleAddress) {
        oracle = TRIONOracleV4(oracleAddress);
    }

    /**
     * @notice Register a new behavioral entity.
     *
     * BPI = Blake3(causal_history_root || spawner_BPI || purpose_hash || love || env_hash)
     * The on-chain BPI is computed off-chain by the L1 engine and submitted here.
     *
     * @param bpi          32-byte Behavioral Process Identity
     * @param spawnerBpi   BPI of the spawning entity (or zero for genesis)
     * @param purpose      Human-readable purpose declaration (hashed on-chain)
     * @param love         Love coefficient ∈ [0, 1] × 1e6
     */
    function register(
        bytes32 bpi,
        bytes32 spawnerBpi,
        string  calldata purpose,
        uint32  love
    ) external {
        require(!identities[bpi].active, "BehavioralIdentity: BPI already registered");
        require(love <= 1_000_000, "BehavioralIdentity: love cannot exceed 1.0");

        bytes32 purposeHash = keccak256(bytes(purpose));

        identities[bpi] = IdentityRecord({
            bpi:          bpi,
            spawnerBpi:   spawnerBpi,
            purposeHash:  purposeHash,
            love:         love,
            genesisBlock: uint64(block.number),
            lastUpdated:  uint64(block.number),
            updateCycle:  0,
            active:       true
        });

        // Link caller address to BPI if it's an EOA
        if (addressToBpi[msg.sender] == bytes32(0)) {
            addressToBpi[msg.sender] = bpi;
        }

        totalEntities++;

        emit EntityRegistered(bpi, spawnerBpi, purposeHash, love, uint64(block.number));
    }

    /**
     * @notice Update BPI after a BPI_UPDATE_CYCLE (1000 events).
     *
     * The new BPI encodes the entity's current causal history.
     * Old BPI is preserved in the event log (causal history is permanent).
     */
    function updateBPI(
        bytes32 oldBpi,
        bytes32 newBpi,
        bytes32 causalHistoryRoot,
        bytes   calldata proof
    ) external onlyActive(oldBpi) notSilenced(oldBpi) {
        IdentityRecord storage record = identities[oldBpi];

        // Verify the new BPI is derived from causal history
        // In production: full BZKP verification
        require(newBpi != bytes32(0), "BehavioralIdentity: invalid new BPI");
        require(newBpi != oldBpi, "BehavioralIdentity: new BPI must differ from old");

        bytes32 prevBpi = oldBpi;
        record.bpi = newBpi;
        record.lastUpdated = uint64(block.number);
        record.updateCycle++;

        // Register new BPI (preserving spawner, purpose, love from old record)
        identities[newBpi] = IdentityRecord({
            bpi:          newBpi,
            spawnerBpi:   record.spawnerBpi,
            purposeHash:  record.purposeHash,
            love:         record.love,
            genesisBlock: record.genesisBlock,
            lastUpdated:  uint64(block.number),
            updateCycle:  record.updateCycle,
            active:       true
        });

        // Deactivate old BPI (not deleted — causal history preserved)
        identities[oldBpi].active = false;

        emit BPIUpdated(prevBpi, newBpi, record.updateCycle);
    }

    /**
     * @notice Terminate an entity — issues TERMINATE event via verified BPI.
     *
     * Used for: stolen device recovery, entity lifecycle end.
     * TERMINATE sets active = false. The Akashic Index record is permanent.
     *
     * @param bpi       BPI to terminate
     * @param ownerBpi  Owner's BPI (must have spawner relationship)
     */
    function terminate(
        bytes32 bpi,
        bytes32 ownerBpi
    ) external onlyActive(bpi) {
        IdentityRecord storage target = identities[bpi];
        IdentityRecord storage owner_rec = identities[ownerBpi];

        // Verify ownership: owner must be spawner or have spawner-chain relationship
        require(
            target.spawnerBpi == ownerBpi || owner_rec.spawnerBpi == target.spawnerBpi,
            "BehavioralIdentity: not authorized to terminate"
        );

        // Owner must not be silenced
        require(!oracle.isSilenced(ownerBpi), "BehavioralIdentity: owner is SILENCED");

        target.active = false;
        emit EntityTerminated(bpi, ownerBpi, uint64(block.timestamp));
    }

    /**
     * @notice Get governance voting weight for an entity.
     *
     * GovWeight = BC × D × Love (CBRA-weighted)
     */
    function votingWeight(bytes32 bpi) external view returns (uint256) {
        if (!identities[bpi].active) return 0;
        return oracle.governanceWeight(bpi);
    }

    /**
     * @notice Get age in blocks since genesis.
     */
    function entityAge(bytes32 bpi) external view returns (uint64) {
        return uint64(block.number) - identities[bpi].genesisBlock;
    }

    /**
     * @notice Check if entity can vote in governance.
     */
    function canVote(bytes32 bpi) external view returns (bool) {
        return identities[bpi].active && oracle.canVote(bpi);
    }
}
