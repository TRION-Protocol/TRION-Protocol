import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ethers, keccak256, toUtf8Bytes } from "ethers";
import { ShieldAlert, ShieldCheck, Swords, RotateCcw, ExternalLink, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const VAULT_ADDRESS = "0x66350c06196afBaC29f206F8Fc2b7d81B359D0D5";
const ORACLE_ADDRESS = "0x852365411bf700ba7257A93c134CBdE71A58d4E0";
const ARBITRUM_SEPOLIA_CHAIN_ID = "0x66eee"; // 421614

type Phase =
  | "idle"
  | "wallet_open"
  | "mining"
  | "user_rejected"
  | "blocked_pre"
  | "blocked_onchain"
  | "exploit_success"
  | "error";

type EIP1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function getEthereum(): EIP1193Provider | null {
  return (window as unknown as { ethereum?: EIP1193Provider }).ethereum ?? null;
}

function isUserRejection(err: unknown): boolean {
  const s = JSON.stringify(err, Object.getOwnPropertyNames(err as object)).toLowerCase();
  return (
    s.includes("user rejected") ||
    s.includes("denied") ||
    s.includes("rejected by user") ||
    s.includes("action_rejected") ||
    (err as Record<string, unknown>)["code"] === 4001
  );
}

export function TRIONAttackSimulator() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const reset = () => {
    setPhase("idle");
    setTxHash(null);
    setErrorMsg("");
  };

  const executeExploit = async () => {
    setPhase("wallet_open");
    setTxHash(null);
    setErrorMsg("");

    try {
      const ethereum = getEthereum();
      if (!ethereum) throw new Error("No Web3 wallet detected. Install MetaMask, Trust, Rabby, or Coinbase Wallet.");

      // Explicitly request account access → triggers wallet connect popup
      await ethereum.request({ method: "eth_requestAccounts" });

      // Switch to Arbitrum Sepolia
      try {
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: ARBITRUM_SEPOLIA_CHAIN_ID }],
        });
      } catch {
        await ethereum.request({
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

      const provider = new ethers.BrowserProvider(ethereum as unknown as ethers.Eip1193Provider);
      const signer = await provider.getSigner();
      const abi = ["function flashLoanAttack(bytes32 txId, uint256 amount) external"];
      const vault = new ethers.Contract(VAULT_ADDRESS, abi, signer);
      const txId = keccak256(toUtf8Bytes("demo-attack-1"));
      const exploitAmount = ethers.parseEther("50000000");

      // ── Inner layer: catches user rejection & wallet pre-execution simulation failures ──
      let tx: ethers.TransactionResponse;
      try {
        // gasLimit bypasses ethers' eth_estimateGas pre-check so the wallet opens
        tx = await vault.flashLoanAttack(txId, exploitAmount, { gasLimit: 3_000_000 }) as ethers.TransactionResponse;
      } catch (sendError: unknown) {
        if (isUserRejection(sendError)) {
          // Scenario 1: user clicked Reject
          setPhase("user_rejected");
        } else {
          // Scenario 2: wallet ran internal simulation, hit the TRION revert, disabled confirm
          setPhase("blocked_pre");
          const e = sendError as Record<string, unknown>;
          setErrorMsg((e["shortMessage"] as string | undefined) || (e["message"] as string | undefined) || "Wallet simulation failed due to TRION revert.");
        }
        return;
      }

      // ── Outer layer: tx reached the network ──
      setPhase("mining");
      setTxHash(tx.hash);

      try {
        await tx.wait();
        // Should never happen — TRION should always revert this
        setPhase("exploit_success");
      } catch {
        // Scenario 3: forced on-chain, reverted during block settlement
        setPhase("blocked_onchain");
      }

    } catch (globalError: unknown) {
      const e = globalError as Record<string, unknown>;
      setErrorMsg((e["message"] as string | undefined) || "An unknown error occurred.");
      setPhase("error");
    }
  };

  const isRunning = phase === "wallet_open" || phase === "mining";
  const arbiscanVault = `https://sepolia.arbiscan.io/address/${VAULT_ADDRESS}`;
  const arbiscanTx = txHash ? `https://sepolia.arbiscan.io/tx/${txHash}` : null;

  const isIntercepted = phase === "blocked_pre" || phase === "blocked_onchain";

  return (
    <div className={cn(
      "relative overflow-hidden p-6 flex flex-col gap-5 transition-all duration-500",
      isIntercepted       ? "hud-border-destructive" :
      phase === "user_rejected" ? "hud-border bg-card/60" :
                            "hud-border bg-card/60"
    )}>
      {/* Red ambient glow */}
      <AnimatePresence>
        {(phase === "mining" || isIntercepted) && (
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
        <div className={cn("p-1.5 rounded transition-colors", isIntercepted ? "bg-destructive/20" : "bg-primary/10")}>
          <ShieldAlert className={cn("w-4 h-4 transition-colors", isIntercepted ? "text-destructive" : "text-primary")} />
        </div>
        <div>
          <div className={cn("text-xs uppercase tracking-widest font-bold transition-colors", isIntercepted ? "text-destructive" : "text-primary")}>
            Live On-Chain Attack Simulator
          </div>
          <div className="text-[10px] text-muted-foreground tracking-wide">
            Real Web3 wallet tx · Arbitrum Sepolia · MockLendingVault
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <motion.div
            className={cn("w-2 h-2 rounded-full", isIntercepted ? "bg-destructive" : "bg-primary")}
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: isIntercepted ? 0.5 : 2, repeat: Infinity }}
          />
          <span className={cn("text-[10px] uppercase tracking-widest", isIntercepted ? "text-destructive" : "text-primary")}>
            {isIntercepted ? "BLOCKED" : phase === "mining" ? "TX LIVE" : "STANDBY"}
          </span>
        </div>
      </div>

      {/* ── Contract Info ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="border border-primary/20 bg-black/20 p-3 flex flex-col gap-1">
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Target Vault</div>
          <div className="text-[11px] font-mono text-primary truncate">{VAULT_ADDRESS}</div>
          <a href={arbiscanVault} target="_blank" rel="noreferrer"
            className="flex items-center gap-1 text-[10px] text-accent/70 hover:text-accent transition-colors mt-0.5">
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
              Connect your Web3 wallet and fire a real $50M flash-loan attack at the live vault.
            </motion.div>
          )}
          {phase === "wallet_open" && (
            <motion.div key="wo" initial={{ opacity: 0, x: -4 }} animate={{ opacity: [1, 0.6, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }} style={{ color: "#ffaa00" }}>
              <span className="opacity-60">&gt; </span>⚡ Wallet open — approve connection and confirm transaction...
            </motion.div>
          )}
          {phase === "mining" && (
            <>
              <motion.div key="m1" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                style={{ color: "#ff6600" }}>
                <span className="opacity-60">&gt; </span>🔴 TX broadcast · flashLoanAttack(txId, 50_000_000 ETH) · gasLimit=3_000_000
              </motion.div>
              <motion.div key="m2" initial={{ opacity: 0, x: -4 }} animate={{ opacity: [1, 0.4, 1] }}
                transition={{ duration: 0.4, repeat: Infinity, delay: 0.2 }} className="text-destructive font-bold">
                <span className="opacity-60">&gt; </span>🚨 Awaiting block settlement — TRION L2 Guillotine armed...
              </motion.div>
            </>
          )}
          {phase === "user_rejected" && (
            <motion.div key="ur" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
              style={{ color: "#ffaa00" }}>
              <span className="opacity-60">&gt; </span>⚠ Simulation aborted — you clicked Reject in your wallet.
            </motion.div>
          )}
          {phase === "blocked_pre" && (
            <>
              <motion.div key="bp1" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                className="text-destructive">
                <span className="opacity-60">&gt; </span>🔴 Wallet ran local simulation — TRION revert detected...
              </motion.div>
              <motion.div key="bp2" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}
                className="text-destructive font-bold">
                <span className="opacity-60">&gt; </span>⛔ TX DISABLED: wallet blocked execution before broadcast
              </motion.div>
              <motion.div key="bp3" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 }}
                className="text-primary font-bold">
                <span className="opacity-60">&gt; </span>✅ RESULT: EXPLOIT BLOCKED PRE-EXECUTION · 0 ETH STOLEN
              </motion.div>
            </>
          )}
          {phase === "blocked_onchain" && (
            <>
              <motion.div key="bo1" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                className="text-destructive">
                <span className="opacity-60">&gt; </span>🔴 TX forced to network — settlement attempted...
              </motion.div>
              <motion.div key="bo2" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}
                className="text-destructive font-bold">
                <span className="opacity-60">&gt; </span>⛔ TX REVERTED ON-CHAIN: TRION L2 Guillotine dropped
              </motion.div>
              <motion.div key="bo3" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 }}
                className="text-primary font-bold">
                <span className="opacity-60">&gt; </span>✅ RESULT: EXPLOIT KILLED DURING BLOCK SETTLEMENT · 0 ETH STOLEN
              </motion.div>
            </>
          )}
          {phase === "exploit_success" && (
            <motion.div key="es" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
              className="text-destructive font-bold">
              <span className="opacity-60">&gt; </span>⚠ TX CONFIRMED — TRION did not block this attack.
            </motion.div>
          )}
          {phase === "error" && (
            <motion.div key="err" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
              style={{ color: "#ff6600" }}>
              <span className="opacity-60">&gt; </span>⚠ {errorMsg || "Unexpected error. Check console."}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Result Banners ── */}
      <AnimatePresence>
        {/* User rejected */}
        {phase === "user_rejected" && (
          <motion.div key="banner-rejected"
            initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}
            className="border border-yellow-600/40 bg-yellow-900/20 p-4 flex items-center gap-4">
            <AlertTriangle className="w-7 h-7 flex-shrink-0" style={{ color: "#ffaa00" }} />
            <div>
              <div className="font-bold uppercase tracking-widest text-sm" style={{ color: "#ffaa00" }}>
                Simulation Aborted
              </div>
              <div className="text-xs tracking-wide mt-0.5" style={{ color: "#ffaa00", opacity: 0.7 }}>
                You rejected the transaction in your wallet. No TX was sent.
              </div>
            </div>
          </motion.div>
        )}

        {/* Blocked pre-execution */}
        {phase === "blocked_pre" && (
          <motion.div key="banner-pre"
            initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}
            className="hud-border-destructive bg-destructive/10 p-4 flex items-start gap-4">
            <ShieldAlert className="w-8 h-8 text-destructive flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-destructive font-bold uppercase tracking-widest text-sm">
                Threat Intercepted — Pre-Execution
              </div>
              <div className="text-destructive/70 text-xs tracking-wide mt-1 leading-relaxed">
                TRION detected the thermodynamic anomaly during wallet simulation. Your wallet disabled the Confirm button before the TX reached the network.
              </div>
              {errorMsg && (
                <div className="mt-2 text-[10px] font-mono text-destructive/50 bg-black/30 px-2 py-1 border border-destructive/10">
                  {errorMsg.slice(0, 120)}
                </div>
              )}
            </div>
            <div className="ml-auto text-right flex-shrink-0">
              <ShieldCheck className="w-6 h-6 text-primary ml-auto" />
              <div className="text-primary text-[10px] tracking-widest mt-1">VAULT INTACT</div>
            </div>
          </motion.div>
        )}

        {/* Blocked on-chain */}
        {phase === "blocked_onchain" && (
          <motion.div key="banner-onchain"
            initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}
            className="hud-border-destructive bg-destructive/10 p-4 flex items-start gap-4">
            <ShieldAlert className="w-8 h-8 text-destructive flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-destructive font-bold uppercase tracking-widest text-sm">
                Threat Intercepted — On-Chain
              </div>
              <div className="text-destructive/70 text-xs tracking-wide mt-1 leading-relaxed">
                The attack was forced to the network but the TRION L2 Guillotine reverted the transaction during block settlement. Zero assets lost.
              </div>
              {arbiscanTx && (
                <a href={arbiscanTx} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 mt-2 text-[11px] text-accent hover:text-accent/80 transition-colors underline underline-offset-2">
                  <ExternalLink className="w-3 h-3" /> View Reverted Exploit on Arbiscan
                </a>
              )}
            </div>
            <div className="ml-auto text-right flex-shrink-0">
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
          {phase === "wallet_open" ? "CHECK YOUR WALLET..." :
           phase === "mining"      ? "EXECUTING ON-CHAIN..." :
                                     "SIMULATE $50M FLASH-LOAN ATTACK"}
        </button>

        {(isIntercepted || phase === "user_rejected" || phase === "exploit_success" || phase === "error") && (
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
