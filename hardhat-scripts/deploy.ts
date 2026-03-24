import { ethers } from "hardhat";

/**
 * Deploy TRIONOracleV3 and TRIONProtectedVault to the configured network.
 *
 * Usage (Arbitrum Sepolia):
 *   TS_NODE_PROJECT=tsconfig.hardhat.json \
 *   npx hardhat run hardhat-scripts/deploy.ts --network arbitrumSepolia
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`Deployer : ${deployer.address}`);
  console.log(`Balance  : ${ethers.formatEther(balance)} ETH\n`);

  if (balance < ethers.parseEther("0.001")) {
    throw new Error("Insufficient ETH for deployment (need >= 0.001 ETH)");
  }

  const TRIONOracleV3 = await ethers.getContractFactory("TRIONOracleV3");
  const oracle = await TRIONOracleV3.deploy();
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log(`TRIONOracleV3       : ${oracleAddress}`);

  const TRIONProtectedVault = await ethers.getContractFactory("TRIONProtectedVault");
  const vault = await TRIONProtectedVault.deploy(oracleAddress);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`TRIONProtectedVault : ${vaultAddress}`);

  console.log(`\nArbiscan: https://sepolia.arbiscan.io/address/${oracleAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
