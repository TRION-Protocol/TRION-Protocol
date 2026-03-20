import { motion, AnimatePresence } from "framer-motion";
import { Link2, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { cn, formatNumber } from "@/lib/utils";
import type { OracleData } from "@/hooks/use-oracle";

interface OracleCardProps {
  data: OracleData | undefined;
  isLoading: boolean;
  isError: boolean;
}

function AddressChip({ address }: { address: string }) {
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  return (
    <a
      href={`https://sepolia.arbiscan.io/address/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs text-accent hover:text-primary transition-colors underline underline-offset-2 tracking-wide"
      title={address}
    >
      {short}
    </a>
  );
}

export function OracleCard({ data, isLoading, isError }: OracleCardProps) {
  return (
    <div className="hud-border bg-card/60 p-6 flex flex-col gap-5 relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="bg-accent/20 p-1.5 rounded">
          <Link2 className="w-4 h-4 text-accent" />
        </div>
        <div>
          <div className="text-xs text-accent uppercase tracking-widest font-bold">
            On-Chain Oracle
          </div>
          <div className="text-[10px] text-muted-foreground tracking-wide">
            Arbitrum Sepolia · Live Contract Data
          </div>
        </div>
        <div className="ml-auto">
          {isLoading && (
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
          )}
          {isError && (
            <XCircle className="w-4 h-4 text-destructive" />
          )}
          {data && !isLoading && (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
              <span className="text-[10px] text-accent uppercase tracking-widest">Live</span>
            </div>
          )}
        </div>
      </div>

      {/* Loading state */}
      {isLoading && !data && (
        <div className="flex flex-col items-center justify-center py-6 gap-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin opacity-40" />
          <span className="text-xs uppercase tracking-widest">Querying Sepolia RPC...</span>
        </div>
      )}

      {/* Error state */}
      {isError && !data && (
        <div className="flex flex-col items-center justify-center py-4 gap-2 text-destructive/70">
          <XCircle className="w-8 h-8 opacity-60" />
          <span className="text-xs uppercase tracking-widest">RPC Unreachable</span>
        </div>
      )}

      {/* Data */}
      <AnimatePresence mode="wait">
        {data && (
          <motion.div
            key={data.latestBlockNumber}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-2 gap-4"
          >
            {/* C(t) Score */}
            <div className="col-span-2 border border-primary/20 bg-black/30 p-4 text-center">
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">
                C(t) Coherence Score
              </div>
              <div className={cn(
                "text-4xl font-bold tabular-nums tracking-tighter",
                data.isNetworkStable ? "text-primary text-glow" : "text-destructive text-glow-destructive"
              )}>
                {formatNumber(data.coherenceScore, 6)}
              </div>
            </div>

            {/* μ(t) Baseline */}
            <div className="border border-primary/10 bg-black/20 p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">
                μ(t) Baseline
              </div>
              <div className="text-xl font-bold tabular-nums text-primary">
                {formatNumber(data.dynamicBaseline, 6)}
              </div>
            </div>

            {/* Network State */}
            <div className="border border-primary/10 bg-black/20 p-3 flex flex-col justify-between">
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">
                Network State
              </div>
              <div className={cn(
                "flex items-center gap-1.5 font-bold text-sm uppercase tracking-widest",
                data.isNetworkStable ? "text-accent" : "text-destructive"
              )}>
                {data.isNetworkStable
                  ? <><CheckCircle2 className="w-4 h-4" /> Stable</>
                  : <><XCircle className="w-4 h-4" /> Anomaly</>
                }
              </div>
            </div>

            {/* Block Number */}
            <div className="border border-primary/10 bg-black/20 p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">
                Last Relayed Block
              </div>
              <div className="text-sm font-mono font-bold text-primary truncate">
                #{data.latestBlockNumber.toLocaleString()}
              </div>
            </div>

            {/* Contract Address */}
            <div className="border border-primary/10 bg-black/20 p-3">
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">
                Contract
              </div>
              <AddressChip address={data.contractAddress} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
