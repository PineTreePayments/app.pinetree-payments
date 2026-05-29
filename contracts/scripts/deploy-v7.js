const hre = require("hardhat");
const path = require("path");
const fs = require("fs");

// Load env — try contracts/.env.deploy first, fall back to root .env.local
function loadEnv() {
  const candidates = [
    path.resolve(__dirname, "../.env.deploy"),
    path.resolve(__dirname, "../../.env.local"),
    path.resolve(__dirname, "../../.env"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      require("dotenv").config({ path: candidate, override: false });
    }
  }
}
loadEnv();

// Resolve deployer key — DEPLOYER_PRIVATE_KEY takes priority, then V6 relayer key as fallback
function resolveDeployerKey() {
  const explicit = (process.env.DEPLOYER_PRIVATE_KEY || "").trim();
  if (explicit && explicit !== "DELETED_AFTER_DEPLOY" && /^0x[a-fA-F0-9]{64}$/.test(explicit)) {
    return { key: explicit, source: "DEPLOYER_PRIVATE_KEY" };
  }
  const relayerFallback = (process.env.PINETREE_BASE_V6_RELAYER_PRIVATE_KEY || "").trim();
  if (relayerFallback && /^0x[a-fA-F0-9]{64}$/.test(relayerFallback)) {
    return { key: relayerFallback, source: "PINETREE_BASE_V6_RELAYER_PRIVATE_KEY (fallback)" };
  }
  return null;
}

async function main() {
  const keyResult = resolveDeployerKey();
  if (!keyResult) {
    console.error("ERROR: No valid deployer private key found.");
    console.error("Add DEPLOYER_PRIVATE_KEY=0x... to contracts/.env.deploy");
    process.exit(1);
  }

  const treasury = (
    process.env.PINETREE_TREASURY_WALLET_BASE ||
    process.env.PINETREE_TREASURY_WALLET ||
    ""
  ).trim();

  if (!/^0x[a-fA-F0-9]{40}$/.test(treasury)) {
    console.error("ERROR: Missing or invalid PINETREE_TREASURY_WALLET_BASE in env.");
    process.exit(1);
  }

  const network = hre.network.name;
  const chainId = hre.network.config.chainId;

  if (chainId !== 8453) {
    console.error(`ERROR: Expected chainId 8453 (Base mainnet), got ${chainId}.`);
    console.error("Run with --network base");
    process.exit(1);
  }

  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  const balanceEth = hre.ethers.formatEther(balance);

  console.log("=== PineTree Base Pay V7 Deployment ===");
  console.log("Network:", network);
  console.log("Chain ID:", chainId);
  console.log("Deployer:", deployer.address);
  console.log("Key source:", keyResult.source);
  console.log("Deployer ETH balance:", balanceEth);
  console.log("Treasury:", treasury);

  if (parseFloat(balanceEth) < 0.0001) {
    console.error("ERROR: Deployer balance too low. Fund the deployer with at least 0.001 ETH on Base.");
    process.exit(1);
  }

  console.log("\nDeploying PineTreeSplitV7...");

  const Contract = await hre.ethers.getContractFactory("PineTreeSplitV7");
  const contract = await Contract.deploy(treasury);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const deployTx = contract.deploymentTransaction();
  const txHash = deployTx ? deployTx.hash : "unknown";

  console.log("\n=== Deployment Result ===");
  console.log("PineTreeSplitV7 deployed to:", address);
  console.log("Transaction hash:", txHash);
  console.log("Chain ID:", chainId);
  console.log("Deployer:", deployer.address);
  console.log("Treasury (constructor arg):", treasury);

  // Verify on-chain
  const deployedTreasury = await contract.pineTreeTreasury();
  const deployerIsRelayer = await contract.relayers(deployer.address);
  console.log("\n=== Post-Deploy Verification ===");
  console.log("pineTreeTreasury():", deployedTreasury);
  console.log("Treasury matches config:", deployedTreasury.toLowerCase() === treasury.toLowerCase());
  console.log("relayers(deployer):", deployerIsRelayer);

  console.log("\n=== Vercel Environment Variables ===");
  console.log(`PINETREE_BASE_V7_CONTRACT=${address}`);
  console.log(`PINETREE_BASE_V7_RELAYER_ADDRESS=${deployer.address}`);
  console.log("PINETREE_BASE_V7_RELAYER_PRIVATE_KEY=<use same key as deployer — do not commit>");
  console.log("PINETREE_BASE_V7_MAX_GAS_USD=1");
  console.log("PINETREE_BASE_V7_AUTH_VALIDITY_SECONDS=600");
  console.log("PINETREE_BASE_V7_EIP3009_ENABLED=true");
  console.log("PINETREE_BASE_V7_DELEGATED_ENABLED=false");
  console.log(`PINETREE_BASE_V7_USDC_TOKEN=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`);
  console.log(`PINETREE_TREASURY_WALLET_BASE=${treasury}`);
  console.log(`BASE_RPC_URL=${process.env.BASE_RPC_URL || "https://mainnet.base.org"}`);

  console.log("\n=== Base Explorer ===");
  console.log(`https://basescan.org/address/${address}`);
  console.log(`https://basescan.org/tx/${txHash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
