import fs from "fs";
import { ethers } from "ethers";

const JSON_PATH = "/tmp/trion_latest.json";
const POLL_INTERVAL_MS = 12_000;

const ORACLE_ABI = [
  "function updateNetworkState(uint256 _blockNumber, uint256 _cTScore, uint256 _muTBaseline, bool _isStable, bytes calldata _signature) external",
];

const ORACLE_ADDRESS = process.env["TRION_ORACLE_ADDRESS"] ?? "";

const EIP712_DOMAIN = {
  name: "TRION_Protocol",
  version: "1",
  chainId: 421614,
  verifyingContract: ORACLE_ADDRESS as `0x${string}`,
} as const;

const EIP712_TYPES = {
  NetworkState: [
    { name: "blockNumber", type: "uint256" },
    { name: "cTScore", type: "uint256" },
    { name: "muTBaseline", type: "uint256" },
    { name: "isStable", type: "bool" },
  ],
} as const;

function readL0State(): {
  block_number: number;
  features: { f9: number };
  mu_t: number;
  is_stable: boolean;
} | null {
  let raw: string;
  try {
    raw = fs.readFileSync(JSON_PATH, "utf-8");
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      console.log("Awaiting L0 data synchronization...");
    } else {
      console.error("[RELAYER] Failed to read L0 state file:", err);
    }
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    console.log("Awaiting L0 data synchronization...");
    return null;
  }
}

async function relay() {
  const privateKey = process.env["RELAYER_PRIVATE_KEY"];
  if (!privateKey) {
    console.error("[RELAYER] ERROR: RELAYER_PRIVATE_KEY not set in environment");
    process.exit(1);
  }

  const rpcUrl =
    process.env["ARBITRUM_SEPOLIA_RPC"] ||
    process.env["ARBITRUM_SEPOLIA_RPC_URL"] ||
    "https://sepolia-rollup.arbitrum.io/rpc";
  const oracleAddress = process.env["TRION_ORACLE_ADDRESS"];

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);

  console.log(`[RELAYER] Started — signer: ${signer.address}`);
  console.log(`[RELAYER] RPC: ${rpcUrl}`);
  console.log(`[RELAYER] Oracle: ${oracleAddress ?? "(not deployed — sign-only mode)"}`);
  console.log(`[RELAYER] Polling ${JSON_PATH} every ${POLL_INTERVAL_MS / 1000}s\n`);

  let lastRelayedBlock = 0;

  while (true) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const data = readL0State();
    if (!data) continue;

    const blockNumber = data.block_number;
    if (blockNumber <= lastRelayedBlock) {
      console.log(`[RELAYER] Block ${blockNumber} already relayed — waiting for new block`);
      continue;
    }

    const cTScore = BigInt(Math.round(data.features.f9 * 1_000_000));
    const muTBaseline = BigInt(Math.round(data.mu_t * 1_000_000));
    const isStable = data.is_stable;

    const payload = {
      blockNumber: BigInt(blockNumber),
      cTScore,
      muTBaseline,
      isStable,
    };

    console.log(`[RELAYER] Block ${blockNumber} — C(t)=${data.features.f9.toFixed(6)}  μ(t)=${data.mu_t.toFixed(6)}  stable=${isStable}`);

    const signature = await signer.signTypedData(EIP712_DOMAIN, EIP712_TYPES, payload);
    console.log(`[RELAYER] EIP-712 signature: ${signature}`);

    if (oracleAddress) {
      try {
        const oracle = new ethers.Contract(oracleAddress, ORACLE_ABI, signer);
        const tx = await oracle.updateNetworkState(
          payload.blockNumber,
          payload.cTScore,
          payload.muTBaseline,
          payload.isStable,
          signature,
        );
        console.log(`[RELAYER] Broadcast tx: ${tx.hash}`);
        await tx.wait(1);
        console.log(`[RELAYER] Confirmed ✓`);
      } catch (err) {
        console.error(`[RELAYER] Broadcast failed:`, err);
      }
    } else {
      console.log("[RELAYER] TRION_ORACLE_ADDRESS not set — signature produced but not broadcast");
    }

    lastRelayedBlock = blockNumber;
    console.log();
  }
}

relay().catch((err) => {
  console.error("[RELAYER] Fatal error:", err);
  process.exit(1);
});
