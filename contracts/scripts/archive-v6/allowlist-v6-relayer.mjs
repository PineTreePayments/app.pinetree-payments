/**
 * PineTreeSplitV6 relayer allowlist script (ESM)
 *
 * Prerequisites:
 *   - PineTreeSplitV6 already deployed (run deploy-v6.mjs first)
 *   - cd contracts && npm install
 *
 * Required env vars:
 *   DEPLOYER_PRIVATE_KEY              — 0x-prefixed private key of the contract owner
 *   PINETREE_BASE_V6_CONTRACT         — deployed PineTreeSplitV6 contract address
 *   PINETREE_BASE_V6_RELAYER_ADDRESS  — relayer address to allowlist
 *   BASE_RPC_URL                      — Base mainnet RPC (default: https://mainnet.base.org)
 *
 * Run:
 *   node contracts/scripts/allowlist-v6-relayer.mjs
 *
 * To remove a relayer, set REMOVE_RELAYER=true before running:
 *   REMOVE_RELAYER=true node contracts/scripts/allowlist-v6-relayer.mjs
 */

import { ethers } from "ethers"
import { config as dotenvConfig } from "dotenv"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load contracts/.env.deploy so the script works without exporting vars in the shell
dotenvConfig({ path: join(__dirname, "../.env.deploy") })

// ── Load env ──────────────────────────────────────────────────────────────────
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY?.trim()
const contractAddress = process.env.PINETREE_BASE_V6_CONTRACT?.trim()
const relayerAddress = process.env.PINETREE_BASE_V6_RELAYER_ADDRESS?.trim()
const rpcUrl = (process.env.BASE_RPC_URL || "https://mainnet.base.org").trim()
const remove = process.env.REMOVE_RELAYER === "true"

if (!deployerKey || !/^0x[a-fA-F0-9]{64}$/.test(deployerKey)) {
  console.error("ERROR: DEPLOYER_PRIVATE_KEY must be a 0x-prefixed 32-byte private key")
  process.exit(1)
}
if (!contractAddress || !/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
  console.error("ERROR: PINETREE_BASE_V6_CONTRACT must be a valid 0x EVM address")
  process.exit(1)
}
if (!relayerAddress || !/^0x[a-fA-F0-9]{40}$/.test(relayerAddress)) {
  console.error("ERROR: PINETREE_BASE_V6_RELAYER_ADDRESS must be a valid 0x EVM address")
  process.exit(1)
}

// ── Minimal ABI ───────────────────────────────────────────────────────────────
const ABI = [
  "function setRelayer(address relayer, bool allowed) external",
  "function relayers(address) external view returns (bool)",
  "function owner() external view returns (address)",
  "event RelayerUpdated(address indexed relayer, bool allowed)",
]

// ── Connect ───────────────────────────────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(rpcUrl)
const wallet = new ethers.Wallet(deployerKey, provider)
const network = await provider.getNetwork()
const contract = new ethers.Contract(contractAddress, ABI, wallet)

console.log("\n── PineTreeSplitV6 Relayer Allowlist ───────────────────────")
console.log("Network:   ", network.name, "(chainId:", network.chainId.toString(), ")")
console.log("RPC:       ", rpcUrl)
console.log("Contract:  ", contractAddress)
console.log("Caller:    ", wallet.address)
console.log("Relayer:   ", relayerAddress)
console.log("Action:    ", remove ? "REMOVE" : "ALLOW")
console.log("────────────────────────────────────────────────────────────\n")

// ── Verify caller is owner ────────────────────────────────────────────────────
const contractOwner = await contract.owner()
if (contractOwner.toLowerCase() !== wallet.address.toLowerCase()) {
  console.error("ERROR: Caller is not the contract owner")
  console.error("  Owner:  ", contractOwner)
  console.error("  Caller: ", wallet.address)
  process.exit(1)
}

// ── Check current state ───────────────────────────────────────────────────────
const currentlyAllowed = await contract.relayers(relayerAddress)
const targetAllowed = !remove

if (currentlyAllowed === targetAllowed) {
  console.log(
    targetAllowed
      ? `ℹ️  Relayer ${relayerAddress} is already allowlisted. No transaction needed.`
      : `ℹ️  Relayer ${relayerAddress} is already removed. No transaction needed.`
  )
  process.exit(0)
}

// ── Send transaction ──────────────────────────────────────────────────────────
console.log(`Sending setRelayer(${relayerAddress}, ${targetAllowed})...`)
const tx = await contract.setRelayer(relayerAddress, targetAllowed)
console.log("Transaction sent:", tx.hash)
console.log("Waiting for confirmation...")

const receipt = await tx.wait()

console.log(
  targetAllowed
    ? "\n✅ Relayer successfully allowlisted"
    : "\n✅ Relayer successfully removed"
)
console.log("   Relayer:     ", relayerAddress)
console.log("   Contract:    ", contractAddress)
console.log("   Tx hash:     ", receipt.hash)
console.log("   Block:       ", receipt.blockNumber)

if (targetAllowed) {
  console.log("\nNext steps:")
  console.log("  1. Add to env: PINETREE_BASE_V6_RELAYER_ADDRESS=" + relayerAddress)
  console.log("  2. Verify relayer is allowlisted:")
  console.log("     Call: relayers(" + relayerAddress + ") on contract " + contractAddress)
}
