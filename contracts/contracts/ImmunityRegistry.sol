// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.24;

import "./TRIONOracleV4.sol";

/**
 * @title ImmunityRegistry
 * @notice On-chain registry for IKP immune memory (CRISPR edits).
 *
 * Stores attack signatures and their corresponding CRISPR neutralization
 * edits on-chain. Any AXIOM node can query this registry to instantly
 * immunize against known behavioral attack patterns without waiting for
 * the 24-hour adaptive characterization period.
 *
 * @custom:invention-19 Behavioral Interrupt System (BIS)
 * @custom:system IKP MEMORY_LAYER
 */
contract ImmunityRegistry {

    struct ImmuneMemoryRecord {
        bytes32 attackSignature;    // 32-byte behavioral attack fingerprint
        string  crisprEdit;         // Human-readable patch description
        bytes32 immunityProof;      // Blake3 of attack + edit (verifiability)
        uint64  firstSeenAt;        // GPS timestamp of first observation
        uint64  seenCount;          // Times this pattern has been seen
        uint64  preventedCount;     // Times prevented after immunization
        string  entityType;         // Entity type this targets ("any", "process", "contract")
        uint8   bisLevel;           // Maximum BIS level this attack triggered
        bool    active;             // Is this pattern still being actively monitored?
    }

    /// attack_signature → immune memory record
    mapping(bytes32 => ImmuneMemoryRecord) public immuneMemory;

    /// Ordered list of known attack signatures
    bytes32[] public knownAttacks;

    TRIONOracleV4 public immutable oracle;

    address public immutable ikpController;

    event AttackCharacterized(
        bytes32 indexed attackSignature,
        uint8   bisLevel,
        string  entityType,
        uint64  timestamp
    );

    event AttackPrevented(
        bytes32 indexed attackSignature,
        bytes32 indexed entityBpi
    );

    event ImmunityProved(
        bytes32 indexed attackSignature,
        bytes32 indexed immunityProof
    );

    modifier onlyIKP() {
        require(msg.sender == ikpController, "ImmunityRegistry: not IKP controller");
        _;
    }

    constructor(address _oracle, address _ikpController) {
        oracle = TRIONOracleV4(_oracle);
        ikpController = _ikpController;
    }

    /**
     * @notice Register a newly characterized attack pattern.
     *
     * Called by IKP CRISPR_LAYER after attack characterization completes.
     *
     * @param attackSignature  32-byte behavioral fingerprint of the attack
     * @param crisprEdit       Description of the behavioral patch applied
     * @param immunityProof    Blake3(attack_sig || crispr_edit) — verifiable
     * @param bisLevel         Maximum BIS level this attack triggered
     * @param entityType       "any", "process", "contract", "human", etc.
     * @param firstSeenAt      GPS timestamp when first detected
     */
    function registerImmunity(
        bytes32 attackSignature,
        string  calldata crisprEdit,
        bytes32 immunityProof,
        uint8   bisLevel,
        string  calldata entityType,
        uint64  firstSeenAt
    ) external onlyIKP {
        require(bisLevel >= 1 && bisLevel <= 4, "ImmunityRegistry: invalid BIS level");
        require(!immuneMemory[attackSignature].active, "ImmunityRegistry: already registered");

        immuneMemory[attackSignature] = ImmuneMemoryRecord({
            attackSignature: attackSignature,
            crisprEdit:      crisprEdit,
            immunityProof:   immunityProof,
            firstSeenAt:     firstSeenAt,
            seenCount:       1,
            preventedCount:  0,
            entityType:      entityType,
            bisLevel:        bisLevel,
            active:          true
        });

        knownAttacks.push(attackSignature);

        emit AttackCharacterized(attackSignature, bisLevel, entityType, firstSeenAt);
        emit ImmunityProved(attackSignature, immunityProof);
    }

    /**
     * @notice Record a prevented attack.
     * Called when a known attack pattern is detected and blocked.
     */
    function recordPrevention(
        bytes32 attackSignature,
        bytes32 entityBpi
    ) external onlyIKP {
        require(immuneMemory[attackSignature].active, "ImmunityRegistry: unknown attack");
        immuneMemory[attackSignature].preventedCount++;
        immuneMemory[attackSignature].seenCount++;
        emit AttackPrevented(attackSignature, entityBpi);
    }

    /**
     * @notice Query if a behavioral pattern matches any known attack.
     *
     * Returns (isKnownAttack, attackSignature, bisLevel).
     * Used by INNATE_LAYER for sub-millisecond known-attack response.
     */
    function queryPattern(bytes32 pattern) external view
        returns (bool isKnown, bytes32 signature, uint8 bisLevel)
    {
        ImmuneMemoryRecord storage record = immuneMemory[pattern];
        if (record.active) {
            return (true, record.attackSignature, record.bisLevel);
        }
        return (false, bytes32(0), 0);
    }

    /**
     * @notice P(novel attack succeeds) = 1 / (immunizations + 1).
     *
     * Convergence: as knownAttacks.length → ∞, P → 0.
     */
    function breachProbabilityDenominator() external view returns (uint256) {
        return knownAttacks.length + 1;
    }

    /**
     * @notice Get total known attack patterns.
     */
    function totalImmunizations() external view returns (uint256) {
        return knownAttacks.length;
    }

    /**
     * @notice Get immune memory for a known attack.
     */
    function getImmunity(bytes32 attackSignature)
        external view returns (ImmuneMemoryRecord memory)
    {
        return immuneMemory[attackSignature];
    }
}
