require("@nomicfoundation/hardhat-toolbox");
const path = require("path");
const fs = require("fs");

// Load env files in priority order — contracts/.env.deploy first, then root .env.local fallback
const envCandidates = [
  path.resolve(__dirname, ".env.deploy"),
  path.resolve(__dirname, "../.env.local"),
  path.resolve(__dirname, "../.env"),
];
for (const candidate of envCandidates) {
  if (fs.existsSync(candidate)) {
    require("dotenv").config({ path: candidate, override: false });
  }
}

const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";

// Resolve deployer key — explicit DEPLOYER_PRIVATE_KEY takes priority (if valid),
// then V6 relayer key as fallback (same wallet used for V6 deployment).
function resolveDeployerKey() {
  const explicit = (process.env.DEPLOYER_PRIVATE_KEY || "").trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(explicit)) return explicit;

  const relayerFallback = (process.env.PINETREE_BASE_V6_RELAYER_PRIVATE_KEY || "").trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(relayerFallback)) return relayerFallback;

  return "";
}

const DEPLOYER_PRIVATE_KEY = resolveDeployerKey();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  paths: {
    sources: "./src"
  },
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    base: {
      url: BASE_RPC_URL,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: 8453
    }
  }
};
