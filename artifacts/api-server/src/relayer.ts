/**
 * TRION Protocol — V2 Trustless Relayer
 *
 * Polls the L0 Rust indexer output every 12 s.
 * For each new block it:
 *   1. Determines signalType (SAFE / WARN / SILENCE) from C(t) vs Θ(t)
 *   2. Packs coherence + threshold + signalType into a 256-bit integer
 *   3. Signs the payload with EIP-191 personal_sign (ecrecover-compatible)
 *   4. Publishes the signed signal to TRIONOracleV2.publishSignal() on-chain
 *   5. Writes a local state cache for the dashboard API to serve
 *
 * Packed signal layout (mirrors TRIONOracleV2.sol):
 *   Bits   0-1  : signalType  (0=SAFE, 1=WARN, 2=SILENCE)
 *   Bits   2-16 : reserved
 *   Bits  17-48 : coherence   (scaled ×1e6, uint32)
 *   Bits  49-80 : threshold   (scaled ×1e6, uint32)
 */

import fs from "fs";
import { ethers } from "ethers";

const JSON_PATH       = "/tmp/trion_latest.json";
const V2_CACHE_PATH   = "/tmp/trion_v2_oracle.json";
const POLL_INTERVAL_MS = 12_000;

// ── V2 Oracle ABI (only the functions we call / read) ────────────────────────
const ORACLE_V2_ABI = [
  "function publishSignal(bytes32 txId, uint256 packedSignal, bytes calldata signature) external",
  "function getSignal(bytes32 txId) view returns (uint256)",
  "function validators(address) view returns (bool)",
  "function owner() view returns (address)",
];

// ── Signal type constants ────────────────────────────────────────────────────
const SIGNAL_SAFE    = 0;
const SIGNAL_WARN    = 1;
const SIGNAL_SILENCE = 2;

// ── Bit-packing ──────────────────────────────────────────────────────────────
/**
 * Pack signalType, coherence and threshold into a single uint256.
 *
 * @param signalType  0=SAFE, 1=WARN, 2=SILENCE
 * @param coherence   C(t) score, floating point (e.g. 0.872)
 * @param threshold   Θ(t) baseline, floating point (e.g. 0.552)
 */
function packSignal(signalType: number, coherence: number, threshold: number): bigint {
  const sBig = BigInt(signalType) & 0x3n;
  const cBig = BigInt(Math.round(coherence  * 1_000_000)) & 0xFFFFFFFFn;
  const tBig = BigInt(Math.round(threshold  * 1_000_000)) & 0xFFFFFFFFn;
  return sBig | (cBig << 17n) | (tBig << 49n);
}

/**
 * Derive a deterministic block-level txId.
 * Mirrors what a DeFi protocol would compute:  keccak256(abi.encode(blockNumber))
 */
function blockTxId(blockNumber: number): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [blockNumber])
  );
}

// ── L0 state reader ──────────────────────────────────────────────────────────
interface L0State {
  block_number: number;
  features: { f9: number };
  theta: number;
  mu_t: number;
  is_stable: boolean;
  alert: boolean;
}

function readL0State(): L0State | null {
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
    return JSON.parse(raw) as L0State;
  } catch {
    console.log("Awaiting L0 data synchronization...");
    return null;
  }
}

