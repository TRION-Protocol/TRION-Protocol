import { useQuery } from "@tanstack/react-query";

const BASE = import.meta.env.VITE_API_URL ?? "";

export interface OracleData {
  version:       string;
  oracleAddress: string | null;
  blockNumber:   number;
  txId:          string;
  signalType:    number;
  signalName:    string;
  coherenceScore:   number;
  dynamicBaseline:  number;
  isNetworkStable:  boolean;
  alert:         boolean;
  packedSignal:  string;
  signature:     string;
  contractAddress:  string;
  updatedAt:     number;
}

async function fetchOracleData(): Promise<OracleData> {
  const res = await fetch(`${BASE}/api/trion/v2oracle`);
  if (!res.ok) throw new Error(`V2 oracle API ${res.status}`);
  const d = await res.json();
  return {
    version:          d.version ?? "v2",
    oracleAddress:    d.oracleAddress ?? null,
    blockNumber:      d.blockNumber ?? 0,
    txId:             d.txId ?? "0x",
    signalType:       d.signalType ?? 0,
    signalName:       d.signalName ?? "SAFE",
    coherenceScore:   d.coherence ?? 0,
    dynamicBaseline:  d.threshold ?? 0,
    isNetworkStable:  d.isStable ?? true,
    alert:            d.alert ?? false,
    packedSignal:     d.packedSignal ?? "0x0",
    signature:        d.signature ?? "0x",
    contractAddress:  d.oracleAddress ?? "",
    updatedAt:        d.updatedAt ?? 0,
  };
}

export function useOracleData() {
  return useQuery<OracleData, Error>({
    queryKey: ["oracle-data-v2"],
    queryFn: fetchOracleData,
    refetchInterval: 15_000,
    retry: 3,
    staleTime: 10_000,
  });
}
