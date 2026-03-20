import { motion } from "framer-motion";

interface HeaderProps {
  blockNumber?: number;
  timestamp?: number;
}

export function Header({ blockNumber, timestamp }: HeaderProps) {
  return (
    <header className="w-full flex flex-col md:flex-row justify-between items-start md:items-center p-4 border-b border-primary/30 bg-black/50 backdrop-blur-md sticky top-0 z-40">
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
          <h1 className="text-xl font-bold tracking-widest text-glow">TRION PROTOCOL</h1>
          <p className="text-xs text-accent tracking-[0.2em] uppercase mt-1">
            Arbitrum One Mainnet • L0/L1 Uplink
          </p>
        </div>
      </div>

      <div className="mt-4 md:mt-0 flex gap-6 text-sm">
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
    </header>
  );
}