// ── Main relay loop ──────────────────────────────────────────────────────────
async function relay() {
  const privateKey = process.env["RELAYER_PRIVATE_KEY"];
  if (!privateKey) {
    console.error("[RELAYER] ERROR: RELAYER_PRIVATE_KEY not set");
    process.exit(1);
  }

  const rpcUrl =
    process.env["ARBITRUM_SEPOLIA_RPC"] ||
    process.env["ARBITRUM_SEPOLIA_RPC_URL"] ||
    "https://arbitrum-sepolia-rpc.publicnode.com";

  const oracleAddress = process.env["TRION_V2_ORACLE_ADDRESS"] ||
                        // Deployed 2026-03-22 to Arbitrum Sepolia — update if redeployed
                        "0x852365411bf700ba7257A93c134CBdE71A58d4E0";

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer   = new ethers.Wallet(privateKey, provider);

  console.log(`[RELAYER v2] Started   — signer   : ${signer.address}`);
  console.log(`[RELAYER v2] RPC       : ${rpcUrl}`);
  console.log(`[RELAYER v2] Oracle V2 : ${oracleAddress || "(address not set — sign-only mode)"}`);
  console.log(`[RELAYER v2] Polling ${JSON_PATH} every ${POLL_INTERVAL_MS / 1000}s\n`);

  let oracle: ethers.Contract | null = null;
  if (oracleAddress) {
    oracle = new ethers.Contract(oracleAddress, ORACLE_V2_ABI, signer);
  }

  let lastRelayedBlock = 0;

  while (true) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const data = readL0State();
    if (!data) continue;

    const { block_number: blockNumber, features: { f9: ct }, theta, mu_t, is_stable, alert } = data;

    if (blockNumber <= lastRelayedBlock) {
      console.log(`[RELAYER v2] Block ${blockNumber} already relayed — waiting`);
      continue;
    }

    // ── Determine signal type ──────────────────────────────────────────────
    let signalType: number;
    if (alert || ct < theta * 0.70) {
      signalType = SIGNAL_SILENCE;   // hard block: extreme coherence drop
    } else if (ct < theta) {
      signalType = SIGNAL_WARN;      // soft warn: below baseline but not critical
    } else {
      signalType = SIGNAL_SAFE;      // nominal
    }

    const signalName = ["SAFE", "WARN", "SILENCE"][signalType];

    // ── Pack signal ────────────────────────────────────────────────────────
    const packedSignal = packSignal(signalType, ct, theta);
    const txId         = blockTxId(blockNumber);

    console.log(`[RELAYER v2] Block ${blockNumber}`);
    console.log(`             C(t)=${ct.toFixed(6)}  Θ(t)=${theta.toFixed(6)}  μ(t)=${mu_t.toFixed(6)}  stable=${is_stable}`);
    console.log(`             Signal: ${signalName} (type=${signalType})`);
    console.log(`             Packed: 0x${packedSignal.toString(16)}`);
    console.log(`             TxId  : ${txId}`);

    // ── Sign (EIP-191 personal_sign — matches ecrecover in TRIONGuardV2) ──
    const msgHash = ethers.keccak256(
      ethers.solidityPacked(["bytes32", "uint256"], [txId, packedSignal])
    );
    const signature = await signer.signMessage(ethers.getBytes(msgHash));
    console.log(`[RELAYER v2] Signature: ${signature}`);

    // ── Write V2 cache (dashboard API reads this) ──────────────────────────
    const cachePayload = {
      version:       "v2",
      oracleAddress: oracleAddress || null,
      blockNumber,
      txId,
      signalType,
      signalName,
      coherence:     ct,
      threshold:     theta,
      packedSignal:  `0x${packedSignal.toString(16)}`,
      signature,
      isStable:      is_stable,
      alert,
      updatedAt:     Date.now(),
    };
    try {
      fs.writeFileSync(V2_CACHE_PATH, JSON.stringify(cachePayload), "utf-8");
    } catch (err) {
      console.error("[RELAYER v2] Failed to write cache:", err);
    }

    // ── Publish on-chain ──────────────────────────────────────────────────
    if (oracle && oracleAddress) {
      try {
        const tx = await oracle.publishSignal(txId, packedSignal, signature);
        console.log(`[RELAYER v2] Broadcast: ${tx.hash}`);
        const receipt = await tx.wait(1);
        console.log(`[RELAYER v2] Confirmed ✓ (block ${receipt?.blockNumber})`);
      } catch (err: any) {
        const msg: string = err?.message ?? String(err);
        if (msg.includes("already been relayed") || msg.includes("execution reverted")) {
          console.log(`[RELAYER v2] Signal already on-chain for block ${blockNumber} — skipping`);
        } else {
          console.error("[RELAYER v2] Broadcast failed:", msg.slice(0, 200));
        }
      }
    } else {
      console.log("[RELAYER v2] Oracle address not set — signature produced but not broadcast");
    }

    lastRelayedBlock = blockNumber;
    console.log();
  }
}

relay().catch((err) => {
  console.error("[RELAYER v2] Fatal:", err);
  process.exit(1);
});
