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

const V7_ABI = [
  "function relayers(address) view returns (bool)",
  "function setRelayer(address relayer, bool allowed) external",
  "function owner() view returns (address)",
  "function pineTreeTreasury() view returns (address)"
];

async function main() {
  const contractAddress = (process.env.PINETREE_BASE_V7_CONTRACT || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
    console.error("ERROR: PINETREE_BASE_V7_CONTRACT is missing or invalid.");
    console.error("Set PINETREE_BASE_V7_CONTRACT=0x... in contracts/.env.deploy or .env.local");
    process.exit(1);
  }

  const relayerAddress = (
    process.env.PINETREE_BASE_V7_RELAYER_ADDRESS ||
    process.env.PINETREE_BASE_V6_RELAYER_ADDRESS ||
    ""
  ).trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(relayerAddress)) {
    console.error("ERROR: PINETREE_BASE_V7_RELAYER_ADDRESS is missing or invalid.");
    process.exit(1);
  }

  const chainId = hre.network.config.chainId;
  if (chainId !== 8453) {
    console.error(`ERROR: Expected chainId 8453 (Base mainnet), got ${chainId}.`);
    process.exit(1);
  }

  const [signer] = await hre.ethers.getSigners();
  const contract = new hre.ethers.Contract(contractAddress, V7_ABI, signer);

  const contractOwner = await contract.owner();
  const signerAddress = signer.address;

  console.log("=== PineTree V7 Relayer Allowlist ===");
  console.log("V7 Contract:", contractAddress);
  console.log("Contract owner:", contractOwner);
  console.log("Signer:", signerAddress);
  console.log("Target relayer:", relayerAddress);

  if (contractOwner.toLowerCase() !== signerAddress.toLowerCase()) {
    console.error(`ERROR: Signer ${signerAddress} is not the contract owner (${contractOwner}).`);
    console.error("Use the owner private key to run this script.");
    process.exit(1);
  }

  // Check current state
  const alreadyAllowed = await contract.relayers(relayerAddress);
  console.log("\nCurrent relayers(relayerAddress):", alreadyAllowed);

  if (alreadyAllowed) {
    console.log("Relayer is already allowlisted. No transaction needed.");
    console.log("RELAYER_ALLOWLIST_STATUS: already_set");
    return;
  }

  console.log("\nSubmitting setRelayer transaction...");
  const tx = await contract.setRelayer(relayerAddress, true);
  console.log("Transaction submitted:", tx.hash);

  const receipt = await tx.wait(1);
  console.log("Transaction confirmed in block:", receipt.blockNumber);

  // Verify
  const isAllowedNow = await contract.relayers(relayerAddress);
  console.log("\n=== Post-Allowlist Verification ===");
  console.log("relayers(" + relayerAddress + "):", isAllowedNow);
  console.log("Allowlist tx hash:", tx.hash);

  if (!isAllowedNow) {
    console.error("ERROR: relayers() still returns false after allowlist tx. Investigate.");
    process.exit(1);
  }

  console.log("\nRelayer successfully allowlisted.");
  console.log("RELAYER_ADDRESS:", relayerAddress);
  console.log("ALLOWLIST_TX_HASH:", tx.hash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
