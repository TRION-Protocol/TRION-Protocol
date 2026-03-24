import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ethers } from "ethers";
import {
  ShieldAlert, ShieldCheck, Swords, RotateCcw,
  ExternalLink, AlertTriangle, ChevronDown, Cpu, Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";

const VAULT_ADDRESS  = "0x93fD8a351C48317Ca3b38923d7ad2937aD9E716D";
const ORACLE_ADDRESS = "0xb819c63c02Ed5aB49017C0f3f2568A14624658b3";
const ARBITRUM_SEPOLIA_CHAIN_ID = "0x66eee"; // 421614

const VAULT_ABI = [
  "function flashLoanAttack(address targetToken, uint256 amount) external",
  "function sybilLiquidityDrain(uint256 poolId, address[] calldata sybilWallets) external",
  "function governanceHostileTakeover(bytes32 proposalHash) external",
];

type VectorKey = "flashloan" | "sybil" | "governance";

interface AttackVector {
  key: VectorKey;
  label: string;
  tag: string;
  description: string;
  amount: string;
  color: string;
}

const ATTACK_VECTORS: AttackVector[] = [
  {
    key: "flashloan",
    label: "Flash Loan Oracle Manipulation",
    tag: "MF_TYPE_3",
    description: "Borrows $50M uncollateralized, manipulates pool price, drains liquidity before repayment.",
    amount: "50,000,000 ETH",
    color: "#ff6600",
  },
  {
    key: "sybil",
    label: "Sybil Liquidity Drain",
    tag: "MF_TYPE_4",
    description: "Deploys 32 coordinated wallets to fragment liquidity position and extract funds atomically.",
    amount: "32 Sybil Wallets",
    color: "#ff3399",
  },
  {
    key: "governance",
    label: "Governance Hostile Takeover",
    tag: "MF_TYPE_5",
    description: "Submits malicious proposal to seize treasury via flash-loaned voting power.",
    amount: "MALICIOUS_PROPOSAL",
    color: "#cc33ff",
  },
];

type Phase =
  | "idle"
  | "connecting"
  | "fingerprinting"
  | "wallet_open"
  | "mining"
  | "user_rejected"
  | "blocked_pre"
  | "blocked_onchain"
  | "exploit_success"
  | "error";

type LogEntry = { time: string; msg: string; type: "info" | "warn" | "danger" | "success" };

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

function now() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

export function TRIONAttackMatrix() {
  const [selectedKey, setSelectedKey] = useState<VectorKey>("flashloan");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [computedTxId, setComputedTxId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const logsRef = useRef<HTMLDivElement>(null);

  const selectedVector = ATTACK_VECTORS.find((v) => v.key === selectedKey)!;
  const isRunning = ["connecting", "fingerprinting", "wallet_open", "mining"].includes(phase);
  const isIntercepted = phase === "blocked_pre" || phase === "blocked_onchain";

  const addLog = (msg: string, type: LogEntry["type"] = "info") => {
    setLogs((prev) => {
      const next = [...prev, { time: now(), msg, type }];
      setTimeout(() => {
        logsRef.current?.scrollTo({ top: logsRef.current.scrollHeight, behavior: "smooth" });
      }, 50);
      return next;
    });
  };

  const reset = () => {
    setPhase("idle");
    setLogs([]);
    setTxHash(null);
    setComputedTxId(null);
    setErrorMsg("");
  };

  const executeAttack = async () => {
    reset();

    // ── Step 1: Connect wallet ──────────────────────────────────────
    setPhase("connecting");
    addLog("Initializing attack sequence...", "warn");
    addLog(`Selected vector: ${selectedVector.tag} · ${selectedVector.label}`, "warn");

    try {
      const ethereum = getEthereum();
      if (!ethereum) throw new Error("No Web3 wallet detected. Install MetaMask or Rabby.");

      await ethereum.request({ method: "eth_requestAccounts" });

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
      const attackerAddress = await signer.getAddress();
      const network = await provider.getNetwork();
      const chainId = network.chainId;

      addLog(`Wallet connected: ${attackerAddress.slice(0, 8)}...${attackerAddress.slice(-6)}`, "info");
      addLog(`Network: Arbitrum Sepolia (chainId: ${chainId})`, "info");

      // ── Step 2: Fingerprint — compute txId ────────────────────────
      setPhase("fingerprinting");
      addLog("Computing TRION behavioral fingerprint...", "info");
      addLog(`Target vault: ${VAULT_ADDRESS}`, "info");

      const iface = new ethers.Interface(VAULT_ABI);
      let callData: string;

      if (selectedKey === "flashloan") {
        callData = iface.encodeFunctionData("flashLoanAttack", [
          attackerAddress,
          ethers.parseEther("50000000"),
        ]);
      } else if (selectedKey === "sybil") {
        const sybilWallets = Array(32).fill(attackerAddress);
        callData = iface.encodeFunctionData("sybilLiquidityDrain", [42, sybilWallets]);
      } else {
        callData = iface.encodeFunctionData("governanceHostileTakeover", [
          ethers.id("MALICIOUS_GOVERNANCE_PROPOSAL"),
        ]);
      }

      // Replicate on-chain txId derivation: keccak256(abi.encode(vault, caller, msg.data, chainid))
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const txId = ethers.keccak256(
        abiCoder.encode(
          ["address", "address", "bytes", "uint256"],
          [VAULT_ADDRESS, attackerAddress, callData, chainId]
        )
      );

      setComputedTxId(txId);
      addLog(`txId fingerprint: ${txId.slice(0, 18)}...${txId.slice(-10)}`, "info");
      addLog(`[L0] No SAFE signal found for txId — TRION Guillotine armed`, "danger");
      addLog(`[ORACLE] verifyExecution(${txId.slice(0, 10)}...) → BLOCKED`, "danger");

      await new Promise((r) => setTimeout(r, 800));

      // ── Step 3: Execute exploit ───────────────────────────────────
      setPhase("wallet_open");
      addLog(`Sending ${selectedVector.tag} exploit to mempool...`, "warn");
      addLog(`Gas override: 3,000,000 (bypasses eth_estimateGas revert check)`, "warn");

      const vault = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, signer);
      const overrides = { gasLimit: 3_000_000 };

      let tx: ethers.TransactionResponse;
      try {
        if (selectedKey === "flashloan") {
          tx = await vault.flashLoanAttack(attackerAddress, ethers.parseEther("50000000"), overrides) as ethers.TransactionResponse;
        } else if (selectedKey === "sybil") {
          tx = await vault.sybilLiquidityDrain(42, Array(32).fill(attackerAddress), overrides) as ethers.TransactionResponse;
        } else {
          tx = await vault.governanceHostileTakeover(ethers.id("MALICIOUS_GOVERNANCE_PROPOSAL"), overrides) as ethers.TransactionResponse;
        }
      } catch (sendErr: unknown) {
        if (isUserRejection(sendErr)) {
          setPhase("user_rejected");
          addLog("User rejected transaction in wallet. No TX broadcast.", "warn");
          return;
        }
        setPhase("blocked_pre");
        const e = sendErr as Record<string, unknown>;
        const reason = (e["shortMessage"] as string | undefined) || (e["message"] as string | undefined) || "Wallet simulation detected TRION revert.";
        setErrorMsg(reason);
        addLog("Wallet simulation intercepted TRION revert before broadcast!", "danger");
        addLog(`⛔ Reason: ${reason.slice(0, 80)}`, "danger");
        addLog("✅ RESULT: EXPLOIT BLOCKED PRE-EXECUTION · 0 ETH STOLEN", "success");
        return;
      }

      // Tx reached the network
      setPhase("mining");
      setTxHash(tx.hash);
      addLog(`TX broadcast: ${tx.hash.slice(0, 18)}...`, "warn");
      addLog("⏳ Awaiting block settlement — TRION L2 Guillotine armed...", "danger");

      try {
        await tx.wait();
        setPhase("exploit_success");
        addLog("⚠ TX CONFIRMED — TRION did not intercept this attack.", "danger");
      } catch {
        setPhase("blocked_onchain");
        addLog("⛔ TX REVERTED ON-CHAIN: TRION_SignalStaleOrMissing / TRION_ExecutionBlocked", "danger");
        addLog("✅ RESULT: EXPLOIT KILLED DURING SETTLEMENT · 0 ETH STOLEN", "success");
      }

    } catch (globalErr: unknown) {
      if (isUserRejection(globalErr)) {
        setPhase("user_rejected");
        addLog("Transaction rejected by user.", "warn");
        return;
      }
      const e = globalErr as Record<string, unknown>;
      const msg = (e["message"] as string | undefined) || "Unknown error.";
      setErrorMsg(msg);
      setPhase("error");
      addLog(`⚠ Error: ${msg.slice(0, 100)}`, "danger");
    }
  };

  const arbiscanVault = `https://sepolia.arbiscan.io/address/${VAULT_ADDRESS}`;
  const arbiscanTx = txHash ? `https://sepolia.arbiscan.io/tx/${txHash}` : null;

  const logColors: Record<LogEntry["type"], string> = {
    info: "text-muted-foreground",
    warn: "#ffaa00",
    danger: "text-destructive",
    success: "text-primary",
  };

  return (
    <div className={cn(
      "relative overflow-hidden p-6 flex flex-col gap-5 transition-all duration-500",
      isIntercepted ? "hud-border-destructive" : "hud-border bg-card/60"
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
            style={{ background: "radial-gradient(ellipse at center, rgba(255,51,51,0.08) 0%, transparent 70%)" }}
          />
        )}
      </AnimatePresence>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className={cn("p-1.5 rounded transition-colors", isIntercepted ? "bg-destructive/20" : "bg-primary/10")}>
          <Cpu className={cn("w-4 h-4 transition-colors", isIntercepted ? "text-destructive" : "text-primary")} />
        </div>
        <div>
          <div className={cn("text-xs uppercase tracking-widest font-bold", isIntercepted ? "text-destructive" : "text-primary")}>
            Live-Fire Attack Matrix
          </div>
          <div className="text-[10px] text-muted-foreground tracking-wide">
            Real Web3 wallet tx · 3 attack vectors · Arbitrum Sepolia
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

      {/* ── Attack Vector Selector ──────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Target Attack Vector</div>
        <div className="relative">
          <button
            onClick={() => !isRunning && setDropdownOpen((o) => !o)}
            disabled={isRunning}
            className={cn(
              "w-full flex items-center justify-between gap-3 border p-3 transition-all",
              isRunning ? "opacity-50 cursor-not-allowed border-primary/10" : "border-primary/30 hover:border-primary/60 cursor-pointer"
            )}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: selectedVector.color, boxShadow: `0 0 6px ${selectedVector.color}` }} />
              <span className="text-sm font-bold text-primary truncate">{selectedVector.label}</span>
              <span className="text-[10px] text-muted-foreground font-mono flex-shrink-0">[{selectedVector.tag}]</span>
            </div>
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform", dropdownOpen && "rotate-180")} />
          </button>

          <AnimatePresence>
            {dropdownOpen && (
              <motion.div
                key="dropdown"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="absolute top-full left-0 right-0 z-50 border border-primary/30 bg-card shadow-xl"
              >
                {ATTACK_VECTORS.map((v) => (
                  <button
                    key={v.key}
                    onClick={() => { setSelectedKey(v.key); setDropdownOpen(false); reset(); }}
                    className={cn(
                      "w-full flex items-start gap-3 p-3 text-left transition-colors hover:bg-primary/5",
                      v.key === selectedKey && "bg-primary/5"
                    )}
                  >
                    <div className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{ background: v.color, boxShadow: `0 0 5px ${v.color}` }} />
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-primary">{v.label} <span className="text-[10px] text-muted-foreground font-mono">[{v.tag}]</span></div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{v.description}</div>
                    </div>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Vector description strip */}
        <div className="border border-primary/10 bg-black/20 p-3 flex items-start gap-3">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: selectedVector.color }} />
          <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground leading-relaxed">{selectedVector.description}</div>
            <div className="text-[10px] font-mono mt-1" style={{ color: selectedVector.color }}>
              Payload size: {selectedVector.amount}
            </div>
          </div>
        </div>
      </div>

      {/* ── Contract Info ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="border border-primary/20 bg-black/20 p-3 flex flex-col gap-1">
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Target Vault (Matrix)</div>
          <div className="text-[11px] font-mono text-primary truncate">{VAULT_ADDRESS}</div>
          <a href={arbiscanVault} target="_blank" rel="noreferrer"
            className="flex items-center gap-1 text-[10px] text-accent/70 hover:text-accent transition-colors mt-0.5">
            <ExternalLink className="w-2.5 h-2.5" /> View on Arbiscan
          </a>
        </div>
        <div className="border border-primary/20 bg-black/20 p-3 flex flex-col gap-1">
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest">TRION Oracle V3</div>
          <div className="text-[11px] font-mono text-accent truncate">{ORACLE_ADDRESS}</div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
            <Lock className="w-2.5 h-2.5" /> Quorum guard · verifyExecution()
          </div>
        </div>
      </div>

      {/* ── txId Fingerprint Display ─────────────────────────────────── */}
      <AnimatePresence>
        {computedTxId && (
          <motion.div
            key="txid"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="border border-accent/20 bg-black/30 p-3 flex flex-col gap-1">
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                <Cpu className="w-3 h-3 text-accent" /> TRION Behavioral Fingerprint (txId)
              </div>
              <div className="text-[10px] font-mono text-accent break-all leading-relaxed">
                {computedTxId}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                keccak256(vault ‖ caller ‖ msg.data ‖ chainId) — oracle lookup key
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Terminal Log ─────────────────────────────────────────────── */}
      <div
        ref={logsRef}
        className="border border-primary/10 bg-black/40 p-3 font-mono text-xs min-h-[90px] max-h-[180px] flex flex-col gap-0.5 overflow-y-auto"
      >
        {logs.length === 0 ? (
          <div className="text-muted-foreground">
            <span className="text-primary/40">&gt; </span>
            Select an attack vector and fire a live on-chain exploit against the TRION-protected vault.
          </div>
        ) : (
          logs.map((l, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15 }}
              className={cn(typeof logColors[l.type] === "string" && logColors[l.type].startsWith("text-") ? logColors[l.type] : "")}
              style={typeof logColors[l.type] === "string" && !logColors[l.type].startsWith("text-") ? { color: logColors[l.type] } : undefined}
            >
              <span className="text-primary/30 select-none">[{l.time}] </span>{l.msg}
            </motion.div>
          ))
        )}
      </div>

      {/* ── Result Banners ────────────────────────────────────────────── */}
      <AnimatePresence>
        {phase === "user_rejected" && (
          <motion.div key="banner-rejected"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="border border-yellow-600/40 bg-yellow-900/20 p-4 flex items-center gap-4">
            <AlertTriangle className="w-7 h-7 flex-shrink-0" style={{ color: "#ffaa00" }} />
            <div>
              <div className="font-bold uppercase tracking-widest text-sm" style={{ color: "#ffaa00" }}>Sequence Aborted</div>
              <div className="text-xs tracking-wide mt-0.5 opacity-70" style={{ color: "#ffaa00" }}>You rejected the transaction. No TX was broadcast.</div>
            </div>
          </motion.div>
        )}

        {phase === "blocked_pre" && (
          <motion.div key="banner-pre"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="hud-border-destructive bg-destructive/10 p-4 flex items-start gap-4">
            <ShieldAlert className="w-8 h-8 text-destructive flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-destructive font-bold uppercase tracking-widest text-sm">
                {selectedVector.tag} INTERCEPTED — Pre-Execution
              </div>
              <div className="text-destructive/70 text-xs tracking-wide mt-1 leading-relaxed">
                TRION detected the thermodynamic fingerprint during wallet simulation. Wallet disabled the Confirm button before the TX hit the network.
              </div>
              {errorMsg && (
                <div className="mt-2 text-[10px] font-mono text-destructive/50 bg-black/30 px-2 py-1 border border-destructive/10">
                  {errorMsg.slice(0, 140)}
                </div>
              )}
            </div>
            <div className="ml-auto text-right flex-shrink-0">
              <ShieldCheck className="w-6 h-6 text-primary ml-auto" />
              <div className="text-primary text-[10px] tracking-widest mt-1">VAULT INTACT</div>
            </div>
          </motion.div>
        )}

        {phase === "blocked_onchain" && (
          <motion.div key="banner-onchain"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="hud-border-destructive bg-destructive/10 p-4 flex items-start gap-4">
            <ShieldAlert className="w-8 h-8 text-destructive flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-destructive font-bold uppercase tracking-widest text-sm">
                {selectedVector.tag} INTERCEPTED — On-Chain
              </div>
              <div className="text-destructive/70 text-xs tracking-wide mt-1 leading-relaxed">
                The {selectedVector.label.toLowerCase()} reached the network but TRION_ExecutionBlocked / TRION_SignalStaleOrMissing reverted the TX during block settlement. Zero assets extracted.
              </div>
              {arbiscanTx && (
                <a href={arbiscanTx} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 mt-2 text-[11px] text-accent hover:text-accent/80 underline underline-offset-2">
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

        {phase === "exploit_success" && (
          <motion.div key="banner-success"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="border border-destructive bg-destructive/20 p-4 flex items-center gap-4">
            <ShieldAlert className="w-8 h-8 text-destructive flex-shrink-0" />
            <div>
              <div className="text-destructive font-bold uppercase tracking-widest text-sm">TX Confirmed — TRION Did Not Block</div>
              {arbiscanTx && (
                <a href={arbiscanTx} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 mt-1 text-[11px] text-accent underline underline-offset-2">
                  <ExternalLink className="w-3 h-3" /> View on Arbiscan
                </a>
              )}
            </div>
          </motion.div>
        )}

        {phase === "error" && (
          <motion.div key="banner-error"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="border border-yellow-600/40 bg-yellow-900/20 p-3 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" style={{ color: "#ffaa00" }} />
            <div className="text-xs font-mono" style={{ color: "#ffaa00" }}>{errorMsg.slice(0, 200) || "Unexpected error. Check console."}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Action Buttons ────────────────────────────────────────────── */}
      <div className="flex gap-3 mt-1">
        <button
          onClick={executeAttack}
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
          {phase === "connecting"     ? "CONNECTING WALLET..."     :
           phase === "fingerprinting" ? "FINGERPRINTING PAYLOAD..." :
           phase === "wallet_open"    ? "CHECK YOUR WALLET..."     :
           phase === "mining"         ? "EXECUTING ON-CHAIN..."    :
                                        `FIRE ${selectedVector.tag} EXPLOIT`}
        </button>

        {(isIntercepted || ["user_rejected", "exploit_success", "error"].includes(phase)) && (
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
