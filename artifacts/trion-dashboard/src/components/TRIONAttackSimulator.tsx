import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ethers, keccak256, toUtf8Bytes } from "ethers";
import { ShieldAlert, ShieldCheck, Swords, RotateCcw, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const VAULT_ADDRESS = "0x66350c06196afBaC29f206F8Fc2b7d81B359D0D5";
const ORACLE_ADDRESS = "0x852365411bf700ba7257A93c134CBdE71A58d4E0";
const ARBITRUM_SEPOLIA_CHAIN_ID = "0x66eee"; // 421614

type Phase = "idle" | "connecting" | "sending" | "blocked" | "passed" | "error";

interface TxResult {
  hash?: string;
  revertReason?: string;
  errorMsg?: string;
}

function extractRevertReason(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error);
  const e = error as Record<string, unknown>;

  // ethers v6 wraps revert reasons in various places
  const reason =
    (e["reason"] as string | undefined) ||
    (e["shortMessage"] as string | undefined) ||
    ((e["data"] as Record<string, unknown> | undefined)?.["message"] as string | undefined);

  if (reason) return reason;

  const msg = (e["message"] as string | undefined) ?? "";

  // Try to parse the JSON-RPC error payload embedded in the message
  const match = msg.match(/reverted with reason string '([^']+)'/);
  if (match?.[1]) return match[1];

  // MetaMask sometimes buries it here
  const innerMsg = ((e["info"] as Record<string, unknown> | undefined)?.["error"] as Record<string, unknown> | undefined)?.["message"] as string | undefined;
  if (innerMsg) return innerMsg;

  return msg || "Unknown error";
}

