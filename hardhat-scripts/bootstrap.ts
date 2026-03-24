/**
 * Bootstrap the V3 oracle with an initial set of signed signals and
 * verify the on-chain state by reading events from the last 50,000 blocks.
 *
 * Usage:
 *   TS_NODE_PROJECT=tsconfig.hardhat.json \
 *   npx hardhat run hardhat-scripts/bootstrap.ts --network arbitrumSepolia
 */
import { ethers } from "hardhat";

const ORACLE_ADDRESS = "0xb819c63c02Ed5aB49017C0f3f2568A14624658b3";

function legacyTxId(i: number): string {
  return ethers.keccak256(
    ethers.solidityPacked(["string", "uint256"], ["TRION_BOOTSTRAP_V3_SIGNAL_", i]),
  );
}

async function main() {
  const provider = ethers.provider;
  const oracle   = await ethers.getContractAt("TRIONOracleV3", ORACLE_ADDRESS);

  const network = await provider.getNetwork();
  const block   = await provider.getBlockNumber();

  console.log(`\nNetwork : Arbitrum Sepolia (chainId=${network.chainId})`);
  console.log(`Oracle  : ${ORACLE_ADDRESS}`);
  console.log(`Block   : ${block}\n`);

  const quorum = await oracle.quorumRequired();
  console.log(`Quorum  : ${quorum}\n`);

  const iface = new ethers.Interface([
    "event ThermodynamicSignalEtched(bytes32 indexed txId, uint8 status, uint32 coherence, uint32 threshold)",
  ]);
  const topic = iface.getEvent("ThermodynamicSignalEtched")!.topicHash;

  const fromBlock = Math.max(0, block - 50_000);
  console.log(`Scanning events from block ${fromBlock} to ${block}...`);

  const logs = await provider.getLogs({
    address: ORACLE_ADDRESS,
    topics:  [topic],
    fromBlock,
    toBlock: block,
  });

  console.log(`Events found: ${logs.length}\n`);

  console.log("Last 10 signals:");
  for (const log of logs.slice(-10).reverse()) {
    const parsed    = iface.parseLog({ topics: log.topics as string[], data: log.data })!;
    const txId      = parsed.args[0] as string;
    const status    = Number(parsed.args[1]);
    const coherence = Number(parsed.args[2]);
    const threshold = Number(parsed.args[3]);
    console.log(`  ${txId.slice(0, 14)}…  status=${status}  C(t)=${(coherence / 1e6).toFixed(4)}  Θ=${(threshold / 1e6).toFixed(4)}  blk=${log.blockNumber}`);
  }

  console.log("\nSpot-checking 5 legacy slots:");
  for (const i of [0, 24, 49, 74, 124]) {
    const id  = legacyTxId(i);
    const sig = await oracle.signals(id);
    console.log(`  SIGNAL_${String(i).padEnd(3)} → initialized=${sig[1]} ${sig[1] ? "✓" : "✗"}`);
  }

  console.log(`\nSummary: ${logs.length} signals on-chain, quorum=${quorum}, oracle=${ORACLE_ADDRESS}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
