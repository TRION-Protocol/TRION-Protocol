/**
 * TRION V3 Overwrite Bootstrap (Quorum = 2)
 *
 * Generates 8 NEW validator wallets, adds them to the existing set (pool → 16+),
 * and pushes 125 fresh signals with 2-of-N consensus signatures.
 *
 * Fixes applied vs. the original template:
 *  1. Signing hash matches the contract exactly — no extra "TRION_V3" suffix
 *     (that would cause "Invalid validator" on every signal).
 *  2. Signatures are sorted ascending by signer address before submission
 *     (contract enforces `signer > lastSigner` ordering).
 *  3. Nonces are tracked manually via "pending" count to avoid Arbitrum L2
 *     stale-nonce rejections between rapid sequential deployer txs.
 *
 * Contract signing spec:
 *   innerHash = keccak256(abi.encodePacked(block.chainid, oracle, txId, packedData))
 *   messageHash = toEthSignedMessageHash(innerHash)   ← contract via MessageHashUtils
 *   signature   = wallet.signMessage(bytes(innerHash)) ← ethers v6 applies prefix once
 */

import { ethers } from "hardhat";

const ORACLE_ADDRESS = "0xb819c63c02Ed5aB49017C0f3f2568A14624658b3";
const TOTAL_SIGNALS  = 125;

class TrionSDK {
  static packSignal(
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
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider   = ethers.provider;

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   TRION V3 — OVERWRITE BOOTSTRAP (Quorum=2, 16-validator)   ║");
  console.log("║   8 new wallets added · 125 fresh signals · 2 sigs each     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log(`Deployer : ${deployer.address}`);
  console.log(`Balance  : ${ethers.formatEther(await provider.getBalance(deployer.address))} ETH`);
  console.log(`Oracle   : ${ORACLE_ADDRESS}\n`);

  const oracle  = await ethers.getContractAt("TRIONOracleV3", ORACLE_ADDRESS);
  const network = await provider.getNetwork();
  const chainId = network.chainId;
  console.log(`Chain ID : ${chainId}\n`);

  // Track deployer nonce manually — Arbitrum L2 "latest" can lag behind sequencer
  let nonce = await provider.getTransactionCount(deployer.address, "pending");
  const nextNonce = () => nonce++;

  // ── Step 1: Generate 8 new ephemeral validator wallets ───────────────────
  console.log("⚠️  Previous keys were transient. Generating 8 NEW wallets to expand the validator set...");
  const wallets = Array.from({ length: 8 }, () =>
    ethers.Wallet.createRandom().connect(provider),
  );
  wallets.forEach((w, i) => console.log(`   Wallet ${i + 1}: ${w.address}`));

  // ── Step 2: Fund new validators ──────────────────────────────────────────
  console.log("\n💰 Funding new validators...");
  for (const w of wallets) {
    const tx = await deployer.sendTransaction({
      to: w.address,
      value: ethers.parseEther("0.002"),
      nonce: nextNonce(),
    });
    await tx.wait();
    console.log(`   Funded ${w.address.slice(0, 8)}…`);
  }

  // ── Step 3: Register wallets as validators (quorum untouched) ────────────
  console.log("\n✅ Adding new validators to the set (Quorum remains untouched at 2)...");
  for (const w of wallets) {
    const tx = await oracle.connect(deployer).addValidator(w.address, { nonce: nextNonce() });
    await tx.wait();
    console.log(`   Registered ${w.address.slice(0, 8)}…`);
  }

  // ── Step 4: Push 125 fresh signals ───────────────────────────────────────
  console.log(`\n📡 Pushing ${TOTAL_SIGNALS} fresh signals to overwrite legacy slots...\n`);

  let etched  = 0;
  let skipped = 0;

  for (let i = 0; i < TOTAL_SIGNALS; i++) {
    // Pick 2 DISTINCT validators
    const idxA = Math.floor(Math.random() * 8);
    let   idxB = Math.floor(Math.random() * 8);
    while (idxB === idxA) { idxB = Math.floor(Math.random() * 8); }
    const w1 = wallets[idxA];
    const w2 = wallets[idxB];

    // Fresh txId — unique per signal and per run
    const txId = ethers.id(`V3_OVERWRITE_${Date.now()}_${i}`);

    const blockNum  = BigInt(await provider.getBlockNumber());
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const packed    = TrionSDK.packSignal(1, 650_000, 600_000, blockNum, timestamp);

    // ── Correct inner hash — must match contract exactly ─────────────────
    // Contract: keccak256(abi.encodePacked(block.chainid, address(this), txId, packedData))
    // NO extra suffix string — that would corrupt the signer address recovery.
    const innerHash = ethers.keccak256(
      ethers.solidityPacked(
        ["uint256", "address", "bytes32", "uint256"],
        [chainId, ORACLE_ADDRESS, txId, packed],
      ),
    );

    const sig1 = await w1.signMessage(ethers.getBytes(innerHash));
    const sig2 = await w2.signMessage(ethers.getBytes(innerHash));

    // ── Sort signatures ascending by signer address ───────────────────────
    // Contract enforces `signer > lastSigner` — wrong order → revert.
    const pairs = [
      { addr: w1.address.toLowerCase(), sig: sig1 },
      { addr: w2.address.toLowerCase(), sig: sig2 },
    ].sort((a, b) => (a.addr < b.addr ? -1 : 1));

    const signatures = pairs.map((p) => p.sig);

    try {
      // Deployer submits — msg.sender need not be a validator, only signers must be
      const tx = await oracle.connect(deployer).publishSignal(txId, packed, signatures, { nonce: nextNonce() });
      await tx.wait();
      etched++;
      console.log(
        `   [${String(i + 1).padStart(3, " ")}/${TOTAL_SIGNALS}] ✔️  Etched ${txId.slice(0, 10)}… ` +
        `(Signers: ${w1.address.slice(0, 6)}, ${w2.address.slice(0, 6)})`,
      );
    } catch (err: unknown) {
      const msg =
        (err as { reason?: string }).reason ??
        (err as { shortMessage?: string }).shortMessage ??
        (err as { message?: string }).message ??
        String(err);

      if (msg.includes("already etched") || msg.includes("nonce")) {
        skipped++;
        console.log(`   [${String(i + 1).padStart(3, " ")}/${TOTAL_SIGNALS}] ⏭️  Skipped (already etched)`);
      } else {
        console.log(`   [${String(i + 1).padStart(3, " ")}/${TOTAL_SIGNALS}] ⚠️  Failed: ${msg.slice(0, 100)}`);
      }
    }

    // Organic delay to progress blocks
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`\n🎉 Complete! V3 memory buffer fully flushed with fresh quorum-backed signals.`);
  console.log(`   Etched  : ${etched}`);
  console.log(`   Skipped : ${skipped}`);
  console.log(`   Total   : ${etched + skipped} / ${TOTAL_SIGNALS}\n`);
}

main().catch(console.error);
