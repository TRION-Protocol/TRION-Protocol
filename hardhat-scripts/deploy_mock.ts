import { ethers } from "hardhat";

async function main() {
    // The live TRION V2 Oracle on Arbitrum Sepolia
    const trionOracleAddress = "0x852365411bf700ba7257A93c134CBdE71A58d4E0";

    console.log("🛡️ Deploying MockLendingVault with TRIONGuard...");

    const MockLendingVault = await ethers.getContractFactory("MockLendingVault");
    const vault = await MockLendingVault.deploy(trionOracleAddress);

    await vault.waitForDeployment();
    const targetAddress = await vault.getAddress();

    console.log(`✅ MockLendingVault deployed to: ${targetAddress}`);
    console.log(`🔗 Secured by TRION Oracle at: ${trionOracleAddress}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
