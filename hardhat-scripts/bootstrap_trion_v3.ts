/**
 * TRION Protocol — V3 Oracle Thermodynamic Bootstrap (Fresh Run)
 *
 * Pushes 125 fresh SAFE signals to TRIONOracleV3 using 8 new ephemeral
 * validator wallets registered alongside existing validators.
 *
 * Rules:
 *   - Do NOT reset existing validators or change quorum (stays at 2)
 *   - quorum=2 → every publishSignal sends 2 signatures, sorted ascending by
 *     signer address (contract enforces signer > lastSigner ordering)
 *   - txIds use the same formula as previous runs → overwrites any remaining
 *     unetched legacy slots; already-etched slots are skipped gracefully
 *   - status=1 (SAFE / EntropyNominal)
 *
 * Signing (must match contract exactly):
 *   innerHash = keccak256(abi.encodePacked(block.chainid, oracle, txId, packedData))
 *   messageHash = toEthSignedMessageHash(innerHash)   ← contract via MessageHashUtils
 *   signature = wallet.signMessage(bytes(innerHash))  ← ethers v6 applies prefix once
 *
 * Usage:
 *   TS_NODE_PROJECT=tsconfig.hardhat.json \
 *   npx hardhat run hardhat-scripts/bootstrap_trion_v3.ts --network arbitrumSepolia
 */

import { ethers } from "hardhat";

// ── Config ────────────────────────────────────────────────────────────────────
const ORACLE_ADDRESS  = "0xb819c63c02Ed5aB49017C0f3f2568A14624658b3";
const NUM_VALIDATORS  = 8;
const FUND_PER_WALLET = "0.003";   // ETH per ephemeral validator (2 sigs per tx = more gas)
const TOTAL_SIGNALS   = 125;
const MIN_DELAY_MS    = 800;
const MAX_DELAY_MS    = 2_500;

// C(t) and Θ(t) values scaled ×1e6 (realistic SAFE range)
const COHERENCE_RANGE  = [520_000, 620_000] as const;  // 0.52 – 0.62
const THRESHOLD_RANGE  = [480_000, 540_000] as const;  // 0.48 – 0.54

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function packSignal(
  status: number,
  coherence: number,
  threshold: number,
  blockNum: bigint,
  timestamp: bigint,
): bigint {
  let packed = BigInt(status) & BigInt(0xFF);
  packed |= (BigInt(coherence) & BigInt(0xFFFFFFFF)) << BigInt(8);
  packed |= (BigInt(threshold) & BigInt(0xFFFFFFFF)) << BigInt(40);
  packed |= (blockNum & BigInt(0xFFFFFFFFFFFFFFFF)) << BigInt(72);
  packed |= (timestamp & BigInt(0xFFFFFFFFFFFFFFFF)) << BigInt(136);
  return packed;
}

