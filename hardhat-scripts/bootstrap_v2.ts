import { ethers } from "hardhat";

async function main() {
    const [deployer] = await ethers.getSigners();
    const oracleAddress = "0x852365411bf700ba7257A93c134CBdE71A58d4E0";
    const oracle = await ethers.getContractAt("TRIONOracleV2", oracleAddress);

    console.log("🧬 TRION Genesis: Initiating Organic State Generation...");
    
    const wallets = Array.from({ length: 8 }).map(() => ethers.Wallet.createRandom().connect(ethers.provider));
    
    console.log("💸 Funding 8 independent actors...");
    for (let i = 0; i < wallets.length; i++) {
        const tx = await deployer.sendTransaction({
            to: wallets[i].address,
            value: ethers.parseEther("0.005"),
        });
        await tx.wait();
        console.log(`   Actor ${i+1} funded: ${wallets[i].address}`);
    }

    console.log("\n🕸️ Commencing 150-Block Temporal Spread & Interaction Diversity...");
    
    for (let i = 1; i <= 150; i++) {
        const actorIndex = Math.floor(Math.random() * wallets.length);
        const activeActor = wallets[actorIndex];
        const actionType = Math.random();
        
        try {
            if (actionType > 0.3) {
                const tx = await activeActor.sendTransaction({
                    to: oracleAddress,
                    data: "0xfe7aceb7", 
                    value: 0
                });
                await tx.wait();
                console.log(`[Tx ${i}/150] 🟢 Actor ${actorIndex+1} pinged the Oracle.`);
            } else {
                const receiverIndex = (actorIndex + 1 + Math.floor(Math.random() * 5)) % wallets.length;
                const tx = await activeActor.sendTransaction({
                    to: wallets[receiverIndex].address,
                    value: ethers.parseEther("0.00001")
                });
                await tx.wait();
                console.log(`[Tx ${i}/150] 🔀 Actor ${actorIndex+1} sent value to Actor ${receiverIndex+1}.`);
            }
        } catch (e) {
            console.log(`[Tx ${i}/150] ⚠️ Minor collision, skipping to next block...`);
        }

        const delay = Math.floor(Math.random() * 9000) + 3000;
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    console.log("\n✅ Organic History Successfully Bootstrapped. The Moat is built.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
