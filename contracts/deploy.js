const { ethers } = require("ethers")
const solc = require("solc")
const fs = require("fs")
const path = require("path")
require("dotenv").config({ path: ".env.deploy" })

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY
const RPC_URL = process.env.BASE_RPC_URL

if (!PRIVATE_KEY) { console.error("Missing DEPLOYER_PRIVATE_KEY in .env.deploy"); process.exit(1) }
if (!RPC_URL)     { console.error("Missing BASE_RPC_URL in .env.deploy"); process.exit(1) }

async function main() {
  const source = fs.readFileSync(path.join(__dirname, "src", "PineTreeSplit.sol"), "utf8")

  console.log("Compiling PineTreeSplit.sol...")

  const input = {
    language: "Solidity",
    sources: { "PineTreeSplit.sol": { content: source } },
    settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } } }
  }

  const output = JSON.parse(solc.compile(JSON.stringify(input)))

  if (output.errors) {
    const errors = output.errors.filter(e => e.severity === "error")
    if (errors.length) {
      console.error("Compilation errors:", errors.map(e => e.message).join("\n"))
      process.exit(1)
    }
  }

  const contract = output.contracts["PineTreeSplit.sol"]["PineTreeSplit"]
  const abi = contract.abi
  const bytecode = "0x" + contract.evm.bytecode.object

  console.log("Compiled successfully.")

  const provider = new ethers.JsonRpcProvider(RPC_URL)
  const wallet = new ethers.Wallet(PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : "0x" + PRIVATE_KEY, provider)

  console.log("Deployer:", wallet.address)

  const balance = await provider.getBalance(wallet.address)
  console.log("Balance:", ethers.formatEther(balance), "ETH")

  if (balance === 0n) {
    console.error("No ETH balance — add ETH to your wallet on Base first")
    process.exit(1)
  }

  console.log("Deploying to Base mainnet...")

  const factory = new ethers.ContractFactory(abi, bytecode, wallet)
  const deployed = await factory.deploy()
  console.log("Transaction sent:", deployed.deploymentTransaction().hash)
  console.log("Waiting for confirmation...")

  await deployed.waitForDeployment()
  const address = await deployed.getAddress()

  console.log("\n✅ PineTreeSplit deployed to:", address)
  console.log("\nAdd to Vercel:")
  console.log("  PINETREE_EVM_SPLIT_CONTRACT_BASE=" + address)
  console.log("  PINETREE_EVM_SPLIT_MODE=contract")
  console.log("\nBasescan:", "https://basescan.org/address/" + address)
}

main().catch(err => { console.error(err); process.exit(1) })
