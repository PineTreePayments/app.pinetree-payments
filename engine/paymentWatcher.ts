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
    lastCheckedBlock = await getCurrentBlockHeight(rpcUrl)
  } catch (error) {
    console.error("Failed to get current block height:", error)
    return false
  }

  /* ---------------------------
     WATCH LOOP
  --------------------------- */

  while (attempts < WATCHER_CONFIG.maxAttempts) {
    try {
      const latestBlock = await getCurrentBlockHeight(rpcUrl)

      // Check each block since last check
      for (
        let blockNumber = lastCheckedBlock;
        blockNumber <= latestBlock;
        blockNumber++
      ) {
        const block = await getBlockByNumber(rpcUrl, blockNumber)
        const transactions = block?.transactions || []

        for (const tx of transactions) {
          if (!tx.to) continue

          const to = tx.to.toLowerCase()

          // Check if transaction is to our wallets
          if (
            to !== merchantWallet &&
            to !== pinetreeWallet
          ) {
            continue
          }

          const valueEth = weiToEth(tx.value)

          // Check if amount matches (allowing some tolerance)
          if (valueEth >= input.merchantAmount * 0.95) {
            // Found a matching transaction
            const confirmed = await handleMatchingTransaction(
              input.paymentId,
              tx
            )

            if (confirmed) {
              return true
            }
          }
        }
      }

      lastCheckedBlock = latestBlock + 1

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
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}