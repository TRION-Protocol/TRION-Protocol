import { ethers } from "hardhat";

/**
 * Deploy TRIONProtectedVault against the live V3 oracle on Arbitrum Sepolia.
 *
 * Usage:
 *   TS_NODE_PROJECT=tsconfig.hardhat.json \
 *   npx hardhat run hardhat-scripts/deploy-vault.ts --network arbitrumSepolia
 */
const ORACLE_ADDRESS = "0xb819c63c02Ed5aB49017C0f3f2568A14624658b3";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer : ${deployer.address}`);
  console.log(`Oracle   : ${ORACLE_ADDRESS}\n`);

  const TRIONProtectedVault = await ethers.getContractFactory("TRIONProtectedVault");
  const vault = await TRIONProtectedVault.deploy(ORACLE_ADDRESS);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();

  console.log(`TRIONProtectedVault : ${vaultAddress}`);
  console.log(`Arbiscan: https://sepolia.arbiscan.io/address/${vaultAddress}`);
  console.log(`\nSet env: TRION_PROTECTED_VAULT_ADDRESS=${vaultAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
