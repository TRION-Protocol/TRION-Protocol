/**
 * TRION V2 — Arbitrum Sepolia Deployment Script
 *
 * Usage:
 *   TS_NODE_PROJECT=tsconfig.hardhat.json \
 *   npx hardhat run hardhat-scripts/deploy_v2_sepolia.ts --network arbitrumSepolia
 *
 * Required env vars (set in .env or environment):
 *   RELAYER_PRIVATE_KEY   — deployer / validator wallet private key
 *   ARBITRUM_SEPOLIA_RPC  — Arbitrum Sepolia JSON-RPC endpoint
 */

import { ethers } from "hardhat";

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║   TRION V2 — ARBITRUM SEPOLIA DEPLOYMENT                    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer  : ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance   : ${ethers.formatEther(balance)} ETH`);

  if (balance < ethers.parseEther("0.001")) {
    throw new Error("Insufficient Sepolia ETH for deployment (need ≥ 0.001 ETH)");
  }

  // ── Deploy TRIONOracleV2 ──────────────────────────────────────────────────
  console.log("\nDeploying TRIONOracleV2...");
  const OracleFactory = await ethers.getContractFactory("TRIONOracleV2");
  const oracle = await OracleFactory.deploy();
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log(`✔  TRIONOracleV2 deployed at: ${oracleAddress}`);

  // ── Register deployer as authorised validator ─────────────────────────────
  console.log("\nRegistering deployer as authorised validator...");
  const tx = await oracle.addValidator(deployer.address);
  await tx.wait(1);
  const isValidator = await oracle.validators(deployer.address);
  console.log(`✔  validators[${deployer.address}] = ${isValidator}`);

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("DEPLOYMENT COMPLETE");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`TRION_V2_ORACLE_ADDRESS=${oracleAddress}`);
  console.log(`Arbiscan: https://sepolia.arbiscan.io/address/${oracleAddress}`);
  console.log("══════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
