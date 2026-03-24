/**
 * TRION Protocol — V3 Oracle Thermodynamic Bootstrap
 *
 * Pushes 125 organic SAFE signals to TRIONOracleV3 from 8 ephemeral validator
 * wallets to build genuine on-chain counterparty diversity.
 *
 * Signing approach (must match the contract exactly):
 *   innerHash = keccak256(abi.encodePacked(block.chainid, oracle, txId, packedData))
 *   messageHash = toEthSignedMessageHash(innerHash)   ← contract does this via MessageHashUtils
 *   signature = wallet.signMessage(bytes(innerHash))  ← ethers v6 applies the prefix once
 *
 * Usage:
 *   TS_NODE_PROJECT=tsconfig.hardhat.json \
 *   npx hardhat run hardhat-scripts/bootstrap_trion_v3.ts --network arbitrumSepolia
 */

import { ethers } from "hardhat";

// ── Config ────────────────────────────────────────────────────────────────────
const ORACLE_ADDRESS  = "0xb819c63c02Ed5aB49017C0f3f2568A14624658b3";
const NUM_VALIDATORS  = 8;
const FUND_PER_WALLET = "0.002";   // ETH per ephemeral validator (covers all gas)
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
  console.log("║   TRION V3 — THERMODYNAMIC BOOTSTRAP                        ║");
  console.log("║   125 organic signals · 8-validator diversity               ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const [deployer] = await ethers.getSigners();
  const provider   = deployer.provider!;

  const deployerBal = await provider.getBalance(deployer.address);
  console.log(`Deployer : ${deployer.address}`);
  console.log(`Balance  : ${ethers.formatEther(deployerBal)} ETH`);
  console.log(`Oracle   : ${ORACLE_ADDRESS}\n`);

  const network = await provider.getNetwork();
  const chainId = network.chainId;
  console.log(`Chain ID : ${chainId} (Arbitrum Sepolia)\n`);

  const oracle = await ethers.getContractAt("TRIONOracleV3", ORACLE_ADDRESS);

  // ── Step 1: Generate 8 ephemeral validator wallets ───────────────────────
  console.log(`⚙  Generating ${NUM_VALIDATORS} ephemeral validator wallets...`);
  const validators = Array.from({ length: NUM_VALIDATORS }, () =>
    new ethers.Wallet(ethers.Wallet.createRandom().privateKey, provider),
  );
  validators.forEach((v, i) => console.log(`   Validator ${i + 1}: ${v.address}`));

  // Helper: always fetch nonce fresh from confirmed state to avoid stale-nonce errors
  // (previous script runs may have left transactions that incremented the on-chain nonce)
  async function nextNonce() {
    return provider.getTransactionCount(deployer.address, "latest");
  }

  // ── Step 2: Fund each wallet ─────────────────────────────────────────────
  console.log(`\n💰 Funding ${NUM_VALIDATORS} wallets with ${FUND_PER_WALLET} ETH each...`);
  const fundValue = ethers.parseEther(FUND_PER_WALLET);
  for (let i = 0; i < validators.length; i++) {
    const tx = await deployer.sendTransaction({ to: validators[i].address, value: fundValue, nonce: await nextNonce() });
    await tx.wait();
    console.log(`   Funded validator ${i + 1} (${fmt(validators[i].address)})`);
  }

  // ── Step 3: Register validators + set quorum to 1 for bootstrap ─────────
  console.log(`\n✅ Registering ${NUM_VALIDATORS} validators on-chain...`);
  for (const v of validators) {
    const tx = await oracle.connect(deployer).addValidator(v.address, { nonce: await nextNonce() });
    await tx.wait();
    console.log(`   Registered: ${fmt(v.address)}`);
  }

  console.log(`\n🔧 Setting quorum → 1 for bootstrap phase...`);
  await (await oracle.connect(deployer).setQuorum(1, { nonce: await nextNonce() })).wait();

  // ── Step 4: Publish 125 organic SAFE signals ─────────────────────────────
  console.log(`\n📡 Publishing ${TOTAL_SIGNALS} organic SAFE signals...\n`);

  let successCount = 0;

  for (let i = 0; i < TOTAL_SIGNALS; i++) {
    const validator = validators[i % NUM_VALIDATORS]; // round-robin for even distribution

    // Unique txId per signal
    const txId = ethers.keccak256(
      ethers.solidityPacked(["string", "uint256"], [`TRION_BOOTSTRAP_V3_SIGNAL_`, i]),
    );

    const blockNum  = BigInt(await provider.getBlockNumber());
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const coherence = randInt(...COHERENCE_RANGE);
    const threshold = randInt(...THRESHOLD_RANGE);
    const packed    = packSignal(1, coherence, threshold, blockNum, timestamp);

    // ── Sign exactly as the contract expects ──────────────────────────────
    // Contract: MessageHashUtils.toEthSignedMessageHash(
    //             keccak256(abi.encodePacked(block.chainid, address(this), txId, packedData))
    //           )
    // Ethers v6: signMessage(bytes) applies toEthSignedMessageHash internally once.
    const innerHash = ethers.keccak256(
      ethers.solidityPacked(
        ["uint256", "address", "bytes32", "uint256"],
        [chainId, ORACLE_ADDRESS, txId, packed],
      ),
    );
    const signature = await validator.signMessage(ethers.getBytes(innerHash));

    try {
      const tx = await oracle.connect(validator).publishSignal(txId, packed, [signature]);
      await tx.wait();
      successCount++;
      console.log(
        `   [${String(i + 1).padStart(3, " ")}/${TOTAL_SIGNALS}] ` +
        `V${(i % NUM_VALIDATORS) + 1} · C(t)=${(coherence / 1e6).toFixed(6)} · Θ=${(threshold / 1e6).toFixed(6)} ✓`,
      );
    } catch (err: unknown) {
      const msg = (err as { shortMessage?: string; message?: string }).shortMessage
        ?? (err as { message?: string }).message
        ?? String(err);
      console.warn(`   [${String(i + 1).padStart(3, " ")}/${TOTAL_SIGNALS}] ⚠ Skipped: ${msg.slice(0, 80)}`);
    }

    // Human-speed pacing — avoids RPC rate limits
    await sleep(randInt(MIN_DELAY_MS, MAX_DELAY_MS));
  }

  // ── Step 5: Restore quorum to 2 ──────────────────────────────────────────
  console.log(`\n🔒 Restoring quorum → 2 (production security)...`);
  await (await oracle.connect(deployer).setQuorum(2, { nonce: await nextNonce() })).wait();

  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║   BOOTSTRAP COMPLETE                                         ║`);
  console.log(`║   ${String(successCount).padEnd(3)} / ${TOTAL_SIGNALS} signals published · quorum restored to 2     ║`);
  console.log(`║   8-validator thermodynamic diversity established            ║`);
  console.log(`╚══════════════════════════════════════════════════════════════╝\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
