import { motion } from "framer-motion";
import { cn, formatNumber } from "@/lib/utils";
import type { TrionData } from "@/hooks/use-trion";

export function CoherenceDisplay({ data }: { data: TrionData }) {
  const isAnomaly = data.alert;

  return (
    <div className={cn(
      "w-full h-full flex flex-col justify-center p-8 lg:p-12",
      isAnomaly ? "hud-border-destructive bg-destructive/5" : "hud-border bg-card"
    )}>
      <div className="flex items-center gap-3 mb-6">
        <div className={cn(
          "px-2 py-1 text-xs font-bold tracking-widest uppercase",
          isAnomaly ? "bg-destructive text-black" : "bg-primary text-black"
        )}>
          {isAnomaly ? "ALERT STATE" : "C(t) SCORE"}
        </div>
        <span className={cn(
          "text-sm tracking-widest uppercase",
          isAnomaly ? "text-destructive" : "text-accent"
        )}>
          Block Coherence
        </span>
      </div>

      <motion.div
        key={data.features.f9}
        initial={{ opacity: 0.5, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className={cn(
          "text-7xl sm:text-8xl md:text-9xl font-bold tracking-tighter tabular-nums leading-none",
          isAnomaly ? "text-destructive text-glow-destructive" : "text-primary text-glow"
        )}
      >
        {formatNumber(data.features.f9, 6)}
      </motion.div>

      <div className="mt-12 grid grid-cols-2 gap-8 border-t border-primary/20 pt-8">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-widest mb-2">
            Dynamic Baseline Θ(t)
          </div>
          <div className={cn(
            "text-2xl sm:text-3xl font-bold",
            !data.window_ready ? "text-warning" : "text-primary"
          )}>
            {data.window_ready ? formatNumber(data.theta, 6) : "CALCULATING"}
          </div>
        </div>
        
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-widest mb-2">
            Tx Density (f1)
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-primary">
            {data.features.f1}
          </div>
        </div>
      </div>
      
      {isAnomaly && (
        <div className="mt-8 p-4 bg-destructive/20 border border-destructive text-destructive font-bold uppercase tracking-widest text-sm flex justify-between items-center animate-pulse">
          <span>Anomaly Drop:</span>
          <span className="text-xl">-{data.drop_pct.toFixed(2)}%</span>
        </div>
      )}
    </div>
  );
}
