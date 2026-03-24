import { ethers } from "hardhat";

const ORACLE_ADDRESS = "0xb819c63c02Ed5aB49017C0f3f2568A14624658b3";

async function main() {
  console.log("🚀 Deploying TRIONProtectedVault (Attack Matrix) to Arbitrum Sepolia...");

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Oracle (existing V3): ${ORACLE_ADDRESS}`);

  const TRIONProtectedVault = await ethers.getContractFactory("TRIONProtectedVault");
  const vault = await TRIONProtectedVault.deploy(ORACLE_ADDRESS);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();

  console.log(`\n✅ TRIONProtectedVault (Attack Matrix) deployed to: ${vaultAddress}`);
  console.log(`\n👉 Update TRION_PROTECTED_VAULT_ADDRESS env var to: ${vaultAddress}`);
  console.log(`👉 Update VAULT_ADDRESS in TRIONAttackMatrix.tsx to: ${vaultAddress}`);
  console.log(`\n🔍 Arbiscan: https://sepolia.arbiscan.io/address/${vaultAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
