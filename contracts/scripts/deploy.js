const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying PineTreeSplit...");
  console.log("Deployer:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "ETH");

  const Contract = await hre.ethers.getContractFactory("PineTreeSplit");
  const contract = await Contract.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("\nPineTreeSplit deployed to:", address);
  console.log("\nAdd this to your Vercel environment variables:");
  console.log(`PINETREE_EVM_SPLIT_CONTRACT_BASE=${address}`);
  console.log(`PINETREE_EVM_SPLIT_MODE=contract`);
  console.log("\nBase explorer:", `https://basescan.org/address/${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
