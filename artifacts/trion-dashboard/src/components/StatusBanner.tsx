import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrionData } from "@/hooks/use-trion";

interface StatusBannerProps {
  data?: TrionData;
}

export function StatusBanner({ data }: StatusBannerProps) {
  if (!data) return null;

  const status = data.alert_status;

  if (status === "WARMING_UP") {
    return (
      <div className="w-full bg-warning/10 border-y border-warning/50 p-3 flex items-center justify-center gap-3 text-warning">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="tracking-widest uppercase font-bold text-sm">
          SEMANTIC WINDOW WARMING UP (AWAITING 10 BLOCKS)
        </span>
      </div>
    );
  }

  if (status === "ANOMALY") {
    return (
      <motion.div
        initial={{ opacity: 0.8 }}
        animate={{ opacity: [0.8, 1, 0.8], backgroundColor: ["rgba(255,51,51,0.2)", "rgba(255,51,51,0.4)", "rgba(255,51,51,0.2)"] }}
        transition={{ duration: 0.5, repeat: Infinity }}
        className="w-full border-y-2 border-destructive p-4 flex flex-col sm:flex-row items-center justify-center gap-4 text-destructive"
      >
        <AlertTriangle className="w-6 h-6 sm:w-8 sm:h-8" />
        <div className="text-center sm:text-left">
          <h2 className="tracking-widest uppercase font-bold text-lg sm:text-xl text-glow-destructive">
            CRITICAL ANOMALY DETECTED: THERMODYNAMIC COLLAPSE
          </h2>
          <p className="text-sm font-medium mt-1">
            C(t) DROP = {data.drop_pct.toFixed(1)}% | EMITTING SILENCE PRIMITIVE
          </p>
        </div>
        <AlertTriangle className="w-6 h-6 sm:w-8 sm:h-8 hidden sm:block" />
      </motion.div>
    );
  }

  return (
    <div className="w-full bg-primary/5 border-y border-primary/30 p-3 flex items-center justify-center gap-3 text-primary">
      <CheckCircle2 className="w-5 h-5" />
      <span className="tracking-widest uppercase font-bold text-sm text-glow">
        NETWORK STABLE • ANOMALY HUNTER ACTIVE
      </span>
    </div>
  );
}
