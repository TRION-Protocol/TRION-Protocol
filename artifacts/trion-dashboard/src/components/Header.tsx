import { motion } from "framer-motion";

interface HeaderProps {
  blockNumber?: number;
  timestamp?: number;
  isSafe?: boolean;
}

export function Header({ blockNumber, timestamp, isSafe = true }: HeaderProps) {
  return (
    <header className="w-full flex flex-col sm:flex-row justify-between items-start sm:items-center px-4 sm:px-6 py-4 border-b border-primary/20 bg-black/60 backdrop-blur-md sticky top-0 z-40 gap-4">
      <div className="flex items-center gap-4">
        <div className="relative flex items-center justify-center w-4 h-4">
          <motion.div
            className="absolute w-full h-full bg-primary rounded-full"
            animate={{ scale: [1, 1.5, 1], opacity: [0.7, 0, 0.7] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
          <div className="w-2 h-2 bg-primary rounded-full z-10" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-widest text-glow">
            TRION <span className="text-emerald-400">V3.0</span>
          </h1>
          <p className="text-xs text-accent tracking-[0.2em] uppercase mt-0.5">
            Behavioral Truth Oracle · Arbitrum L2
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {/* Live block info */}
        <div className="hidden md:flex gap-6 text-sm">
          <div className="flex flex-col items-end">
            <span className="text-muted-foreground text-[10px] tracking-widest uppercase">Live Block</span>
            <span className="font-bold text-primary">
              {blockNumber ? `#${blockNumber.toLocaleString()}` : "AWAITING..."}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-muted-foreground text-[10px] tracking-widest uppercase">Sync Time (Unix)</span>
            <span className="font-bold text-primary">
              {timestamp ? timestamp : "---"}
            </span>
          </div>
        </div>

        {/* V3 status pill */}
        <div className={`flex items-center gap-2.5 px-4 py-2 rounded-full border shadow-inner ${isSafe ? "bg-black/60 border-primary/30" : "bg-black/60 border-destructive/40"}`}>
          <motion.div
            className={`w-2.5 h-2.5 rounded-full ${isSafe ? "bg-emerald-500" : "bg-destructive"}`}
            animate={{ opacity: [1, 0.4, 1] }}
            transition={{ duration: isSafe ? 2 : 0.5, repeat: Infinity }}
            style={isSafe
              ? { boxShadow: "0 0 10px rgba(16,185,129,0.6)" }
              : { boxShadow: "0 0 10px rgba(255,51,51,0.6)" }
            }
          />
          <span className={`text-xs font-bold tracking-wider uppercase ${isSafe ? "text-emerald-400" : "text-destructive"}`}>
            {isSafe ? "NETWORK STABLE" : "THERMODYNAMIC COLLAPSE"}
          </span>
        </div>
      </div>
    </header>
  );
}
