/**
 * PineTree Split Contract Deployment Script
 *
 * Compiles PineTreeSplit.sol from source and deploys to Base + Ethereum mainnet.
 *
 * Prerequisites:
 *   npm install --save-dev ethers solc
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x<your_private_key> node scripts/deploy-split-contract.mjs
 *
 * After running, copy the printed addresses into your Vercel env vars AND .env.local:
 *   PINETREE_EVM_SPLIT_MODE=contract
 *   PINETREE_EVM_SPLIT_CONTRACT_BASE=0x...
 *   PINETREE_EVM_SPLIT_CONTRACT_ETHEREUM=0x...
 *
 * Security note: use a fresh deployer wallet and transfer ownership after deploying
 * via the transferOwnership() function if needed.
 */

import { ethers } from "ethers"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import solc from "solc"

const __dirname = dirname(fileURLToPath(import.meta.url))
const sourceCode = readFileSync(join(__dirname, "../contracts/PineTreeSplit.sol"), "utf8")

function compileSolidity() {
  const input = {
    language: "Solidity",
    sources: {
      "PineTreeSplit.sol": { content: sourceCode }
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object"] }
      }
    }
  }

  const output = JSON.parse(solc.compile(JSON.stringify(input)))

  if (output.errors) {
    const fatal = output.errors.filter(e => e.severity === "error")
    if (fatal.length > 0) {
      throw new Error(`Compilation errors:\n${fatal.map(e => e.formattedMessage).join("\n")}`)
    }
  }

  const contract = output.contracts["PineTreeSplit.sol"]["PineTreeSplit"]
  return {
    abi: contract.abi,
    bytecode: "0x" + contract.evm.bytecode.object
  }
}

async function deployToNetwork(abi, bytecode, rpcUrl, networkName) {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY env var is required")

  console.log(`\n🚀 Deploying PineTreeSplit to ${networkName}...`)

  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const wallet = new ethers.Wallet(privateKey, provider)
  const network = await provider.getNetwork()

  const balance = await provider.getBalance(wallet.address)
  console.log(`   Deployer: ${wallet.address}`)
  console.log(`   ChainId:  ${network.chainId}`)
  console.log(`   Balance:  ${ethers.formatEther(balance)} ETH`)

  if (balance === 0n) {
    throw new Error(`No ETH in deployer wallet on ${networkName}. Fund it before deploying.`)
  }

  const factory = new ethers.ContractFactory(abi, bytecode, wallet)
  console.log("   Broadcasting deployment transaction...")
  const contract = await factory.deploy()
  const receipt = await contract.waitForDeployment()

  const address = await contract.getAddress()
  const txHash = contract.deploymentTransaction()?.hash
  console.log(`   ✅ Contract address: ${address}`)
  console.log(`   📄 Tx hash:         ${txHash}`)
  return address
}

async function main() {
  console.log("PineTree Split Contract Deployment")
  console.log("=".repeat(50))

  console.log("\n📦 Compiling PineTreeSplit.sol...")
  let compiled
  try {
    compiled = compileSolidity()
    console.log("   ✅ Compilation successful")
  } catch (err) {
    console.error("❌ Compilation failed:", err.message)
    process.exit(1)
  }

  const results = {}

  try {
    results.base = await deployToNetwork(
      compiled.abi,
      compiled.bytecode,
      process.env.BASE_RPC_URL || "https://mainnet.base.org",
      "Base Mainnet"
    )
  } catch (err) {
    console.error(`\n❌ Base deployment failed: ${err.message}`)
  }

  try {
    results.ethereum = await deployToNetwork(
      compiled.abi,
      compiled.bytecode,
      process.env.ETH_RPC_URL || "https://cloudflare-eth.com",
      "Ethereum Mainnet"
    )
  } catch (err) {
    console.error(`\n❌ Ethereum deployment failed: ${err.message}`)
  }

  console.log("\n" + "=".repeat(50))
  console.log("📋 Add these to Vercel env vars AND .env.local:\n")
  console.log("PINETREE_EVM_SPLIT_MODE=contract")
  if (results.base)     console.log(`PINETREE_EVM_SPLIT_CONTRACT_BASE=${results.base}`)
  if (results.ethereum) console.log(`PINETREE_EVM_SPLIT_CONTRACT_ETHEREUM=${results.ethereum}`)
  console.log("\n✅ Done. Redeploy your app after updating env vars.")
}

main().catch(err => {
  console.error("Fatal error:", err)
  process.exit(1)
})
