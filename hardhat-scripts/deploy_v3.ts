import { ethers } from "hardhat";

async function main() {
  console.log("🚀 INITIATING TRION V3 INSTITUTIONAL DEPLOYMENT...");

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with the account: ${deployer.address}`);

  // 1. Deploy the V3 Oracle (The Quorum Brain)
  const TRIONOracleV3 = await ethers.getContractFactory("TRIONOracleV3");
  const oracle = await TRIONOracleV3.deploy();
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log(`✅ TRIONOracleV3 deployed to: ${oracleAddress}`);

  // 2. Deploy the Consumer Template (The Shielded Vault)
  const TRIONProtectedVault = await ethers.getContractFactory("TRIONProtectedVault");
  const vault = await TRIONProtectedVault.deploy(oracleAddress);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`✅ TRIONProtectedVault deployed to: ${vaultAddress}`);

  console.log("\n🛡️ DEPLOYMENT COMPLETE.");
  console.log("👉 Next Step: Update your frontend with these new V3 addresses.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
