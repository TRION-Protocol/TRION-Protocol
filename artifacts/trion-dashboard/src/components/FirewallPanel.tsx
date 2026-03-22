import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldAlert, ShieldCheck, Swords, Zap, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

type SimPhase =
  | "idle"
  | "detecting"
  | "collapsing"
  | "guillotine"
  | "blocked";

interface SimState {
  phase: SimPhase;
  simulatedCt: number | null;
  simulatedTheta: number | null;
  threatsIntercepted: number;
}

const PHASE_DURATIONS: Record<SimPhase, number> = {
  idle: 0,
  detecting: 1400,
  collapsing: 1600,
  guillotine: 1200,
  blocked: 0,
};

const PHASES: SimPhase[] = ["detecting", "collapsing", "guillotine", "blocked"];

function usePersistentCount(key: string, initial: number) {
  const [count, setCount] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? Number(stored) : initial;
    } catch {
      return initial;
    }
  });
  const increment = () =>
    setCount((c) => {
      const next = c + 1;
      try { localStorage.setItem(key, String(next)); } catch {}
      return next;
    });
  return [count, increment] as const;
}

export function FirewallPanel({ liveCt, liveTheta }: { liveCt?: number; liveTheta?: number }) {
  const [threatsIntercepted, incrementThreats] = usePersistentCount("trion_threats", 0);
  const [sim, setSim] = useState<SimState>({
    phase: "idle",
    simulatedCt: null,
    simulatedTheta: null,
    threatsIntercepted: 0,
  });
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const isRunning = sim.phase !== "idle" && sim.phase !== "blocked";

  const clearTimeouts = () => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  };

  const addTimeout = (fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    timeoutsRef.current.push(t);
  };

  useEffect(() => () => clearTimeouts(), []);

  const runSimulation = () => {
    if (isRunning) return;
    clearTimeouts();

    const baseCt = liveCt ?? 0.55;
    const baseTheta = liveTheta ?? 0.55;

    setSim({ phase: "detecting", simulatedCt: baseCt, simulatedTheta: baseTheta, threatsIntercepted });

    let elapsed = PHASE_DURATIONS.detecting;

    addTimeout(() => {
      setSim((s) => ({ ...s, phase: "collapsing", simulatedCt: baseCt * 0.62 }));
    }, elapsed);
    elapsed += PHASE_DURATIONS.collapsing;

    addTimeout(() => {
      setSim((s) => ({ ...s, phase: "guillotine", simulatedCt: baseCt * 0.34 }));
    }, elapsed);
    elapsed += PHASE_DURATIONS.guillotine;

    addTimeout(() => {
      incrementThreats();
      setSim((s) => ({ ...s, phase: "blocked" }));
    }, elapsed);
  };

  const reset = () => {
    clearTimeouts();
    setSim({ phase: "idle", simulatedCt: null, simulatedTheta: null, threatsIntercepted });
  };

  const displayCt = sim.simulatedCt ?? liveCt ?? 0.55;
  const displayTheta = sim.simulatedTheta ?? liveTheta ?? 0.55;

  const firewallActive = sim.phase === "guillotine" || sim.phase === "blocked";
  const isCollapsing = sim.phase === "collapsing" || sim.phase === "guillotine";

  return (
    <div className={cn(
      "relative overflow-hidden p-6 flex flex-col gap-5 transition-all duration-500",
      firewallActive ? "hud-border-destructive" : "hud-border bg-card/60"
    )}>
      {/* Ambient glow overlay during attack */}
      <AnimatePresence>
        {firewallActive && (
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

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className={cn("p-1.5 rounded transition-colors", firewallActive ? "bg-destructive/20" : "bg-primary/10")}>
          <ShieldAlert className={cn("w-4 h-4 transition-colors", firewallActive ? "text-destructive" : "text-primary")} />
        </div>
        <div>
          <div className={cn("text-xs uppercase tracking-widest font-bold transition-colors", firewallActive ? "text-destructive" : "text-primary")}>
            L2 Execution Firewall
          </div>
          <div className="text-[10px] text-muted-foreground tracking-wide">
            Pre-execution anomaly interception · TRION v1.0
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <motion.div
            className={cn("w-2 h-2 rounded-full", firewallActive ? "bg-destructive" : "bg-primary")}
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: firewallActive ? 0.5 : 2, repeat: Infinity }}
          />
          <span className={cn("text-[10px] uppercase tracking-widest", firewallActive ? "text-destructive" : "text-primary")}>
            {firewallActive ? "ARMED" : "Monitoring"}
          </span>
        </div>
      </div>

      {/* ── Metrics Row ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        {/* Firewall Status */}
        <div className={cn(
          "border p-4 flex flex-col gap-1 transition-all duration-300",
          firewallActive ? "border-destructive/40 bg-destructive/5" : "border-primary/20 bg-black/20"
        )}>
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Firewall Status</div>
          <AnimatePresence mode="wait">
            {sim.phase === "idle" && (
              <motion.div key="safe" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 text-primary font-bold text-sm tracking-widest">
                <ShieldCheck className="w-4 h-4" /> SAFE
              </motion.div>
            )}
            {sim.phase === "detecting" && (
              <motion.div key="detecting" initial={{ opacity: 0 }} animate={{ opacity: [1, 0.5, 1] }}
                transition={{ duration: 0.6, repeat: Infinity }}
                className="flex items-center gap-1.5 text-warning font-bold text-xs tracking-widest"
                style={{ color: "#ffaa00" }}>
                <AlertTriangle className="w-4 h-4" /> SCANNING...
              </motion.div>
            )}
            {(sim.phase === "collapsing") && (
              <motion.div key="collapsing" initial={{ opacity: 0 }} animate={{ opacity: [1, 0.4, 1] }}
                transition={{ duration: 0.4, repeat: Infinity }}
                className="flex items-center gap-1.5 font-bold text-xs tracking-widest"
                style={{ color: "#ff6600" }}>
                <AlertTriangle className="w-4 h-4" /> COLLAPSE DETECTED
              </motion.div>
            )}
            {sim.phase === "guillotine" && (
              <motion.div key="guillotine" initial={{ opacity: 0 }} animate={{ opacity: [1, 0.2, 1] }}
                transition={{ duration: 0.25, repeat: Infinity }}
                className="flex items-center gap-1.5 text-destructive font-bold text-xs tracking-widest">
                <ShieldAlert className="w-4 h-4" /> SILENCE: GUILLOTINE
              </motion.div>
            )}
            {sim.phase === "blocked" && (
              <motion.div key="blocked" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-1.5 text-destructive font-bold text-xs tracking-widest">
                <ShieldAlert className="w-4 h-4" /> SILENCE ACTIVE
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Threats Intercepted */}
        <div className={cn(
          "border p-4 flex flex-col gap-1 transition-all duration-300",
          sim.phase === "blocked" ? "border-destructive/40 bg-destructive/5" : "border-primary/20 bg-black/20"
        )}>
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Threats Intercepted</div>
          <motion.div
            key={threatsIntercepted}
            initial={{ scale: 1.3, color: "#ff3333" }}
            animate={{ scale: 1, color: sim.phase === "blocked" ? "#ff3333" : "#00ff88" }}
            className="text-2xl font-bold tabular-nums text-glow"
          >
            {threatsIntercepted}
          </motion.div>
        </div>
      </div>

      {/* ── Simulated C(t) Display ───────────────────────────────── */}
      <AnimatePresence>
        {sim.phase !== "idle" && (
          <motion.div
            key="ct-display"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className={cn(
              "border p-4 flex flex-col gap-3 transition-colors duration-700",
              isCollapsing ? "border-destructive/40 bg-black/40" : "border-primary/20 bg-black/30"
            )}>
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Simulated Behavioral Coherence</div>
              <div className="flex items-end justify-between gap-4">
                <div>
                  <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: isCollapsing ? "#ff3333" : "#00ccff" }}>
                    C(t) Score
                  </div>
                  <motion.div
                    key={String(displayCt.toFixed(3))}
                    initial={{ scale: 1.05 }}
                    animate={{ scale: 1 }}
                    className={cn("text-3xl font-bold tabular-nums tracking-tighter")}
                    style={{ color: isCollapsing ? "#ff3333" : "#00ff88", textShadow: isCollapsing ? "0 0 10px rgba(255,51,51,0.5)" : "0 0 10px rgba(0,255,136,0.5)" }}
                  >
                    {displayCt.toFixed(6)}
                  </motion.div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Θ(t) Baseline</div>
                  <div className="text-xl font-bold text-accent tabular-nums">{displayTheta.toFixed(6)}</div>
                </div>
              </div>

              {/* Progress bar visualizing drop */}
              <div className="h-1.5 bg-black/60 rounded overflow-hidden">
                <motion.div
                  className="h-full rounded"
                  animate={{ width: `${Math.min(100, (displayCt / Math.max(displayTheta, 0.001)) * 100)}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  style={{ background: isCollapsing ? "#ff3333" : "#00ff88", boxShadow: isCollapsing ? "0 0 6px #ff3333" : "0 0 6px #00ff88" }}
                />
              </div>

              <div className="text-[10px] font-mono" style={{ color: isCollapsing ? "#ff3333" : "#00ccff" }}>
                {isCollapsing
                  ? `[L0] ALERT: C(t) = ${displayCt.toFixed(6)} — ${((1 - displayCt / Math.max(displayTheta, 0.001)) * 100).toFixed(1)}% below Θ(t) baseline`
                  : `[L0] Monitoring behavioral coherence...`}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Phase Logs ──────────────────────────────────────────── */}
      <div className="border border-primary/10 bg-black/40 p-3 font-mono text-xs min-h-[72px] flex flex-col justify-end gap-1 overflow-hidden">
        <AnimatePresence>
          {sim.phase === "idle" && (
            <motion.div key="idle-log" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="text-muted-foreground">
              <span className="text-primary/40">&gt; </span>System nominal. Click below to simulate a flash-loan exploit attempt.
            </motion.div>
          )}
          {sim.phase === "detecting" && (
            <motion.div key="det-log" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
              style={{ color: "#ffaa00" }}>
              <span className="opacity-60">&gt; </span>⚡ DETECTING ABNORMAL THERMODYNAMICS...
            </motion.div>
          )}
          {sim.phase === "collapsing" && (
            <>
              <motion.div key="col-log1" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                style={{ color: "#ffaa00" }}>
                <span className="opacity-60">&gt; </span>⚡ DETECTING ABNORMAL THERMODYNAMICS...
              </motion.div>
              <motion.div key="col-log2" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}
                style={{ color: "#ff6600" }}>
                <span className="opacity-60">&gt; </span>🔥 FLASH-LOAN SIGNATURE DETECTED — C(t) COLLAPSING
              </motion.div>
            </>
          )}
          {sim.phase === "guillotine" && (
            <>
              <motion.div key="gui-log1" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                style={{ color: "#ff6600" }}>
                <span className="opacity-60">&gt; </span>🔥 FLASH-LOAN SIGNATURE DETECTED — C(t) COLLAPSING
              </motion.div>
              <motion.div key="gui-log2" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                className="text-destructive font-bold animate-pulse">
                <span className="opacity-60">&gt; </span>🚨 THERMODYNAMIC COLLAPSE — DROPPING L2 GUILLOTINE
              </motion.div>
            </>
          )}
          {sim.phase === "blocked" && (
            <>
              <motion.div key="blk-log1" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }}
                className="text-destructive">
                <span className="opacity-60">&gt; </span>🚨 THERMODYNAMIC COLLAPSE — DROPPING L2 GUILLOTINE
              </motion.div>
              <motion.div key="blk-log2" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 }}
                className="text-destructive font-bold">
                <span className="opacity-60">&gt; </span>⛔ TX REVERTED: <span className="bg-destructive/20 px-1">TRION: SILENCE</span>
              </motion.div>
              <motion.div key="blk-log3" initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}
                className="text-primary font-bold">
                <span className="opacity-60">&gt; </span>✅ RESULT: TRANSACTION REVERTED · 0 ETH STOLEN
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* ── Final Block Alert ─────────────────────────────────────── */}
      <AnimatePresence>
        {sim.phase === "blocked" && (
          <motion.div
            key="block-alert"
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            className="hud-border-destructive bg-destructive/10 p-4 flex items-center gap-4"
          >
            <ShieldAlert className="w-8 h-8 text-destructive flex-shrink-0" />
            <div>
              <div className="text-destructive font-bold uppercase tracking-widest text-sm">
                Exploit Blocked
              </div>
              <div className="text-destructive/70 text-xs tracking-wide mt-0.5">
                TRANSACTION REVERTED: TRION: SILENCE &nbsp;·&nbsp; 0 ETH STOLEN
              </div>
            </div>
            <div className="ml-auto text-right">
              <CheckCircle2 className="w-6 h-6 text-primary ml-auto" />
              <div className="text-primary text-[10px] tracking-widest mt-1">VAULT INTACT</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Action Buttons ────────────────────────────────────────── */}
      <div className="flex gap-3 mt-1">
        <button
          onClick={runSimulation}
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
          {isRunning ? "SIMULATION RUNNING..." : "SIMULATE FLASH-LOAN ATTACK"}
        </button>

        {(sim.phase === "blocked" || sim.phase === "idle") && sim.phase !== "idle" && (
          <motion.button
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            onClick={reset}
            className="border border-primary/30 text-muted-foreground hover:text-primary hover:border-primary/60 py-3 px-4 text-xs uppercase tracking-widest transition-all"
          >
            <Zap className="w-3.5 h-3.5" />
          </motion.button>
        )}
      </div>
    </div>
  );
}
