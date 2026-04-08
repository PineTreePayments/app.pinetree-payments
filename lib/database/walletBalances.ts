import { supabase } from "./supabase"

export type WalletBalance = {
  id: string
  merchant_id: string
  asset: string
  balance: number
  last_updated: string
}

export type CreateWalletBalanceInput = {
  merchant_id: string
  asset: string
  balance: number
}

/**
 * Get wallet balances for a merchant
 */
export async function getWalletBalances(merchantId: string) {
  const { data, error } = await supabase
    .from("wallet_balances")
    .select("*")
    .eq("merchant_id", merchantId)

  if (error) {
    return []
  }

  return data as WalletBalance[]
}

/**
 * Get a specific wallet balance
 */
export async function getWalletBalance(
  merchantId: string,
  asset: string
) {
  const { data, error } = await supabase
    .from("wallet_balances")
    .select("*")
    .eq("merchant_id", merchantId)
    .eq("asset", asset)
    .single()

  if (error) {
    return null
  }

  return data as WalletBalance | null
}

/**
 * Update wallet balance
 */
export async function updateWalletBalance(
  merchantId: string,
  asset: string,
  balance: number
) {
  const { data, error } = await supabase
    .from("wallet_balances")
    .upsert({
      merchant_id: merchantId,
      asset,
      balance,
      last_updated: new Date().toISOString()
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to update wallet balance: ${error.message}`)
  }

  return data as WalletBalance
}

/**
 * Calculate total wallet value in USD
 */
export async function calculateTotalWalletValue(
  merchantId: string,
  prices: Record<string, number> = {}
) {
  const balances = await getWalletBalances(merchantId)
  
  // Default prices if not provided
  const defaultPrices: Record<string, number> = {
    SOL: 150,
    SOLANA: 150,
    ETH: 3000,
    ETHEREUM: 3000,
    BASE: 3000,
    USDC: 1,
    USDT: 1,
    DAI: 1,
    ...prices
  }

  let total = 0

  balances.forEach((balance) => {
    const asset = String(balance.asset || "").toUpperCase()
    const value = Number(balance.balance || 0)
    const price = defaultPrices[asset] || 0
    
    total += value * price
  })

  return total
}

/**
 * Update multiple wallet balances at once
 */
export async function updateMultipleWalletBalances(
  merchantId: string,
  balances: Array<{ asset: string; balance: number }>
) {
  const updates = balances.map((b) => ({
    merchant_id: merchantId,
    asset: b.asset,
    balance: b.balance,
    last_updated: new Date().toISOString()
  }))

  const { error } = await supabase
    .from("wallet_balances")
    .upsert(updates)

  if (error) {
    throw new Error(`Failed to update wallet balances: ${error.message}`)
  }
}