import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface FeatureCardProps {
  id: string;
  label: string;
  value: string | number;
  isAnomaly?: boolean;
}

export function FeatureCard({ id, label, value, isAnomaly }: FeatureCardProps) {
  return (
    <motion.div
      key={value}
      initial={{ backgroundColor: "rgba(0,255,136,0.08)" }}
      animate={{ backgroundColor: "rgba(0,0,0,0)" }}
      transition={{ duration: 0.6 }}
      className={cn(
        "rounded-2xl border bg-gradient-to-br from-slate-900/80 to-black p-4 flex flex-col justify-between group hover:border-primary/40 transition-all duration-300 shadow-lg",
        isAnomaly
          ? "border-destructive/30 hover:border-destructive/50"
          : "border-primary/15 hover:shadow-[0_0_20px_rgba(0,255,136,0.06)]"
      )}
    >
      <div className="flex justify-between items-start mb-4">
        <span className={cn(
          "px-1.5 py-0.5 text-[10px] font-bold tracking-widest rounded",
          isAnomaly ? "bg-destructive/15 text-destructive" : "bg-primary/15 text-primary"
        )}>
          {id}
        </span>
      </div>

      <div>
        <div className="text-[11px] text-accent/70 uppercase tracking-widest mb-1 h-8 group-hover:text-accent/90 transition-colors">
          {label}
        </div>
        <div className={cn(
          "text-xl sm:text-2xl font-bold tracking-tight truncate",
          isAnomaly ? "text-destructive text-glow-destructive" : "text-primary"
        )}>
          {value}
        </div>
      </div>
    </motion.div>
  );
}
