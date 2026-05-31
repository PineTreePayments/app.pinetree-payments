// Settlement balance helpers — read-only chain queries.
// Fetches USDC token balances and verifies transaction status for submitted withdrawals.
// Never initiates transactions, never stores credentials.

// USDC contract addresses — match constants in settlementWithdrawals.ts and config.ts
const BASE_USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const SOLANA_USDC_MINT_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
// keccak256("balanceOf(address)") → first 4 bytes
const ERC20_BALANCE_OF_SELECTOR = "0x70a08231"

function getSolanaRpcUrls(): string[] {
  return [
    process.env.RPC_URL_SOLANA,
    process.env.SOLANA_RPC_URL,
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    "https://api.mainnet-beta.solana.com",
    "https://solana-rpc.publicnode.com"
  ].filter(Boolean) as string[]
}

function getBaseRpcUrls(): string[] {
  return [
    process.env.BASE_RPC_URL,
    "https://mainnet.base.org",
    "https://base.llamarpc.com"
  ].filter(Boolean) as string[]
}

// ─── USDC balance ─────────────────────────────────────────────────────────────

/**
 * Fetch Base USDC (native USDC) balance for a wallet address.
 * Calls eth_call on the USDC contract with balanceOf(address).
 * Throws if all RPC endpoints fail.
 */
export async function fetchBaseUsdcBalance(walletAddress: string): Promise<number> {
  const rpcUrls = getBaseRpcUrls()
  const encodedAddress = walletAddress.slice(2).toLowerCase().padStart(64, "0")
  const callData = ERC20_BALANCE_OF_SELECTOR + encodedAddress

  for (const url of rpcUrls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [{ to: BASE_USDC_CONTRACT, data: callData }, "latest"]
        }),
        cache: "no-store"
      })

      const payload = await res.json()
      if (payload.error) continue

      const raw = String(payload.result ?? "")
      if (!raw || raw === "0x" || raw.length < 3) return 0

      // Divide by 1e6 (USDC has 6 decimals)
      return Number(BigInt(raw)) / 1_000_000
    } catch {
      // try next endpoint
    }
  }

  throw new Error("Unable to fetch Base USDC balance — all RPC endpoints failed.")
}

/**
 * Fetch Solana USDC (native USDC) balance for a wallet address.
 * Uses getTokenAccountsByOwner filtered by the USDC mint.
 * Returns 0 if no associated token account exists.
 * Throws if all RPC endpoints fail.
 */
export async function fetchSolanaUsdcBalance(walletAddress: string): Promise<number> {
  const rpcUrls = getSolanaRpcUrls()

  for (const url of rpcUrls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTokenAccountsByOwner",
          params: [
            walletAddress,
            { mint: SOLANA_USDC_MINT_ADDRESS },
            { encoding: "jsonParsed" }
          ]
        }),
        cache: "no-store"
      })

      const payload = await res.json()
      if (payload.error) continue

      const accounts = Array.isArray(payload?.result?.value) ? payload.result.value : []
      if (accounts.length === 0) return 0  // No USDC token account — balance is 0

      const uiAmount = accounts[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount
      return Number(uiAmount ?? 0) || 0
    } catch {
      // try next endpoint
    }
  }

  throw new Error("Unable to fetch Solana USDC balance — all RPC endpoints failed.")
}

// ─── Transaction status checks ────────────────────────────────────────────────

export type ChainTxStatus = "confirmed" | "failed" | "pending"

/**
 * Check whether a Base transaction is confirmed, failed, or still pending.
 * Uses eth_getTransactionReceipt: status 0x1 = success, 0x0 = reverted, null = not yet mined.
 */
export async function checkBaseTxStatus(txHash: string): Promise<ChainTxStatus> {
  const rpcUrls = getBaseRpcUrls()

  for (const url of rpcUrls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getTransactionReceipt",
          params: [txHash]
        }),
        cache: "no-store"
      })

      const payload = await res.json()
      if (payload.error) continue

      if (!payload.result) return "pending"  // Not yet mined

      const status = String(payload.result.status ?? "")
      if (status === "0x1") return "confirmed"
      if (status === "0x0") return "failed"
      return "pending"
    } catch {
      // try next
    }
  }

  // All endpoints failed — conservative: treat as pending
  return "pending"
}

/**
 * Check whether a Solana transaction signature is finalized, failed, or still processing.
 * Uses getSignatureStatuses with searchTransactionHistory: true.
 */
export async function checkSolanaTxStatus(signature: string): Promise<ChainTxStatus> {
  const rpcUrls = getSolanaRpcUrls()

  for (const url of rpcUrls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getSignatureStatuses",
          params: [[signature], { searchTransactionHistory: true }]
        }),
        cache: "no-store"
      })

      const payload = await res.json()
      if (payload.error) continue

      const result = payload?.result?.value?.[0]
      if (!result) return "pending"  // Signature not yet visible

      // If err is set, the transaction failed on chain
      if (result.err !== null && result.err !== undefined) return "failed"

      const confirmationStatus = String(result.confirmationStatus ?? "")
      if (confirmationStatus === "finalized" || confirmationStatus === "confirmed") return "confirmed"

      return "pending"
    } catch {
      // try next
    }
  }

  return "pending"
}
