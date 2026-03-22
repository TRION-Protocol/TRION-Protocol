import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";

const RELAYER_PRIVATE_KEY =
  process.env["RELAYER_PRIVATE_KEY"] ??
  "0x93fd4461112f6e7a0cb14f6a71d8953f1351d76c71ee4026710ecb5399469a9d";

const SEPOLIA_RPC =
  process.env["ARBITRUM_SEPOLIA_RPC"] ??
  process.env["ARBITRUM_SEPOLIA_RPC_URL"] ??
  "https://arbitrum-sepolia-rpc.publicnode.com";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    artifacts: "./hardhat-artifacts",
    cache: "./hardhat-cache",
  },
  networks: {
    arbitrumSepolia: {
      url: SEPOLIA_RPC,
      accounts: [RELAYER_PRIVATE_KEY],
    },
  },
};

export default config;