export function TRIONAttackSimulator() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<TxResult>({});

  const reset = () => {
    setPhase("idle");
    setResult({});
  };

  const executeExploit = async () => {
    setPhase("connecting");
    setResult({});

    try {
      const win = window as unknown as { ethereum?: Record<string, unknown> };
      if (!win.ethereum) {
        throw new Error("MetaMask not detected. Please install MetaMask to run the live simulation.");
      }

      // Ensure we're on Arbitrum Sepolia
      try {
        await (win.ethereum as { request: (args: unknown) => Promise<unknown> }).request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: ARBITRUM_SEPOLIA_CHAIN_ID }],
        });
      } catch {
        // Chain may not be added; add it
        await (win.ethereum as { request: (args: unknown) => Promise<unknown> }).request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
            chainName: "Arbitrum Sepolia",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://sepolia-rollup.arbitrum.io/rpc"],
            blockExplorerUrls: ["https://sepolia.arbiscan.io"],
          }],
        });
      }

      const provider = new ethers.BrowserProvider(win.ethereum as unknown as ethers.Eip1193Provider);
      const signer = await provider.getSigner();

      const abi = [
        "function flashLoanAttack(bytes32 txId, uint256 amount) external",
      ];
      const vault = new ethers.Contract(VAULT_ADDRESS, abi, signer);

      const txId = keccak256(toUtf8Bytes("demo-attack-1"));
      const exploitAmount = ethers.parseEther("50000000");

      setPhase("sending");

      const tx = await vault.flashLoanAttack(txId, exploitAmount);
      await tx.wait();

      // If we get here, TRION did not block it (unexpected)
      setPhase("passed");
      setResult({ hash: tx.hash });
    } catch (error: unknown) {
      const reason = extractRevertReason(error);
      const isTrion = reason.includes("TRION") || reason.includes("Thermodynamic");

      // User rejected MetaMask prompt — just return to idle quietly
      const e = error as Record<string, unknown>;
      if ((e["code"] as string | number) === 4001 || (e["code"] as string | number) === "ACTION_REJECTED") {
        setPhase("idle");
        return;
      }

      if (isTrion) {
        setPhase("blocked");
        setResult({ revertReason: reason });
      } else {
        setPhase("error");
        setResult({ errorMsg: reason });
      }
    }
  };

  const isRunning = phase === "connecting" || phase === "sending";
  const arbiscanUrl = `https://sepolia.arbiscan.io/address/${VAULT_ADDRESS}`;

  return (
    <div className={cn(
      "relative overflow-hidden p-6 flex flex-col gap-5 transition-all duration-500",
      phase === "blocked" ? "hud-border-destructive" :
      phase === "passed"  ? "hud-border" :
                            "hud-border bg-card/60"
    )}>
      {/* Red glow during attack */}
      <AnimatePresence>
        {(phase === "sending" || phase === "blocked") && (
          <motion.div
            key="glow"
            className="absolute inset-0 pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ background: "radial-gradient(ellipse at center, rgba(255,51,51,0.07) 0%, transparent 70%)" }}
          />
        )}
      </AnimatePresence>

      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <div className={cn(
          "p-1.5 rounded transition-colors",
          phase === "blocked" ? "bg-destructive/20" : "bg-primary/10"
        )}>
          <ShieldAlert className={cn(
            "w-4 h-4 transition-colors",
            phase === "blocked" ? "text-destructive" : "text-primary"
          )} />
        </div>
        <div>
          <div className={cn(
            "text-xs uppercase tracking-widest font-bold transition-colors",
            phase === "blocked" ? "text-destructive" : "text-primary"
          )}>
            Live On-Chain Attack Simulator
          </div>
          <div className="text-[10px] text-muted-foreground tracking-wide">
            Real MetaMask tx · Arbitrum Sepolia · MockLendingVault
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <motion.div
            className={cn(
              "w-2 h-2 rounded-full",
              phase === "blocked" ? "bg-destructive" : "bg-primary"
            )}
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: phase === "blocked" ? 0.5 : 2, repeat: Infinity }}
          />
          <span className={cn(
            "text-[10px] uppercase tracking-widest",
            phase === "blocked" ? "text-destructive" : "text-primary"
          )}>
            {phase === "blocked" ? "BLOCKED" : phase === "sending" ? "TX LIVE" : "STANDBY"}
          </span>
        </div>
      </div>

      {/* ── Contract Info ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="border border-primary/20 bg-black/20 p-3 flex flex-col gap-1">
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Target Vault</div>
          <div className="text-[11px] font-mono text-primary truncate">{VAULT_ADDRESS}</div>
          <a
            href={arbiscanUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-[10px] text-accent/70 hover:text-accent transition-colors mt-0.5"
          >
            <ExternalLink className="w-2.5 h-2.5" /> View on Arbiscan
          </a>
        </div>
        <div className="border border-primary/20 bg-black/20 p-3 flex flex-col gap-1">
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Guard Oracle (V2)</div>
          <div className="text-[11px] font-mono text-accent truncate">{ORACLE_ADDRESS}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">onlyWhenCoherent · isSafe(txId)</div>
        </div>
      </div>

      {/* ── Terminal Log ── */}
      <div className="border border-primary/10 bg-black/40 p-3 font-mono text-xs min-h-[80px] flex flex-col justify-end gap-1 overflow-hidden">
        <AnimatePresence mode="popLayout">
          {phase === "idle" && (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="text-muted-foreground">
              <span className="text-primary/40">&gt; </span>
              Connect MetaMask and fire a real $50M flash-loan attack at the live vault.
            </motion.div>
          )}
          {phase === "connecting" && (
            <motion.div key="connecting" initial={{ opacity: 0, x: -4 }} animate={{ opacity: [1, 0.6, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
              style={{ color: "#ffaa00" }}>
              <span className="opacity-60">&gt; </span>⚡ Connecting to MetaMask · Switching to Arbitrum Sepolia...
            </motion.div>
          )}
          {phase === "sending" && (
            <>
              <motion.div key="s1" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                style={{ color: "#ff6600" }}>
                <span className="opacity-60">&gt; </span>🔴 Broadcasting flashLoanAttack(txId, 50_000_000 ETH)...
              </motion.div>
              <motion.div key="s2" initial={{ opacity: 0, x: -4 }} animate={{ opacity: [1, 0.4, 1] }}
                transition={{ duration: 0.4, repeat: Infinity, delay: 0.2 }}
                className="text-destructive font-bold">
                <span className="opacity-60">&gt; </span>🚨 TRION onlyWhenCoherent modifier intercepting...
              </motion.div>
            </>
          )}
          {phase === "blocked" && (
            <>
              <motion.div key="b1" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                className="text-destructive">
                <span className="opacity-60">&gt; </span>🔴 Broadcasting flashLoanAttack(txId, 50_000_000 ETH)...
              </motion.div>
              <motion.div key="b2" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}
                className="text-destructive font-bold">
                <span className="opacity-60">&gt; </span>
                ⛔ TX REVERTED: <span className="bg-destructive/20 px-1">{result.revertReason ?? "TRION: Thermodynamic Collapse Detected"}</span>
              </motion.div>
              <motion.div key="b3" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 }}
                className="text-primary font-bold">
                <span className="opacity-60">&gt; </span>✅ RESULT: EXPLOIT BLOCKED · 0 ETH STOLEN
              </motion.div>
            </>
          )}
          {phase === "passed" && (
            <>
              <motion.div key="p1" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                className="text-destructive font-bold">
                <span className="opacity-60">&gt; </span>⚠ TX CONFIRMED — TRION did not block this attack.
              </motion.div>
              {result.hash && (
                <motion.div key="p2" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}
                  className="text-accent text-[10px]">
                  <span className="opacity-60">&gt; </span>Hash: {result.hash.slice(0, 20)}...
                </motion.div>
              )}
            </>
          )}
          {phase === "error" && (
            <motion.div key="err" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
              style={{ color: "#ff6600" }}>
              <span className="opacity-60">&gt; </span>⚠ {result.errorMsg ?? "Unexpected error. Check console."}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Intercept Banner ── */}
      <AnimatePresence>
        {phase === "blocked" && (
          <motion.div
            key="banner"
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            className="hud-border-destructive bg-destructive/10 p-4 flex items-center gap-4"
          >
            <ShieldAlert className="w-8 h-8 text-destructive flex-shrink-0" />
            <div>
              <div className="text-destructive font-bold uppercase tracking-widest text-sm">
                Threat Intercepted
              </div>
              <div className="text-destructive/70 text-xs tracking-wide mt-0.5">
                ✅ "{result.revertReason ?? "TRION: Thermodynamic Collapse Detected"}"
              </div>
            </div>
            <div className="ml-auto text-right">
              <ShieldCheck className="w-6 h-6 text-primary ml-auto" />
              <div className="text-primary text-[10px] tracking-widest mt-1">VAULT INTACT</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Action Button ── */}
      <div className="flex gap-3 mt-1">
        <button
          onClick={executeExploit}
          disabled={isRunning}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-3 px-4",
            "border font-bold text-sm uppercase tracking-widest transition-all duration-200",
            isRunning
              ? "border-primary/20 text-muted-foreground cursor-not-allowed opacity-50"
              : "border-destructive text-destructive hover:bg-destructive/10 hover:shadow-[0_0_15px_rgba(255,51,51,0.3)] active:scale-[0.98]"
          )}
        >
          <Swords className="w-4 h-4" />
          {phase === "connecting" ? "CONNECTING WALLET..." :
           phase === "sending"    ? "EXECUTING ON-CHAIN..." :
                                    "SIMULATE $50M FLASH-LOAN ATTACK"}
        </button>

        {(phase === "blocked" || phase === "passed" || phase === "error") && (
          <motion.button
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            onClick={reset}
            className="border border-primary/30 text-muted-foreground hover:text-primary hover:border-primary/60 py-3 px-4 text-xs uppercase tracking-widest transition-all"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </motion.button>
        )}
      </div>
    </div>
  );
}
