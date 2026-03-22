/**
 * TRION Protocol — Organic History Bootstrapper
 *
 * Builds genuine on-chain counterparty diversity on Arbitrum Sepolia by:
 *   1. Generating 8 ephemeral sybil wallets
 *   2. Funding each from the deployer (~0.002 ETH for gas)
 *   3. Running 120 randomised micro-transfer rounds across distinct wallet pairs
 *      with 2-8 s human-speed delays between each transaction
 *
 * This populates the TRIONOracleV2 deployment's surrounding on-chain history
 * with organic, non-repeating counterparty patterns.
 *
 * Usage:
 *   TS_NODE_PROJECT=tsconfig.hardhat.json \
 *   npx hardhat run hardhat-scripts/bootstrap_organic_history.ts --network arbitrumSepolia
 */

import { ethers } from "hardhat";

// ── Config ────────────────────────────────────────────────────────────────────
const ORACLE_ADDRESS   = "0x852365411bf700ba7257A93c134CBdE71A58d4E0";
const NUM_SYBILS       = 8;
const FUND_AMOUNT_ETH  = "0.0025";   // per sybil wallet
const MICRO_SEND_ETH   = "0.00005";  // per interaction round
const TOTAL_ROUNDS     = 120;
const MIN_DELAY_MS     = 2_000;
const MAX_DELAY_MS     = 8_000;

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Pick two distinct indices from [0, n) */
function randPair(n: number): [number, number] {
  const a = randInt(0, n - 1);
  let b = randInt(0, n - 2);
  if (b >= a) b++;
  return [a, b];
}

