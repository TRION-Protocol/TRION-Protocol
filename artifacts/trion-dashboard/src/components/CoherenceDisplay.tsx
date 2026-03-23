import { motion } from "framer-motion";
import { Zap } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import type { TrionData } from "@/hooks/use-trion";

export function CoherenceDisplay({ data }: { data: TrionData }) {
  const isAnomaly = data.alert;

  return (
    <div className={cn(
      "w-full h-full flex flex-col justify-center p-6 lg:p-8 rounded-2xl border relative overflow-hidden group shadow-xl transition-all duration-500",
      isAnomaly
        ? "border-destructive/40 bg-gradient-to-br from-red-950/40 to-black"
        : "border-primary/20 bg-gradient-to-br from-slate-900 to-black"
    )}>
      {/* Ambient glow blob */}
      <div className={cn(
        "absolute top-0 right-0 w-56 h-56 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none transition-all duration-700 group-hover:scale-110",
        isAnomaly ? "bg-destructive/8" : "bg-emerald-500/6"
      )} />

      <div className="flex items-center gap-3 mb-5 relative z-10">
        <div className={cn(
          "p-1.5 rounded bg-opacity-20",
          isAnomaly ? "bg-destructive/20" : "bg-primary/10"
        )}>
          <Zap className={cn("w-4 h-4", isAnomaly ? "text-destructive" : "text-primary")} />
        </div>
        <div className={cn(
          "px-2 py-0.5 text-xs font-bold tracking-widest uppercase",
          isAnomaly ? "bg-destructive/20 text-destructive" : "bg-primary/20 text-primary"
        )}>
          {isAnomaly ? "ALERT STATE" : "C(t) SCORE"}
        </div>
        <span className={cn(
          "text-sm tracking-widest uppercase",
          isAnomaly ? "text-destructive/70" : "text-accent/70"
        )}>
          Block Coherence
        </span>
      </div>

      <motion.div
        key={data.features.f9}
        initial={{ opacity: 0.5, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className={cn(
          "text-6xl sm:text-7xl md:text-8xl lg:text-7xl xl:text-8xl font-bold tracking-tighter tabular-nums leading-none relative z-10",
          isAnomaly ? "text-destructive text-glow-destructive" : "text-primary text-glow"
        )}
      >
        {formatNumber(data.features.f9, 6)}
      </motion.div>

      <div className="mt-8 grid grid-cols-2 gap-6 border-t border-primary/10 pt-6 relative z-10">
        <div className="bg-black/30 rounded-xl border border-primary/10 p-4">
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2">
            Dynamic Baseline Θ(t)
          </div>
          <div className={cn(
            "text-xl sm:text-2xl font-bold",
            !data.window_ready ? "text-warning" : "text-primary"
          )}>
            {data.window_ready ? formatNumber(data.theta, 6) : "CALCULATING"}
          </div>
        </div>

        <div className="bg-black/30 rounded-xl border border-primary/10 p-4">
          <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2">
            Tx Density (f1)
          </div>
          <div className="text-xl sm:text-2xl font-bold text-primary">
            {data.features.f1}
          </div>
        </div>
      </div>

      {isAnomaly && (
        <div className="mt-5 p-4 bg-destructive/15 border border-destructive/40 rounded-xl text-destructive font-bold uppercase tracking-widest text-sm flex justify-between items-center animate-pulse relative z-10">
          <span>Anomaly Drop:</span>
          <span className="text-xl">-{data.drop_pct.toFixed(2)}%</span>
        </div>
      )}
    </div>
  );
}
