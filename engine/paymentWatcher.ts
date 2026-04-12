/**
 * PineTree Payment Watcher
 * 
 * Monitors blockchain transactions for payment confirmation.
 * Polls the network for transactions to merchant/treasury wallets.
 */

import { supabase } from "@/database"
import { getRpcUrl, WATCHER_CONFIG } from "./config"
import { updatePaymentStatus } from "./updatePaymentStatus"
import { type PaymentStatus } from "./paymentStateMachine"
import {
  getTransactionByPaymentId,
  updateTransactionProviderReference,
  updateTransactionStatus
} from "@/database/transactions"

type WatchInput = {
  merchantWallet: string
  pinetreeWallet: string
  merchantAmount: number
  pinetreeFee: number
  expectedAmountNative?: number
  expectedMerchantAtomic?: string | number
  expectedFeeAtomic?: string | number
  feeCaptureMethod?: string
  splitContract?: string
  network: string
  paymentId: string
  singleIteration?: boolean
}

type EvmTransaction = {
  hash: string
  from: string
  to: string | null
  value: string
}

type EvmBlock = {
  transactions: EvmTransaction[]
}

type SolanaRpcSignatureRow = {
  signature?: string
}

type SolanaParsedInstruction = {
  parsed?: {
    type?: string
    info?: {
      destination?: string
      lamports?: number | string
      source?: string
    }
  }
}

type SolanaParsedTransaction = {
  transaction?: {
    message?: {
      instructions?: SolanaParsedInstruction[]
    }
  }
}

function getAmountMatchRatio(network: string): number {
  const normalized = String(network || "").toLowerCase().trim()
  const baseDefault = Number(process.env.PAYMENT_MATCH_RATIO_DEFAULT || 0.98)
  const solanaDefault = Number(process.env.PAYMENT_MATCH_RATIO_SOLANA || baseDefault)
  const evmDefault = Number(process.env.PAYMENT_MATCH_RATIO_EVM || baseDefault)

  const ratio = normalized === "solana" ? solanaDefault : evmDefault
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
    return 0.98
  }

  return ratio
}

function getSingleIterationLookback(network: string): number {
  const normalized = String(network || "").toLowerCase().trim()
  const defaultValue = normalized === "solana" ? 500 : 40
  const raw =
    normalized === "solana"
      ? Number(process.env.PAYMENT_WATCHER_SINGLE_LOOKBACK_SOLANA || defaultValue)
      : Number(process.env.PAYMENT_WATCHER_SINGLE_LOOKBACK_EVM || defaultValue)

  if (!Number.isFinite(raw) || raw < 0) {
    return defaultValue
  }

  return Math.floor(raw)
}

/**
 * Watch a payment for blockchain confirmation
 * 
 * @param input - Payment watching parameters
 */
