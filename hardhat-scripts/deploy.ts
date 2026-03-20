import { ethers } from "hardhat";

async function main() {
  const RELAYER_ADDRESS =
    process.env["TRION_RELAYER_ADDRESS"] ??
    "0xdbbf66cad621da3ec186d18b29a135d2a5d42d20";

  console.log("Deploying TrionOracle to Arbitrum Sepolia...");
  console.log(`Relayer address: ${RELAYER_ADDRESS}`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying from: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} ETH`);

  const TrionOracle = await ethers.getContractFactory("TrionOracle");
  const oracle = await TrionOracle.deploy(RELAYER_ADDRESS);

  await oracle.waitForDeployment();

  const address = await oracle.getAddress();
  console.log("\n✅ TrionOracle deployed successfully!");
  console.log(`📍 Contract address: ${address}`);
  console.log(`🔗 Explorer: https://sepolia.arbiscan.io/address/${address}`);
  console.log("\nNext step — add this to your environment:");
  console.log(`TRION_ORACLE_ADDRESS=${address}`);
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
