/**
 * TRION — Organic History Bootstrapper (batch runner)
 *
 * Runs a single batch of 25 organic interactions between funded sybil wallets.
 * Run 5 times to achieve the full 120-round organic history.
 *
 * Uses pure ethers.js (no Hardhat) for fast startup.
 *
 * Usage (run from workspace root):
 *   BATCH=1 npx tsx hardhat-scripts/bootstrap_batch.ts
 *   BATCH=2 npx tsx hardhat-scripts/bootstrap_batch.ts
 *   ... up to BATCH=5
 */

import { ethers } from "ethers";
import * as fs from "fs";

const ORACLE_ADDRESS   = "0x852365411bf700ba7257A93c134CBdE71A58d4E0";
const FUND_AMOUNT_ETH  = "0.003";
const MICRO_SEND_ETH   = "0.00005";
const ROUNDS_PER_BATCH = 25;
const MIN_DELAY_MS     = 1_500;
const MAX_DELAY_MS     = 5_000;
const STATE_FILE       = "/tmp/trion_bootstrap_sybils.json";

const RPC_URL     = process.env["ARBITRUM_SEPOLIA_RPC"]    ??
                    process.env["ARBITRUM_SEPOLIA_RPC_URL"] ??
                    "https://arbitrum-sepolia-rpc.publicnode.com";
const PRIVATE_KEY = process.env["RELAYER_PRIVATE_KEY"] ?? "";

if (!PRIVATE_KEY) { console.error("RELAYER_PRIVATE_KEY not set"); process.exit(1); }

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function randInt(a: number, b: number) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function randPair(n: number): [number, number] {
  const a = randInt(0, n - 1); let b = randInt(0, n - 2); if (b >= a) b++; return [a, b];
}
function fmt(addr: string) { return `${addr.slice(0, 6)}…${addr.slice(-4)}`; }

async function sendWithRetry(
  sender: ethers.Wallet,
  to: string,
  value: bigint
): Promise<ethers.TransactionReceipt | null> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const tx = await sender.sendTransaction({ to, value });
      return await tx.wait(1);
    } catch (err: any) {
      const msg: string = err?.message ?? String(err);
      if (msg.includes("nonce too low") || msg.includes("replacement")) {
        await sleep(2_000);
      } else {
        throw err;
      }
    }
  }
  return null;
}

async function main() {
  const batchNum = Number(process.env["BATCH"] ?? "1");
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const deployer = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`\n[BOOTSTRAP] Batch ${batchNum} / 5 — ${ROUNDS_PER_BATCH} rounds`);
  console.log(`[BOOTSTRAP] Deployer : ${deployer.address}`);
  console.log(`[BOOTSTRAP] RPC      : ${RPC_URL}\n`);

  // ── Load or create sybil wallets (persist across batches) ─────────────────
  let sybilKeys: string[];
  if (batchNum === 1 || !fs.existsSync(STATE_FILE)) {
    console.log("Generating 8 fresh sybil wallets...");
    sybilKeys = Array.from({ length: 8 }, () => ethers.Wallet.createRandom().privateKey);
    fs.writeFileSync(STATE_FILE, JSON.stringify(sybilKeys));
  } else {
    console.log("Reusing sybil wallets from previous batch...");
    sybilKeys = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  }

  const sybils = sybilKeys.map((key) => new ethers.Wallet(key, provider));
  sybils.forEach((w, i) => console.log(`  [${i + 1}] ${w.address}`));
  console.log();

  // ── Fund any wallets below threshold (batch 1 or after drain) ────────────
  const fundAmt  = ethers.parseEther(FUND_AMOUNT_ETH);
  const microAmt = ethers.parseEther(MICRO_SEND_ETH);
  const gasFloor = ethers.parseEther("0.0005");

  for (const [i, w] of sybils.entries()) {
    const bal = await provider.getBalance(w.address);
    if (bal < microAmt + gasFloor) {
      console.log(`  Funding sybil [${i + 1}] ${fmt(w.address)}…`);
      const receipt = await sendWithRetry(deployer, w.address, fundAmt);
      if (receipt) console.log(`  ✔ Funded (block ${receipt.blockNumber})`);
      await sleep(500);
    }
  }
  console.log();

  // ── Organic interaction rounds ─────────────────────────────────────────────
  console.log(`  Round │ Sender      │ Receiver    │ Block       │ Delay`);
  console.log(`  ──────┼─────────────┼─────────────┼─────────────┼──────`);

  let ok = 0; let fail = 0;
  const overallRound = (batchNum - 1) * ROUNDS_PER_BATCH;

  for (let r = 1; r <= ROUNDS_PER_BATCH; r++) {
    const [si, ri] = randPair(sybils.length);
    const sender   = sybils[si];
    const receiver = sybils[ri];

    // Refuel if needed
    const bal = await provider.getBalance(sender.address);
    if (bal < microAmt + gasFloor) {
      await sendWithRetry(deployer, sender.address, fundAmt);
    }

    const delay = randInt(MIN_DELAY_MS, MAX_DELAY_MS);
    try {
      const receipt = await sendWithRetry(sender, receiver.address, microAmt);
      ok++;
      console.log(
        `  ${String(overallRound + r).padStart(5)} │ ${fmt(sender.address)} │ ` +
        `${fmt(receiver.address)} │ #${receipt?.blockNumber ?? "?"} │ ${delay}ms`
      );
    } catch (err: any) {
      fail++;
      console.log(`  ${String(overallRound + r).padStart(5)} │ FAILED: ${String(err?.message).slice(0, 40)}`);
    }

    if (r < ROUNDS_PER_BATCH) await sleep(delay);
  }

  console.log(`\n[BOOTSTRAP] Batch ${batchNum} done — ${ok} ok / ${fail} failed`);
  if (batchNum >= 5) {
    console.log("[BOOTSTRAP] All 5 batches complete — 125+ organic interactions on-chain ✓");
  } else {
    console.log(`[BOOTSTRAP] Run with BATCH=${batchNum + 1} for the next batch.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
