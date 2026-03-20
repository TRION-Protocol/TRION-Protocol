import { useQuery } from "@tanstack/react-query";

export interface TrionData {
  block_number: number;
  timestamp: number;
  tx_count: number;
  features: {
    f1: number; // Transaction Density
    f2: number; // Base Fee Volatility (Wei)
    f3: number; // Net Value Flow (ETH)
    f4: number; // Entity Concentration
    f5: number; // Counterparty Diversity
    f6: number; // Contract Interaction Rate
    f7: number; // Gas Limit Skew
    f8: number; // Zero-Value Entropy
    f9: number; // Block Coherence Score C(t)
  };
  theta: number;
  window_ready: boolean;
  alert: boolean;
  drop_pct: number;
  alert_status: "WARMING_UP" | "SAFE" | "ANOMALY";
  updated_at: number;
}

export function useTrionData() {
  return useQuery<TrionData, Error>({
    queryKey: ["trion-latest"],
    queryFn: async () => {
      const base = import.meta.env.VITE_API_URL ?? "";
      const res = await fetch(`${base}/api/trion/latest`);
      if (!res.ok) {
        if (res.status === 503 || res.status === 404) {
          throw new Error("Daemon offline");
        }
        throw new Error("Failed to fetch TRION data");
      }
      return res.json();
    },
    // Poll every 1 second
    refetchInterval: 1000,
    retry: 2,
  });
}
