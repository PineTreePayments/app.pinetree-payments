/**
 * PineTree Balance Updater
 * 
 * Polls blockchain networks and updates wallet balances
 * automatically for all connected merchant wallets.
 */

import { getMerchantWallets, updateWalletBalance } from "@/database"
import { getRpcUrl } from "./config"

/**
 * Update balance for a single wallet
 */
export async function updateSingleWalletBalance(
  merchantId: string,
  network: string,
  address: string
) {
  try {
    let balance = 0

    switch (network.toLowerCase()) {
      case "solana":
        balance = await getSolanaBalance(address)
        break

      case "base":
      case "ethereum":
        balance = await getEthereumBalance(address, network)
        break

      default:
        console.warn(`Unknown network for balance check: ${network}`)
        return null
    }

    await updateWalletBalance(merchantId, network, balance)

    return balance
  } catch (error) {
    console.error(`Balance update failed ${network} ${address}:`, error)
    return null
  }
}

/**
 * Update all wallet balances for a merchant
 */
export async function updateAllMerchantBalances(merchantId: string) {
  const wallets = await getMerchantWallets(merchantId)
  const results = []

  for (const wallet of wallets) {
    const balance = await updateSingleWalletBalance(
      merchantId,
      wallet.network,
      wallet.wallet_address
    )

    results.push({
      wallet,
      balance,
      success: balance !== null
    })
  }

  return results
}

/**
 * Get Solana balance from RPC
 */
async function getSolanaBalance(address: string): Promise<number> {
  const rpcUrl = getRpcUrl("solana")

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [address]
    })
  })

  const data = await response.json()

  if (data.error) {
    throw new Error(data.error.message)
  }

  // Convert lamports to SOL
  return Number(data.result?.value || 0) / 1000000000
}

/**
 * Get Ethereum/Base balance from RPC
 */
async function getEthereumBalance(address: string, network: string): Promise<number> {
  const rpcUrl = getRpcUrl(network)

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [address, "latest"]
    })
  })

  const data = await response.json()

  if (data.error) {
    throw new Error(data.error.message)
  }

  // Convert wei to ETH
  const balanceWei = BigInt(data.result || "0")
  return Number(balanceWei) / 1000000000000000000
}