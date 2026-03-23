import { useTrionData } from "@/hooks/use-trion";
import { useOracleData } from "@/hooks/use-oracle";
import { Header } from "@/components/Header";
import { StatusBanner } from "@/components/StatusBanner";
import { FeatureCard } from "@/components/FeatureCard";
import { CoherenceDisplay } from "@/components/CoherenceDisplay";
import { OracleCard } from "@/components/OracleCard";
import { FirewallPanel } from "@/components/FirewallPanel";
import { TRIONAttackSimulator } from "@/components/TRIONAttackSimulator";
import { formatNumber, formatInteger } from "@/lib/utils";
import { Terminal, Activity } from "lucide-react";

export function Dashboard() {
  const { data, isLoading, isError, error } = useTrionData();
  const { data: oracleData, isLoading: oracleLoading, isError: oracleError } = useOracleData();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-primary flex flex-col items-center justify-center crt-flicker">
        <Activity className="w-16 h-16 mb-8 animate-pulse text-primary opacity-50" />
        <h1 className="text-2xl font-bold tracking-[0.3em] text-glow">INITIALIZING UPLINK...</h1>
        <p className="text-muted-foreground mt-4 tracking-widest uppercase text-sm">Searching for local Rust daemon</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
        <div className="hud-border-destructive bg-destructive/10 p-8 md:p-12 max-w-2xl w-full text-center">
          <Terminal className="w-16 h-16 mx-auto mb-6 text-destructive opacity-80" />
          <h2 className="text-2xl md:text-3xl font-bold text-destructive tracking-widest mb-4 text-glow-destructive uppercase">
            Connection Lost
          </h2>
          <p className="text-red-400/80 mb-8 leading-relaxed font-medium">
            The TRION L0 indexer daemon is currently offline or unreachable.
            <br/><br/>
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
          <div className="bg-black/50 border border-destructive/30 p-4 text-left font-mono text-sm text-destructive/90 overflow-x-auto">
            $ cd trion-l0<br/>
            $ cargo run<br/>
            <span className="opacity-50"># Waiting for local node to resume telemetry...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col relative pb-20">
      <div className="scanline" />
      
      <Header blockNumber={data.block_number} timestamp={data.updated_at} />
      <StatusBanner data={data} />

      <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 md:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 z-10">
        
        {/* Left Column: Coherence Display + Oracle Card */}
        <section className="lg:col-span-5 xl:col-span-4 flex flex-col gap-6 min-h-[400px]">
          <CoherenceDisplay data={data} />
          <OracleCard data={oracleData} isLoading={oracleLoading} isError={oracleError} />
        </section>

        {/* Right Column: 3x3 Feature Grid */}
        <section className="lg:col-span-7 xl:col-span-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
          <FeatureCard 
            id="f1" 
            label="Transaction Density" 
            value={formatInteger(data.features.f1)} 
            isAnomaly={data.alert}
          />
          <FeatureCard 
            id="f2" 
            label="Base Fee Volatility (Wei)" 
            value={formatInteger(data.features.f2)} 
          />
          <FeatureCard 
            id="f3" 
            label="Net Value Flow (ETH)" 
            value={formatNumber(data.features.f3, 6)} 
          />
          <FeatureCard 
            id="f4" 
            label="Entity Concentration" 
            value={formatNumber(data.features.f4, 6)} 
            isAnomaly={data.alert}
          />
          <FeatureCard 
            id="f5" 
            label="Counterparty Diversity" 
            value={formatNumber(data.features.f5, 6)} 
          />
          <FeatureCard 
            id="f6" 
            label="Contract Interaction Rate" 
            value={formatNumber(data.features.f6, 6)} 
          />
          <FeatureCard 
            id="f7" 
            label="Gas Limit Skew (Top 10%)" 
            value={formatNumber(data.features.f7, 6)} 
          />
          <FeatureCard 
            id="f8" 
            label="Zero-Value Entropy" 
            value={formatNumber(data.features.f8, 6)} 
            isAnomaly={data.alert}
          />
          
          {/* 9th Slot: System Info */}
          <div className="hud-border bg-card/50 p-4 flex flex-col justify-center items-center text-center">
            <Activity className="w-8 h-8 text-accent opacity-50 mb-3" />
            <div className="text-xs text-accent uppercase tracking-widest mb-1">
              Engine Status
            </div>
            <div className="text-sm font-bold text-primary tracking-widest animate-pulse">
              EXTRACTING Φ PLANE
            </div>
          </div>
        </section>

        {/* Full-width bottom row: L2 Execution Firewall */}
        <section className="lg:col-span-12">
          <FirewallPanel liveCt={data.features.f9} liveTheta={data.theta} />
        </section>

        {/* Full-width: Live On-Chain Attack Simulator */}
        <section className="lg:col-span-12">
          <TRIONAttackSimulator />
        </section>

      </main>
    </div>
  );
}
