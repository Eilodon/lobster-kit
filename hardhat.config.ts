import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    opbnb: {
      url: process.env.OPBNB_RPC_URL || "https://opbnb-mainnet-rpc.bnbchain.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 204,
    },
    opbnbTestnet: {
      url: "https://opbnb-testnet-rpc.bnbchain.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 5611,
    },
    bsc: {
      url: "https://bsc-dataseed1.binance.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 56,
    },
  },
  etherscan: {
    apiKey: {
      opbnb: process.env.BSCSCAN_API_KEY || "",
      bsc: process.env.BSCSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "opbnb",
        chainId: 204,
        urls: {
          apiURL: "https://api-opbnb.bscscan.com/api",
          browserURL: "https://opbnb.bscscan.com"
        }
      }
    ]
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
};

export default config;
