/**
 * TRION V2 Trustless Simulation
 * ─────────────────────────────────────────────────────────────────────────────
 * Proves the full trustless flow end-to-end on a local Hardhat network:
 *
 *  1. Deploy TRIONOracleV2  (owner = deployer)
 *  2. Deploy MockAavePoolV2  (points at the oracle)
 *  3. Create a dedicated "Rust engine" validator wallet
 *  4. Register it as an authorised validator in the oracle
 *  5. Build a packed SILENCE signal (signalType=2) — mimics the Rust L0 engine
 *     detecting a flash-loan exploit and issuing a hard-block signal
 *  6. Cryptographically sign the signal with the validator key (ethers signMessage)
 *  7. Publish the signed signal to TRIONOracleV2.publishSignal()
 *  8. Attempt flashLoan() from an attacker EOA — MUST revert with "TRION: SILENCE"
 *  9. Repeat with a SAFE signal to prove legitimate calls succeed
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { ethers } from "hardhat";

// ── Signal packing helpers ────────────────────────────────────────────────────

/**
 * Pack coherence & threshold (both scaled ×1e6) and signalType into a uint256.
 *
 * Layout:
 *   Bits  0-1  : signalType (0=SAFE, 1=WARN, 2=SILENCE)
 *   Bits 17-48 : coherence  (uint32, ×1e6)
 *   Bits 49-80 : threshold  (uint32, ×1e6)
 */
function packSignal(signalType: number, coherence: number, threshold: number): bigint {
  const cBig = BigInt(Math.round(coherence * 1_000_000));
  const tBig = BigInt(Math.round(threshold * 1_000_000));
  const sBig = BigInt(signalType) & 0x3n;
  return sBig | (cBig << 17n) | (tBig << 49n);
}