export async function watchPayment(input: WatchInput) {
  let attempts = 0
  const matchRatio = getAmountMatchRatio(input.network)

  const merchantWallet = String(input.merchantWallet || "").trim()
  const pinetreeWallet = String(input.pinetreeWallet || "").trim()
  const merchantWalletEvm = merchantWallet.toLowerCase()
  const splitContractEvm = String(input.splitContract || "").trim().toLowerCase()
  const feeCaptureMethod = String(input.feeCaptureMethod || "").trim().toLowerCase()

  /* ---------------------------
     SELECT RPC BASED ON NETWORK
  --------------------------- */

  let rpcUrl = ""

  try {
    rpcUrl = getRpcUrl(input.network)
  } catch {
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
      lastCheckedBlock = Number(data.result || 0)

      if (input.singleIteration) {
        const lookback = getSingleIterationLookback(input.network)
        lastCheckedBlock = Math.max(0, lastCheckedBlock - lookback)
      }
    } else {
      const currentBlock = await getCurrentBlockHeight(rpcUrl)
      if (input.singleIteration) {
        const lookback = getSingleIterationLookback(input.network)
        lastCheckedBlock = Math.max(0, currentBlock - lookback)
      } else {
        lastCheckedBlock = currentBlock
      }
    }
  } catch (error) {
    console.error("Failed to get current block height:", error)
    return false
  }

  /* ---------------------------
     WATCH LOOP
  --------------------------- */

    do {
    try {
      let transactions: EvmTransaction[] = []

      if (input.network === "solana") {
        const expectedMerchantLamports = Number(input.expectedMerchantAtomic || 0)
        const expectedFeeLamports = Number(input.expectedFeeAtomic || 0)

        const splitTx = await findMatchingSolanaSplitTransaction({
          rpcUrl,
          merchantWallet,
          pinetreeWallet,
          sinceSlot: lastCheckedBlock,
          expectedMerchantLamports,
          expectedFeeLamports,
          matchRatio
        })

        // Update last checked slot for next iteration
        const currentSlotResponse = await fetch(rpcUrl, {
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

        const currentSlotData = await currentSlotResponse.json()
        lastCheckedBlock = Number(currentSlotData.result || lastCheckedBlock)

        if (splitTx) {
          const confirmed = await handleMatchingTransaction(input.paymentId, {
            hash: splitTx.hash,
            value: String(splitTx.totalLamports / 1e9),
            from: splitTx.from
          }, true)

          if (confirmed) {
            return true
          }
        }

        if (input.singleIteration) {
          return false
        }

        attempts++
        await sleep(WATCHER_CONFIG.pollInterval)
        continue
      } else {
        // EVM transaction monitoring
        const latestBlock = await getCurrentBlockHeight(rpcUrl)
        const collectedTransactions: EvmTransaction[] = []
        
        // Check each block since last check
        for (
          let blockNumber = lastCheckedBlock;
          blockNumber <= latestBlock;
          blockNumber++
        ) {
          const block = await getBlockByNumber(rpcUrl, blockNumber)
          if (block?.transactions?.length) {
            collectedTransactions.push(...block.transactions)
          }
        }

        transactions = collectedTransactions
        lastCheckedBlock = latestBlock + 1
      }

      for (const tx of transactions) {
        if (!tx.to) continue
        const toAddress = tx.to.toLowerCase()
        const value = weiToEth(tx.value)

        const grossRequired =
          typeof input.expectedAmountNative === "number" && Number.isFinite(input.expectedAmountNative)
            ? input.expectedAmountNative
            : input.merchantAmount + input.pinetreeFee

        const threshold = grossRequired * matchRatio

        if (feeCaptureMethod === "contract_split") {
          if (!splitContractEvm) {
            console.warn("[watcher:evm] missing split contract for contract_split payment", {
              paymentId: input.paymentId
            })
            continue
          }

          // For contract split, payment must be sent to the configured split contract.
          if (toAddress !== splitContractEvm) {
            continue
          }
        } else {
          // Legacy non-contract fallback: direct transfer to merchant wallet.
          if (toAddress !== merchantWalletEvm) {
            continue
          }
        }

        // Check if full gross amount was received within tolerance window
        if (value >= threshold) {
          // ✅ Full gross amount received
          // Fee has been successfully collected at payment time
          const confirmed = await handleMatchingTransaction(
            input.paymentId,
            tx,
            feeCaptureMethod === "contract_split"
          )

          if (confirmed) {
            return true
          }
        } else {
          console.info("[watcher:evm] transaction below threshold", {
            paymentId: input.paymentId,
            txHash: tx.hash,
            network: input.network,
            receivedNative: value,
            expectedNative: grossRequired,
            matchRatio,
            thresholdNative: threshold
          })
        }
      }

    } catch (error) {
      console.error("Watcher error:", error)
    }

    attempts++

    if (input.singleIteration) {
      return false
    }

    // Wait before next poll
    await sleep(WATCHER_CONFIG.pollInterval)
  } while (attempts < WATCHER_CONFIG.maxAttempts)

  /* ---------------------------
     MARK FAILED AFTER TIMEOUT
  --------------------------- */

  try {
    const currentStatus = await getPaymentStatus(input.paymentId)

    if (currentStatus === "PROCESSING") {
      await updatePaymentStatus(input.paymentId, "FAILED", {
        providerEvent: "watcher_timeout"
      })

      const transaction = await getTransactionByPaymentId(input.paymentId)
      if (transaction) {
        await updateTransactionStatus(transaction.id, "FAILED")
      }
    } else if (currentStatus === "PENDING" || currentStatus === "CREATED") {
      await updatePaymentStatus(input.paymentId, "INCOMPLETE", {
        providerEvent: "watcher_timeout"
      })

      const transaction = await getTransactionByPaymentId(input.paymentId)
      if (transaction) {
        await updateTransactionStatus(transaction.id, "EXPIRED")
      }
    }
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
  tx: { hash: string; value: string; from: string },
  feeCaptureValidated: boolean
) {
  const transaction = await getTransactionByPaymentId(paymentId)

  // Keep provider transaction hash in sync as soon as we detect on-chain match
  if (transaction && tx.hash) {
    try {
      await updateTransactionProviderReference(transaction.id, tx.hash)
    } catch (error) {
      console.warn("Failed to update transaction reference:", error)
    }
  }

  let status = await getPaymentStatus(paymentId)
  if (!status) return false

  if (status === "CONFIRMED") {
    if (transaction) {
      await updateTransactionStatus(transaction.id, "CONFIRMED")
    }
    return true
  }

  // Advance lifecycle in strict order: CREATED -> PENDING -> PROCESSING -> CONFIRMED
  // Do NOT read status between transitions - avoids read-after-write consistency issues
  try {
    if (status === "CREATED") {
      await updatePaymentStatus(paymentId, "PENDING", {
        providerEvent: "watcher.detected",
        rawPayload: { txHash: tx.hash }
      })
      status = "PENDING"
    }

    if (status === "PENDING") {
      await updatePaymentStatus(paymentId, "PROCESSING", {
        providerEvent: "watcher.detected",
        rawPayload: {
          txHash: tx.hash,
          value: tx.value,
          from: tx.from
        }
      })

      if (transaction) {
        await updateTransactionStatus(transaction.id, "PROCESSING")
      }

      status = "PROCESSING"
    }

    if (status === "PROCESSING") {
      await updatePaymentStatus(paymentId, "CONFIRMED", {
        providerEvent: "blockchain_confirmation",
        rawPayload: {
          txHash: tx.hash,
          value: tx.value,
          from: tx.from,
          feeCaptureValidated
        }
      })

      if (transaction) {
        await updateTransactionStatus(transaction.id, "CONFIRMED")
      }

      return true
    }
  } catch (error) {
    console.error("State transition failed for payment", paymentId, error)
    return false
  }

  return false
}

async function getPaymentStatus(paymentId: string): Promise<PaymentStatus | null> {
  const { data, error } = await supabase
    .from("payments")
    .select("status")
    .eq("id", paymentId)
    .single()

  if (error || !data?.status) {
    return null
  }

  return data.status as PaymentStatus
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
): Promise<EvmBlock | null> {
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
  return (data?.result || null) as EvmBlock | null
}

/**
 * Convert Wei to ETH
 */
function weiToEth(wei: string): number {
  return Number(wei) / 1e18
}

async function getSolanaSignatures(rpcUrl: string, address: string, sinceSlot: number): Promise<string[]> {
  try {
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

    if (data?.error) {
      console.warn("[watcher:solana] getSignaturesForAddress rpc error", {
        address,
        sinceSlot,
        rpcError: data.error
      })
      return []
    }

    if (!Array.isArray(data?.result)) {
      console.warn("[watcher:solana] getSignaturesForAddress unexpected result", {
        address,
        sinceSlot,
        hasResult: data?.result !== undefined
      })
      return []
    }

    return data.result
      .map((row: SolanaRpcSignatureRow) => String(row.signature || ""))
      .filter(Boolean)
  } catch (error) {
    console.error("[watcher:solana] getSignaturesForAddress request failed", {
      address,
      sinceSlot,
      error: error instanceof Error ? error.message : String(error)
    })
    return []
  }
}

async function getSolanaParsedTransaction(rpcUrl: string, signature: string): Promise<SolanaParsedTransaction | null> {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "getTransaction",
        params: [
          signature,
          {
            encoding: "jsonParsed",
            maxSupportedTransactionVersion: 0
          }
        ],
        id: 1
      })
    })

    const data = await response.json()
    if (data?.error) {
      console.warn("[watcher:solana] getTransaction rpc error", {
        signature,
        rpcError: data.error
      })
      return null
    }

    return (data?.result || null) as SolanaParsedTransaction | null
  } catch (error) {
    console.error("[watcher:solana] getTransaction request failed", {
      signature,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

async function findMatchingSolanaSplitTransaction(input: {
  rpcUrl: string
  merchantWallet: string
  pinetreeWallet: string
  sinceSlot: number
  expectedMerchantLamports: number
  expectedFeeLamports: number
  matchRatio: number
}): Promise<{ hash: string; from: string; totalLamports: number } | null> {
  const [merchantSignatures, treasurySignatures] = await Promise.all([
    getSolanaSignatures(input.rpcUrl, input.merchantWallet, input.sinceSlot),
    getSolanaSignatures(input.rpcUrl, input.pinetreeWallet, input.sinceSlot)
  ])

  if (!merchantSignatures.length || !treasurySignatures.length) {
    console.info("[watcher:solana] no signatures found for split detection", {
      merchantAddress: input.merchantWallet,
      treasuryAddress: input.pinetreeWallet,
      merchantCount: merchantSignatures.length,
      treasuryCount: treasurySignatures.length,
      sinceSlot: input.sinceSlot
    })
    return null
  }

  const treasurySet = new Set(treasurySignatures)
  const candidateSignatures = merchantSignatures.filter((sig) => treasurySet.has(sig))

  if (!candidateSignatures.length) {
    console.info("[watcher:solana] no overlapping signatures for split detection", {
      merchantAddress: input.merchantWallet,
      treasuryAddress: input.pinetreeWallet,
      merchantCount: merchantSignatures.length,
      treasuryCount: treasurySignatures.length,
      sinceSlot: input.sinceSlot
    })
    return null
  }

  for (const signature of candidateSignatures) {
    const tx = await getSolanaParsedTransaction(input.rpcUrl, signature)
    const instructions = tx?.transaction?.message?.instructions
    if (!Array.isArray(instructions)) continue

    let merchantLamports = 0
    let feeLamports = 0
    let source = ""

    for (const ix of instructions) {
      const parsed = ix?.parsed
      if (!parsed || parsed.type !== "transfer") continue

      const info = parsed.info || {}
      const destination = String(info.destination || "").toLowerCase()
      const lamports = Number(info.lamports || 0)
      const from = String(info.source || "")

      if (!source && from) source = from

      if (destination === input.merchantWallet.toLowerCase()) {
        merchantLamports += lamports
      }

      if (destination === input.pinetreeWallet.toLowerCase()) {
        feeLamports += lamports
      }
    }

    const merchantThreshold = input.expectedMerchantLamports > 0 ? input.expectedMerchantLamports * input.matchRatio : 0
    const feeThreshold = input.expectedFeeLamports > 0 ? input.expectedFeeLamports * input.matchRatio : 0

    if (merchantLamports >= merchantThreshold && feeLamports >= feeThreshold) {
      return {
        hash: signature,
        from: source,
        totalLamports: merchantLamports + feeLamports
      }
    } else {
      console.info("[watcher:solana] signature below threshold", {
        signature,
        source,
        receivedMerchantLamports: merchantLamports,
        expectedMerchantLamports: input.expectedMerchantLamports,
        merchantThreshold,
        receivedFeeLamports: feeLamports,
        expectedFeeLamports: input.expectedFeeLamports,
        feeThreshold,
        matchRatio: input.matchRatio
      })
    }
  }

  console.info("[watcher:solana] candidate signatures did not meet split thresholds", {
    merchantAddress: input.merchantWallet,
    treasuryAddress: input.pinetreeWallet,
    candidateCount: candidateSignatures.length,
    expectedMerchantLamports: input.expectedMerchantLamports,
    expectedFeeLamports: input.expectedFeeLamports
  })

  return null
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
