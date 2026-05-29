/**
 * PineTreeSplitV6 deployment script (ESM)
 *
 * Prerequisites:
 *   cd contracts && npm install
 *
 * Required env vars (set in contracts/.env.deploy or export before running):
 *   DEPLOYER_PRIVATE_KEY          — 0x-prefixed private key of the deploying wallet
 *   PINETREE_TREASURY_WALLET_BASE — 0x EVM address of the PineTree treasury
 *   BASE_RPC_URL                  — Base mainnet RPC (default: https://mainnet.base.org)
 *
 * Run:
 *   node contracts/scripts/deploy-v6.mjs
 *
 * After successful deploy, add to your env:
 *   PINETREE_BASE_V6_CONTRACT=<printed address>
 */

import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { ethers } from "ethers"
import { config as dotenvConfig } from "dotenv"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load contracts/.env.deploy so the script works without exporting vars in the shell
dotenvConfig({ path: join(__dirname, "../.env.deploy") })

// ── Load env ──────────────────────────────────────────────────────────────────
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY?.trim()
const treasury = process.env.PINETREE_TREASURY_WALLET_BASE?.trim()
const rpcUrl = (process.env.BASE_RPC_URL || "https://mainnet.base.org").trim()

if (!deployerKey || !/^0x[a-fA-F0-9]{64}$/.test(deployerKey)) {
  console.error("ERROR: DEPLOYER_PRIVATE_KEY must be a 0x-prefixed 32-byte private key")
  process.exit(1)
}
if (!treasury || !/^0x[a-fA-F0-9]{40}$/.test(treasury)) {
  console.error("ERROR: PINETREE_TREASURY_WALLET_BASE must be a valid 0x EVM address")
  process.exit(1)
}

// ── Load compiled artifact ────────────────────────────────────────────────────
// Run `cd contracts && npx hardhat compile` to generate this artifact first.
const artifactPath = join(__dirname, "../artifacts/src/PineTreeSplitV6.sol/PineTreeSplitV6.json")
let artifact
try {
  artifact = JSON.parse(readFileSync(artifactPath, "utf8"))
} catch {
  console.error("ERROR: Compiled artifact not found at:", artifactPath)
  console.error("Run: cd contracts && npx hardhat compile")
  process.exit(1)
}

// ── Deploy ────────────────────────────────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(rpcUrl)
const wallet = new ethers.Wallet(deployerKey, provider)
const network = await provider.getNetwork()

console.log("\n── PineTreeSplitV6 Deployment ──────────────────────────────")
console.log("Network:  ", network.name, "(chainId:", network.chainId.toString(), ")")
console.log("RPC:      ", rpcUrl)
console.log("Deployer: ", wallet.address)
console.log("Treasury: ", treasury)
console.log("────────────────────────────────────────────────────────────\n")

const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet)
const contract = await factory.deploy(treasury)
const receipt = await contract.deploymentTransaction()?.wait()

const deployedAddress = await contract.getAddress()
const blockNumber = receipt?.blockNumber ?? "unknown"

console.log("✅ PineTreeSplitV6 deployed successfully")
console.log("   Contract address:", deployedAddress)
console.log("   Deployer:        ", wallet.address)
console.log("   Treasury:        ", treasury)
console.log("   Network:         ", network.name, "(chainId:", network.chainId.toString(), ")")
console.log("   Tx hash:         ", receipt?.hash ?? contract.deploymentTransaction()?.hash ?? "unknown")
console.log("   Block:           ", blockNumber)
console.log("\nNext steps:")
console.log("  1. Add to env: PINETREE_BASE_V6_CONTRACT=" + deployedAddress)
console.log("  2. Allowlist relayer: node contracts/scripts/allowlist-v6-relayer.mjs")
console.log("  3. Verify on Basescan:")
console.log("     npx hardhat verify --network base", deployedAddress, treasury)
