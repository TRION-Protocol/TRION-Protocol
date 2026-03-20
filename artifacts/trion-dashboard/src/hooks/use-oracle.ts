import { useQuery } from "@tanstack/react-query";
import { ethers } from "ethers";

const RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc";
const ORACLE_ADDRESS = "0x708193f93Fb897fbeA72e7e7D19237770F19E969";

const ORACLE_ABI = [
  "function latestBlockNumber() view returns (uint256)",
  "function currentCoherenceScore() view returns (uint256)",
  "function dynamicBaseline() view returns (uint256)",
  "function isNetworkStable() view returns (bool)",
  "function trionRelayer() view returns (address)",
];

export interface OracleData {
  latestBlockNumber: number;
  coherenceScore: number;
  dynamicBaseline: number;
  isNetworkStable: boolean;
  relayerAddress: string;
  contractAddress: string;
}

async function fetchOracleData(): Promise<OracleData> {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const oracle = new ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, provider);

  const [latestBlockNumber, currentCoherenceScore, dynamicBaseline, isNetworkStable, trionRelayer] =
    await Promise.all([
      oracle.latestBlockNumber() as Promise<bigint>,
      oracle.currentCoherenceScore() as Promise<bigint>,
      oracle.dynamicBaseline() as Promise<bigint>,
      oracle.isNetworkStable() as Promise<boolean>,
      oracle.trionRelayer() as Promise<string>,
    ]);

  return {
    latestBlockNumber: Number(latestBlockNumber),
    coherenceScore: Number(currentCoherenceScore) / 1_000_000,
    dynamicBaseline: Number(dynamicBaseline) / 1_000_000,
    isNetworkStable,
    relayerAddress: trionRelayer,
    contractAddress: ORACLE_ADDRESS,
  };
}

export function useOracleData() {
  return useQuery<OracleData, Error>({
    queryKey: ["oracle-data"],
    queryFn: fetchOracleData,
    refetchInterval: 15_000,
    retry: 3,
    staleTime: 10_000,
  });
}