function fmt(addr: string) { return `${addr.slice(0, 8)}…${addr.slice(-6)}`; }

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   TRION V3 — FRESH BOOTSTRAP (quorum=2, no reset)           ║");
  console.log("║   125 legacy slots · 8 new validators · 2 sigs/signal       ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const [deployer] = await ethers.getSigners();
  const provider   = deployer.provider!;

  const deployerBal = await provider.getBalance(deployer.address);
  console.log(`Deployer : ${deployer.address}`);
  console.log(`Balance  : ${ethers.formatEther(deployerBal)} ETH`);
  console.log(`Oracle   : ${ORACLE_ADDRESS}\n`);

  const network = await provider.getNetwork();
  const chainId  = network.chainId;
  console.log(`Chain ID : ${chainId} (Arbitrum Sepolia)\n`);

  const oracle = await ethers.getContractAt("TRIONOracleV3", ORACLE_ADDRESS);

  // Confirm quorum — restore to 2 if a previous crashed run left it at 1
  const currentQuorum = await oracle.quorumRequired();
  console.log(`Quorum   : ${currentQuorum} (on-chain)\n`);

  // Seed nonce tracker from the pending nonce so we never get stale values
  // on Arbitrum L2, where "latest" can lag behind the sequencer's accepted nonce.
  let nonce = await provider.getTransactionCount(deployer.address, "pending");
  function nextNonce() { return nonce++; }

  if (currentQuorum !== 2n) {
    console.log(`🔧 Restoring quorum → 2 (was ${currentQuorum})...`);
    const tx = await oracle.connect(deployer).setQuorum(2, { nonce: nextNonce() });
    await tx.wait();
    console.log(`   Quorum set to 2 ✓\n`);
  } else {
    console.log(`   Quorum already 2 — untouched ✓\n`);
  }

  // ── Step 1: Generate 8 fresh ephemeral validator wallets ─────────────────
  console.log(`⚙  Generating ${NUM_VALIDATORS} fresh ephemeral validator wallets...`);
  const validators = Array.from({ length: NUM_VALIDATORS }, () =>
    new ethers.Wallet(ethers.Wallet.createRandom().privateKey, provider),
  );
  validators.forEach((v, i) => console.log(`   Validator ${i + 1}: ${v.address}`));

  // ── Step 2: Fund each wallet ─────────────────────────────────────────────
  console.log(`\n💰 Funding ${NUM_VALIDATORS} wallets with ${FUND_PER_WALLET} ETH each...`);
  const fundValue = ethers.parseEther(FUND_PER_WALLET);
  for (let i = 0; i < validators.length; i++) {
    const tx = await deployer.sendTransaction({
      to: validators[i].address,
      value: fundValue,
      nonce: nextNonce(),
    });
    await tx.wait();
    console.log(`   Funded validator ${i + 1} (${fmt(validators[i].address)})`);
  }

  // ── Step 3: Register new validators (existing ones are preserved) ─────────
  // addValidator is idempotent (sets bool → true); existing validators unaffected.
  console.log(`\n✅ Registering ${NUM_VALIDATORS} new validators on-chain (existing preserved)...`);
  for (const v of validators) {
    const tx = await oracle.connect(deployer).addValidator(v.address, { nonce: nextNonce() });
    await tx.wait();
    console.log(`   Registered: ${fmt(v.address)}`);
  }

  // ── Step 4: Publish 125 signals with quorum=2 (2 sigs, asc-sorted) ───────
  // For each signal:
  //   • Pick two validators in round-robin fashion (i%8 and (i+1)%8)
  //   • Sign the same innerHash with both
  //   • Sort the two (address, sig) pairs by address ascending — contract requires it
  //   • Submit with [sig_lower_addr, sig_higher_addr]
  console.log(`\n📡 Publishing ${TOTAL_SIGNALS} fresh SAFE signals (quorum=2, 2 sigs each)...\n`);

  let successCount = 0;
  let skippedEtched = 0;

  for (let i = 0; i < TOTAL_SIGNALS; i++) {
    const idxA = i % NUM_VALIDATORS;
    const idxB = (i + 1) % NUM_VALIDATORS;
    const valA = validators[idxA];
    const valB = validators[idxB];

    // Same txId formula as original bootstrap — targets all 125 legacy slots
    const txId = ethers.keccak256(
      ethers.solidityPacked(["string", "uint256"], [`TRION_BOOTSTRAP_V3_SIGNAL_`, i]),
    );

    const blockNum  = BigInt(await provider.getBlockNumber());
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const coherence = randInt(...COHERENCE_RANGE);
    const threshold = randInt(...THRESHOLD_RANGE);
    const packed    = packSignal(1, coherence, threshold, blockNum, timestamp);

    // Inner hash — both validators sign the same message
    const innerHash = ethers.keccak256(
      ethers.solidityPacked(
        ["uint256", "address", "bytes32", "uint256"],
        [chainId, ORACLE_ADDRESS, txId, packed],
      ),
    );

    const sigA = await valA.signMessage(ethers.getBytes(innerHash));
    const sigB = await valB.signMessage(ethers.getBytes(innerHash));

    // Contract enforces signer > lastSigner (ascending order by address)
    const pairs = [
      { addr: valA.address.toLowerCase(), sig: sigA },
      { addr: valB.address.toLowerCase(), sig: sigB },
    ].sort((x, y) => (x.addr < y.addr ? -1 : 1));

    const signatures = pairs.map((p) => p.sig);

    // Use lower-address validator as tx sender (either works — just needs to be registered)
    const sender = pairs[0].addr === valA.address.toLowerCase() ? valA : valB;

    try {
      const tx = await oracle.connect(sender).publishSignal(txId, packed, signatures);
      await tx.wait();
      successCount++;
      console.log(
        `   [${String(i + 1).padStart(3, " ")}/${TOTAL_SIGNALS}] ` +
        `V${idxA + 1}+V${idxB + 1} · C(t)=${(coherence / 1e6).toFixed(6)} · Θ=${(threshold / 1e6).toFixed(6)} ✓`,
      );
    } catch (err: unknown) {
      const msg = (err as { shortMessage?: string; message?: string }).shortMessage
        ?? (err as { message?: string }).message
        ?? String(err);

      if (msg.includes("already etched") || msg.includes("Signal already")) {
        skippedEtched++;
        console.log(
          `   [${String(i + 1).padStart(3, " ")}/${TOTAL_SIGNALS}] ` +
          `slot already etched — skipped gracefully`,
        );
      } else {
        console.warn(
          `   [${String(i + 1).padStart(3, " ")}/${TOTAL_SIGNALS}] ⚠ Error: ${msg.slice(0, 100)}`,
        );
      }
    }

    // Human-speed pacing — avoids RPC rate limits
    await sleep(randInt(MIN_DELAY_MS, MAX_DELAY_MS));
  }

  const overwritten = successCount;
  const totalSlots  = successCount + skippedEtched;

  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║   BOOTSTRAP COMPLETE                                         ║`);
  console.log(`║   ${String(overwritten).padEnd(3)} fresh signals published (quorum=2, 2 sigs each)   ║`);
  console.log(`║   ${String(skippedEtched).padEnd(3)} slots already etched — skipped gracefully         ║`);
  console.log(`║   ${String(totalSlots).padEnd(3)} / ${TOTAL_SIGNALS} legacy slots covered                       ║`);
  console.log(`║   Quorum unchanged · Existing validators preserved           ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