function fmt(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   TRION — ORGANIC HISTORY BOOTSTRAPPER                      ║");
  console.log("║   Building counterparty diversity on Arbitrum Sepolia        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const [deployer] = await ethers.getSigners();
  const provider   = deployer.provider!;

  const deployerBal = await provider.getBalance(deployer.address);
  console.log(`Deployer  : ${deployer.address}`);
  console.log(`Balance   : ${ethers.formatEther(deployerBal)} ETH`);
  console.log(`Oracle V2 : ${ORACLE_ADDRESS}\n`);

  // ── 1. Generate sybil wallets ────────────────────────────────────────────
  console.log(`Generating ${NUM_SYBILS} ephemeral sybil wallets...`);
  const sybils = Array.from({ length: NUM_SYBILS }, (_, i) => {
    const wallet = ethers.Wallet.createRandom().connect(provider);
    console.log(`  [${i + 1}] ${wallet.address}`);
    return wallet;
  });
  console.log();

  // ── 2. Fund sybil wallets ────────────────────────────────────────────────
  const fundAmt = ethers.parseEther(FUND_AMOUNT_ETH);
  const totalFund = fundAmt * BigInt(NUM_SYBILS);

  if (deployerBal < totalFund + ethers.parseEther("0.01")) {
    throw new Error(
      `Insufficient deployer balance. Need ≥ ${ethers.formatEther(totalFund + ethers.parseEther("0.01"))} ETH`
    );
  }

  // Fund sequentially with nonce retry to tolerate the live relayer using the same wallet
  console.log(`Funding each sybil with ${FUND_AMOUNT_ETH} ETH...`);
  for (const [i, w] of sybils.entries()) {
    let funded = false;
    while (!funded) {
      try {
        const tx = await deployer.sendTransaction({ to: w.address, value: fundAmt });
        console.log(`  [${i + 1}] Funded ${fmt(w.address)} — tx ${tx.hash.slice(0, 12)}…`);
        await tx.wait(1);
        funded = true;
      } catch (err: any) {
        const msg: string = err?.message ?? String(err);
        if (msg.includes("nonce too low") || msg.includes("replacement transaction")) {
          console.log(`  [${i + 1}] Nonce conflict (relayer interference) — retrying in 2s…`);
          await sleep(2_000);
        } else {
          throw err;
        }
      }
    }
  }
  console.log("  All sybil wallets funded ✓\n");

  // ── 3. Organic interaction loop ──────────────────────────────────────────
  const microAmt = ethers.parseEther(MICRO_SEND_ETH);

  console.log(`Starting organic interaction loop — ${TOTAL_ROUNDS} rounds\n`);
  console.log("  Round │ Sender              │ Receiver            │ TxHash        │ Delay");
  console.log("  ──────┼─────────────────────┼─────────────────────┼───────────────┼──────");

  let successCount = 0;
  let failCount    = 0;

  for (let round = 1; round <= TOTAL_ROUNDS; round++) {
    const [si, ri] = randPair(NUM_SYBILS);
    const sender   = sybils[si];
    const receiver = sybils[ri];

    // Check sender still has enough for the micro-send + gas
    const senderBal = await provider.getBalance(sender.address);
    const gasReserve = ethers.parseEther("0.0005");

    if (senderBal < microAmt + gasReserve) {
      // Refuel from deployer with nonce-conflict retry
      let refueled = false;
      while (!refueled) {
        try {
          const refuel = await deployer.sendTransaction({ to: sender.address, value: fundAmt });
          await refuel.wait(1);
          refueled = true;
        } catch (err: any) {
          const msg: string = err?.message ?? String(err);
          if (msg.includes("nonce too low") || msg.includes("replacement transaction")) {
            await sleep(2_000);
          } else {
            throw err;
          }
        }
      }
    }

    const delayMs = randInt(MIN_DELAY_MS, MAX_DELAY_MS);

    try {
      const tx = await sender.sendTransaction({
        to:    receiver.address,
        value: microAmt,
      });

      const receipt = await tx.wait(1);
      successCount++;

      console.log(
        `  ${String(round).padStart(5)} │ ${fmt(sender.address).padEnd(19)} │ ` +
        `${fmt(receiver.address).padEnd(19)} │ ${tx.hash.slice(0, 12)}… │ ${delayMs}ms` +
        (receipt?.blockNumber ? ` (block ${receipt.blockNumber})` : "")
      );
    } catch (err: any) {
      failCount++;
      console.log(
        `  ${String(round).padStart(5)} │ ${fmt(sender.address).padEnd(19)} │ ` +
        `${fmt(receiver.address).padEnd(19)} │ FAILED: ${String(err?.message).slice(0, 30)}`
      );
    }

    if (round < TOTAL_ROUNDS) {
      await sleep(delayMs);
    }
  }

  // ── 4. Drain remaining sybil funds back to deployer ──────────────────────
  console.log("\n  Draining remaining sybil balances back to deployer...");
  for (const [i, wallet] of sybils.entries()) {
    try {
      const bal = await provider.getBalance(wallet.address);
      const gasPrice = (await provider.getFeeData()).gasPrice ?? ethers.parseUnits("0.1", "gwei");
      const gasCost  = gasPrice * 21_000n;
      const sendable = bal - gasCost;
      if (sendable > 0n) {
        const tx = await wallet.sendTransaction({
          to:       deployer.address,
          value:    sendable,
          gasPrice,
        });
        await tx.wait(1);
        console.log(`  [${i + 1}] Drained ${ethers.formatEther(sendable)} ETH from ${fmt(wallet.address)}`);
      }
    } catch {
      // Non-fatal — dust may remain
    }
  }

  // ── 5. Summary ───────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("BOOTSTRAP COMPLETE");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  Rounds completed : ${successCount} / ${TOTAL_ROUNDS}`);
  console.log(`  Failures         : ${failCount}`);
  console.log(`  Sybil wallets    : ${NUM_SYBILS}`);
  console.log(`  Oracle V2        : ${ORACLE_ADDRESS}`);
  console.log(`  Arbiscan         : https://sepolia.arbiscan.io/address/${ORACLE_ADDRESS}`);
  console.log("══════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
