const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying PineTreeBaseSplitV5...");
  console.log("Deployer:        ", deployer.address);
  console.log("Network:         ", hre.network.name);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", hre.ethers.formatEther(balance), "ETH");

  const PINETREE_TREASURY = process.env.PINETREE_TREASURY_WALLET_BASE;
  if (!PINETREE_TREASURY || !/^0x[a-fA-F0-9]{40}$/.test(PINETREE_TREASURY)) {
    throw new Error(
      "PINETREE_TREASURY_WALLET_BASE must be set to a valid 0x EVM address in .env.deploy"
    );
  }
  console.log("Treasury:        ", PINETREE_TREASURY);

  const Factory = await hre.ethers.getContractFactory("PineTreeBaseSplitV5");
  const contract = await Factory.deploy(PINETREE_TREASURY);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("\nPineTreeBaseSplitV5 deployed to:", address);
  console.log("\nNext steps:");
  console.log("  1. Add the relayer:  contract.setRelayer(PINETREE_BASE_USDC_RELAYER_ADDRESS, true)");
  console.log("  2. Add to Vercel:");
  console.log(`     PINETREE_BASE_SPLIT_V5_CONTRACT=${address}`);
  console.log("  3. After smoke testing:");
  console.log("     PINETREE_BASE_SPLIT_VERSION=v5");
  console.log("\nBase explorer:", `https://basescan.org/address/${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
