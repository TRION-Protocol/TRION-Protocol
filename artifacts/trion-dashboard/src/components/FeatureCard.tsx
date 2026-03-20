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
      key={value} // Re-animate when value changes
      initial={{ backgroundColor: "rgba(0,255,136,0.1)" }}
      animate={{ backgroundColor: "rgba(0,0,0,0)" }}
      transition={{ duration: 0.5 }}
      className={cn(
        "hud-border bg-card p-4 flex flex-col justify-between group hover:bg-primary/5 transition-colors duration-300",
        isAnomaly && "hud-border-destructive"
      )}
    >
      <div className="flex justify-between items-start mb-4">
        <span className={cn(
          "px-1.5 py-0.5 text-[10px] font-bold tracking-widest",
          isAnomaly ? "bg-destructive/20 text-destructive" : "bg-primary/20 text-primary"
        )}>
          {id}
        </span>
      </div>
      
      <div>
        <div className="text-[11px] text-accent uppercase tracking-widest mb-1 h-8 opacity-80 group-hover:opacity-100 transition-opacity">
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
