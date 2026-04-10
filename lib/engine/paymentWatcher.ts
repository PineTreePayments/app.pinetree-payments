/**
 * PineTree Payment Watcher
 * 
 * Monitors blockchain transactions for payment confirmation.
 * Polls the network for transactions to merchant/treasury wallets.
 */

import { supabase } from "@/lib/database"
import { getRpcUrl, WATCHER_CONFIG } from "./config"
import { updatePaymentStatus } from "./updatePaymentStatus"
import { updateTransactionProviderReference } from "@/lib/database/transactions"

type WatchInput = {
  merchantWallet: string
  pinetreeWallet: string
  merchantAmount: number
  pinetreeFee: number
  expectedAmountNative?: number
  network: string
  paymentId: string
}

/**
 * Watch a payment for blockchain confirmation
 * 
 * @param input - Payment watching parameters
 */
export async function watchPayment(input: WatchInput) {
  let attempts = 0

  const merchantWallet = input.merchantWallet.toLowerCase()
  const pinetreeWallet = input.pinetreeWallet.toLowerCase()

  /* ---------------------------
     SELECT RPC BASED ON NETWORK
  --------------------------- */

  let rpcUrl = ""

  try {
    rpcUrl = getRpcUrl(input.network)
  } catch (error) {
    console.error(`No RPC configured for network: ${input.network}`)
    return false
  }

  /* ---------------------------
     GET CURRENT BLOCK HEIGHT
  --------------------------- */

  let lastCheckedBlock: number

  try {
    if (input.network === "solana") {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "getSlot",
          params: [],
          id: 1
        })
      })

      const data = await response.json()
      lastCheckedBlock = data.result
    } else {
      lastCheckedBlock = await getCurrentBlockHeight(rpcUrl)
    }
  } catch (error) {
    console.error("Failed to get current block height:", error)
    return false
  }

  /* ---------------------------
     WATCH LOOP
  --------------------------- */

  while (attempts < WATCHER_CONFIG.maxAttempts) {
    try {
      let transactions: any[] = []

      if (input.network === "solana") {
        // Solana transaction monitoring
        transactions = await getSolanaTransactions(rpcUrl, merchantWallet, lastCheckedBlock)
      } else {
        // EVM transaction monitoring
        const latestBlock = await getCurrentBlockHeight(rpcUrl)
        
        // Check each block since last check
        for (
          let blockNumber = lastCheckedBlock;
          blockNumber <= latestBlock;
          blockNumber++
        ) {
          const block = await getBlockByNumber(rpcUrl, blockNumber)
          transactions = block?.transactions || []

          lastCheckedBlock = latestBlock + 1
        }
      }

      for (const tx of transactions) {
        let toAddress: string
        let value: number

        if (input.network === "solana") {
          toAddress = tx.destination
          value = tx.lamports / 1e9
        } else {
          if (!tx.to) continue
          toAddress = tx.to.toLowerCase()
          value = weiToEth(tx.value)
        }

        // Check if transaction is to merchant wallet
        if (toAddress.toLowerCase() !== merchantWallet) {
          continue
        }

        const grossRequired =
          typeof input.expectedAmountNative === "number" && Number.isFinite(input.expectedAmountNative)
            ? input.expectedAmountNative
            : input.merchantAmount + input.pinetreeFee

        // Check if full gross amount was received (99.5% tolerance for network fees)
        if (value >= grossRequired * 0.995) {
          // ✅ Full gross amount received
          // Fee has been successfully collected at payment time
          const confirmed = await handleMatchingTransaction(
            input.paymentId,
            tx
          )

          if (confirmed) {
            return true
          }
        }
      }

    } catch (error) {
      console.error("Watcher error:", error)
    }

    attempts++

    // Wait before next poll
    await sleep(WATCHER_CONFIG.pollInterval)
  }

  /* ---------------------------
     MARK FAILED AFTER TIMEOUT
  --------------------------- */

  try {
    await updatePaymentStatus(input.paymentId, "FAILED", {
      providerEvent: "watcher_timeout"
    })
  } catch (error) {
    console.error("Failed to mark payment as failed:", error)
  }

  return false
}

/**
 * Handle a matching transaction found on chain
 */
async function handleMatchingTransaction(
  paymentId: string,
  tx: { hash: string; value: string; from: string }
) {
  // Check if already confirmed
  const { data: existing } = await supabase
    .from("payments")
    .select("status")
    .eq("id", paymentId)
    .single()

  if (existing?.status === "CONFIRMED") {
    return true
  }

  // Update payment status
  try {
    await updatePaymentStatus(paymentId, "CONFIRMED", {
      providerEvent: "blockchain_confirmation",
      rawPayload: {
        txHash: tx.hash,
        value: tx.value,
        from: tx.from
      }
    })
  } catch (error: any) {
    // Ignore if already confirmed
    if (!error.message.includes("Invalid payment transition")) {
      throw error
    }
  }

  // Update transaction record
  try {
    await updateTransactionProviderReference(paymentId, tx.hash)
  } catch (error) {
    console.warn("Failed to update transaction reference:", error)
  }

  return true
}

/**
 * Get current block height from RPC
 */
async function getCurrentBlockHeight(rpcUrl: string): Promise<number> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_blockNumber",
      params: [],
      id: 1
    })
  })

  const data = await response.json()
  return parseInt(data.result, 16)
}

/**
 * Get block by number from RPC
 */
async function getBlockByNumber(
  rpcUrl: string,
  blockNumber: number
): Promise<any> {
  const blockHex = "0x" + blockNumber.toString(16)

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getBlockByNumber",
      params: [blockHex, true],
      id: 1
    })
  })

  const data = await response.json()
  return data.result
}

/**
 * Convert Wei to ETH
 */
function weiToEth(wei: string): number {
  return Number(wei) / 1e18
}

/**
 * Get Solana transactions for address since specified slot
 */
async function getSolanaTransactions(rpcUrl: string, address: string, sinceSlot: number): Promise<any[]> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "getSignaturesForAddress",
      params: [
        address,
        {
          minContextSlot: sinceSlot,
          limit: 100
        }
      ],
      id: 1
    })
  })

  const data = await response.json()
  
  if (!data.result) {
    return []
  }

  return data.result.map((sig: any) => ({
    hash: sig.signature,
    destination: address,
    lamports: sig.lamports || 0,
    from: sig.memo || ""
  }))
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