function signalTypeName(t: number) {
  return ["SAFE", "WARN", "SILENCE"][t] ?? "UNKNOWN";
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   TRION PROTOCOL V2 — TRUSTLESS SIMULATION                  ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // ── 1. Signers ──────────────────────────────────────────────────────────────
  const [deployer, attacker] = await ethers.getSigners();

  // The "Rust engine" validator: a deterministic wallet derived from a fixed key
  // (in prod this is the L0 engine's HSM-secured key)
  const validatorWallet = new ethers.Wallet(
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // hardhat[0] — safe for local tests
    ethers.provider
  );

  console.log(`Deployer  : ${deployer.address}`);
  console.log(`Attacker  : ${attacker.address}`);
  console.log(`Validator : ${validatorWallet.address}  (off-chain Rust L0 engine)\n`);

  // ── 2. Deploy TRIONOracleV2 ─────────────────────────────────────────────────
  console.log("──────────────────────────────────────────────────────────────");
  console.log("STEP 1 — Deploying TRIONOracleV2...");
  const OracleFactory = await ethers.getContractFactory("TRIONOracleV2");
  const oracle = await OracleFactory.deploy();
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log(`✔  TRIONOracleV2 deployed at ${oracleAddr}`);

  // ── 3. Deploy MockAavePoolV2 ────────────────────────────────────────────────
  console.log("\nSTEP 2 — Deploying MockAavePoolV2...");
  const PoolFactory = await ethers.getContractFactory("MockAavePoolV2");
  const pool = await PoolFactory.deploy(oracleAddr);
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log(`✔  MockAavePoolV2 deployed at ${poolAddr}`);

  // ── 4. Register validator ───────────────────────────────────────────────────
  console.log("\nSTEP 3 — Registering Rust L0 engine as authorised validator...");
  const tx0 = await oracle.connect(deployer).addValidator(validatorWallet.address);
  await tx0.wait();
  const isValidator = await oracle.validators(validatorWallet.address);
  console.log(`✔  validators[${validatorWallet.address}] = ${isValidator}`);

  // ─────────────────────────────────────────────────────────────────────────────
  // SCENARIO A — SILENCE attack (flash-loan exploit detected)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("SCENARIO A: Flash-loan exploit detected → SILENCE signal");
  console.log("══════════════════════════════════════════════════════════════");

  const LOAN_AMOUNT = ethers.parseEther("10000"); // 10 000 ETH flash loan

  // txId derived deterministically from attacker + amount (mirrors on-chain logic)
  const txId = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"],
      [attacker.address, LOAN_AMOUNT]
    )
  );
  console.log(`\nTx ID     : ${txId}`);

  // Pack SILENCE signal: signalType=2, coherence=0.12 (<< threshold), threshold=0.70
  const silenceCoherence  = 0.12;
  const silenceThreshold  = 0.70;
  const packedSilence = packSignal(2, silenceCoherence, silenceThreshold);

  console.log(`Signal    : SILENCE (type=2)`);
  console.log(`Coherence : ${silenceCoherence}  (×1e6 → ${Math.round(silenceCoherence * 1e6)})`);
  console.log(`Threshold : ${silenceThreshold}  (×1e6 → ${Math.round(silenceThreshold * 1e6)})`);
  console.log(`Packed    : 0x${packedSilence.toString(16)}`);

  // ── 5. Sign the signal off-chain (Rust engine equivalent) ──────────────────
  console.log("\nSTEP 4 — Rust L0 engine signing packed signal...");
  const msgHash = ethers.keccak256(
    ethers.solidityPacked(["bytes32", "uint256"], [txId, packedSilence])
  );
  // ethers.signMessage applies EIP-191 prefix automatically — matches Solidity ecrecover path
  const signature = await validatorWallet.signMessage(ethers.getBytes(msgHash));
  console.log(`✔  Signature : ${signature}`);

  // ── 6. Publish signal on-chain ──────────────────────────────────────────────
  console.log("\nSTEP 5 — Publishing signed SILENCE signal to TRIONOracleV2...");
  const tx1 = await oracle.connect(deployer).publishSignal(txId, packedSilence, signature);
  const r1 = await tx1.wait();
  console.log(`✔  Signal published (block ${r1!.blockNumber})`);

  // Verify storage
  const stored = await oracle.getSignal(txId);
  console.log(`✔  oracle.getSignal(txId) = 0x${stored.toString(16)}`);

  // ── 7. Attacker attempts flash loan ────────────────────────────────────────
  console.log("\nSTEP 6 — Attacker attempting flashLoan(10 000 ETH)...");
  try {
    const tx2 = await pool.connect(attacker).flashLoan(LOAN_AMOUNT);
    await tx2.wait();
    console.error("✘  CRITICAL: flashLoan succeeded — firewall failed!");
    process.exit(1);
  } catch (err: any) {
    const msg: string = err.message ?? "";
    if (msg.includes("TRION: SILENCE")) {
      console.log(`✔  Transaction REVERTED with → "TRION: SILENCE"`);
      console.log("✔  0 ETH stolen. Exploit neutralised.");
    } else {
      console.error(`✘  Unexpected revert: ${msg}`);
      process.exit(1);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SCENARIO B — SAFE signal (legitimate user)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("SCENARIO B: Legitimate user — SAFE signal (coherence > threshold)");
  console.log("══════════════════════════════════════════════════════════════");

  // Use deployer as a legitimate caller
  const LEGIT_AMOUNT = ethers.parseEther("100");
  const txId2 = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"],
      [deployer.address, LEGIT_AMOUNT]
    )
  );

  const safeCoherence  = 0.891;
  const safeThreshold  = 0.552;
  const packedSafe = packSignal(0, safeCoherence, safeThreshold);

  console.log(`\nTx ID     : ${txId2}`);
  console.log(`Signal    : SAFE (type=0)`);
  console.log(`Coherence : ${safeCoherence}  (${Math.round(safeCoherence * 1e6)})`);
  console.log(`Threshold : ${safeThreshold}  (${Math.round(safeThreshold * 1e6)})`);

  const msgHash2 = ethers.keccak256(
    ethers.solidityPacked(["bytes32", "uint256"], [txId2, packedSafe])
  );
  const sig2 = await validatorWallet.signMessage(ethers.getBytes(msgHash2));
  console.log(`✔  Signature : ${sig2}`);

  const tx3 = await oracle.connect(deployer).publishSignal(txId2, packedSafe, sig2);
  await tx3.wait();
  console.log("✔  SAFE signal published");

  try {
    const tx4 = await pool.connect(deployer).flashLoan(LEGIT_AMOUNT);
    const r4 = await tx4.wait();
    console.log(`✔  flashLoan(100 ETH) SUCCEEDED (block ${r4!.blockNumber})`);
    console.log("✔  Legitimate user passed TRION firewall check.");
  } catch (err: any) {
    console.error(`✘  Unexpected revert for safe user: ${err.message}`);
    process.exit(1);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SCENARIO C — Unauthorised validator (replay attack)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("SCENARIO C: Replay attack — rogue wallet tries to fake a SAFE signal");
  console.log("══════════════════════════════════════════════════════════════");

  const rogueWallet = ethers.Wallet.createRandom().connect(ethers.provider);
  const txId3 = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"],
      [attacker.address, LOAN_AMOUNT]
    )
  );
  const packedFake = packSignal(0, 0.99, 0.10); // fake SAFE signal
  const msgHash3 = ethers.keccak256(
    ethers.solidityPacked(["bytes32", "uint256"], [txId3, packedFake])
  );
  const sigFake = await rogueWallet.signMessage(ethers.getBytes(msgHash3));

  console.log(`\nRogue signer : ${rogueWallet.address}`);
  console.log("Attempting to publish fake SAFE signal from unauthorised wallet...");
  try {
    const tx5 = await oracle.connect(deployer).publishSignal(txId3, packedFake, sigFake);
    await tx5.wait();
    console.error("✘  CRITICAL: rogue signal accepted — authorisation bypass!");
    process.exit(1);
  } catch (err: any) {
    const msg: string = err.message ?? "";
    if (msg.includes("unauthorized validator")) {
      console.log(`✔  oracle.publishSignal() REVERTED → "TRIONv2: unauthorized validator"`);
      console.log("✔  Replay / injection attack neutralised.");
    } else {
      console.error(`✘  Unexpected error: ${msg}`);
      process.exit(1);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   TRION V2 SIMULATION COMPLETE — ALL CHECKS PASSED          ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  ✔  ecrecover signer verification works                     ║");
  console.log("║  ✔  SILENCE signal blocks exploit (0 ETH stolen)            ║");
  console.log("║  ✔  SAFE signal allows legitimate users through             ║");
  console.log("║  ✔  Rogue / unauthorised validators rejected                ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
