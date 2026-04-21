/**
 * PineTree Payment Watcher — Single-Execution Blockchain Check
 *
 * This module performs ONE bounded check of the blockchain and exits.
 *
 * It contains:
 *   ✅ A single pass over a fixed lookback window of already-finalised blocks
 *   ✅ Immediate exit after the check — no waiting for future blocks
 *   ✅ Solana: memo-based payment reference verification (deterministic match)
 *   ✅ EVM: calldata reference check for contract_split payments
 *
 * It does NOT contain:
 *   ❌ do/while loops  — removed
 *   ❌ while loops     — removed
 *   ❌ setInterval     — never added
 *   ❌ setTimeout      — never added
 *   ❌ recursive calls — never added
 *   ❌ sleep / delays  — removed
 *   ❌ background tasks — removed
 *
 * Entry point: watchPaymentOnce(input)
 * Callers   : engine/paymentStatusOrchestrator.ts → queueSingleWatcherIteration
 *             engine/checkPaymentOnce.ts          → checkPaymentOnce
 *             app/api/cron/check-payments         → via orchestrator
 *             Webhook handlers                    → via orchestrator
 */

import { supabaseAdmin, supabase as supabaseAnon, getPaymentById, upsertLedgerEntry } from "@/database"
const supabaseDb = supabaseAdmin || supabaseAnon
import { getRpcUrl } from "./config"
import { updatePaymentStatus } from "./updatePaymentStatus"
import { type PaymentStatus } from "./paymentStateMachine"
import {
  getTransactionByPaymentId,
  updateTransactionProviderReference,
  updateTransactionStatus
} from "@/database/transactions"
import { id as ethersId, AbiCoder } from "ethers"

// Solana Memo Program ID — same constant used in solanaSplitTransaction.ts
const SOLANA_MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"

// PineTreeSplit contract event: PaymentSplit(address indexed merchant, address indexed treasury,
//   uint256 merchantAmount, uint256 feeAmount, string paymentRef, address indexed payer, address token)
const PAYMENT_SPLIT_TOPIC = ethersId(
  "PaymentSplit(address,address,uint256,uint256,string,address,address)"
)

// ─── Input / Output types ────────────────────────────────────────────────────

export type WatchOnceInput = {
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
}

// ─── Internal RPC types ──────────────────────────────────────────────────────

type EvmTransaction = {
  hash: string
  from: string
  to: string | null
  value: string
  input?: string  // ABI-encoded calldata; present for contract calls, absent/0x for plain transfers
}

type EvmBlock = {
  transactions: EvmTransaction[]
}

type SolanaRpcSignatureRow = {
  signature?: string
}

// parsed can be a string (memo program) or an object (system program transfer)
type SolanaParsedInstruction = {
  programId?: string
  parsed?: string | {
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

// ─── Configuration helpers ───────────────────────────────────────────────────

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

function getLookbackWindow(network: string): number {
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

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Check the blockchain ONCE for a transaction matching the given payment.
 *
 * Execution model:
 *   1. Resolve the RPC endpoint for the payment's network.
 *   2. Fetch the current block / slot number.
 *   3. Iterate backwards over a bounded lookback window of already-confirmed blocks.
 *   4. If a matching transaction is found, advance the payment through its state
 *      machine (CREATED → PENDING → PROCESSING → CONFIRMED) and return true.
 *   5. If no match is found, return false immediately.
 *
 * The block-range iteration in step 3 is bounded and finite — it walks over
 * blocks that are already on chain. It does NOT poll for future blocks.
 *
 * @returns true  if the payment was confirmed during this check.
 * @returns false if no matching transaction was found in the lookback window.
 */
export async function watchPaymentOnce(input: WatchOnceInput): Promise<boolean> {
  const matchRatio = getAmountMatchRatio(input.network)

  const merchantWallet = String(input.merchantWallet || "").trim()
  const pinetreeWallet = String(input.pinetreeWallet || "").trim()
  const merchantWalletEvm = merchantWallet.toLowerCase()
  const splitContractEvm = String(input.splitContract || "").trim().toLowerCase()
  const feeCaptureMethod = String(input.feeCaptureMethod || "").trim().toLowerCase()

  // ── Resolve RPC ─────────────────────────────────────────────────────────────
  let rpcUrl = ""
  try {
    rpcUrl = getRpcUrl(input.network)
  } catch {
    console.error(`[watcher] No RPC configured for network: ${input.network}`)
    return false
  }

  // ── SOLANA ───────────────────────────────────────────────────────────────────
  if (input.network === "solana") {
    let currentSlot: number

    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "getSlot",
          params: [],
          id: 1
        })
      })
      const data = await res.json()
      currentSlot = Number(data.result || 0)
    } catch (error) {
      console.error("[watcher:solana] Failed to get current slot:", error)
      return false
    }

    const lookback = getLookbackWindow("solana")
    const sinceSlot = Math.max(0, currentSlot - lookback)

    const splitTx = await findMatchingSolanaSplitTransaction({
      rpcUrl,
      merchantWallet,
      pinetreeWallet,
      sinceSlot,
      expectedMerchantLamports: Number(input.expectedMerchantAtomic || 0),
      expectedFeeLamports: Number(input.expectedFeeAtomic || 0),
      matchRatio,
      paymentId: input.paymentId
    })

    if (!splitTx) return false

    return handleMatchingTransaction(
      input.paymentId,
      { hash: splitTx.hash, value: String(splitTx.totalLamports / 1e9), from: splitTx.from },
      true // fee capture validated for Solana split
    )
  }

  // ── EVM ──────────────────────────────────────────────────────────────────────
  let currentBlock: number
  try {
    currentBlock = await getCurrentBlockHeight(rpcUrl)
  } catch (error) {
    console.error("[watcher:evm] Failed to get current block:", error)
    return false
  }

  const lookback = getLookbackWindow(input.network)
  const startBlock = Math.max(0, currentBlock - lookback)
  const fromBlockHex = "0x" + startBlock.toString(16)

  // ── contract_split: query PaymentSplit event logs (1 RPC call, fast) ─────────
  if (feeCaptureMethod === "contract_split") {
    if (!splitContractEvm) {
      console.warn("[watcher:evm] missing split contract for contract_split payment", {
        paymentId: input.paymentId
      })
      return false
    }

    const logs = await getContractEventLogs(rpcUrl, splitContractEvm, PAYMENT_SPLIT_TOPIC, fromBlockHex)

    if (logs.length === 0) {
      console.info("[watcher:evm] no PaymentSplit events in lookback window", {
        paymentId: input.paymentId,
        splitContract: splitContractEvm,
        fromBlock: startBlock,
        toBlock: currentBlock
      })
      return false
    }

    for (const log of logs) {
      const decoded = decodePaymentSplitLog(log.data)
      if (!decoded) continue

      if (decoded.paymentRef !== input.paymentId) continue

      // payer is topics[3] (indexed) — last 20 bytes = 40 hex chars
      const payerTopic = String(log.topics[3] || "")
      const payer = payerTopic.length >= 42 ? "0x" + payerTopic.slice(-40) : "unknown"

      console.info("[watcher:evm] PaymentSplit event matched", {
        paymentId: input.paymentId,
        txHash: log.transactionHash,
        payer,
        token: decoded.token
      })

      const confirmed = await handleMatchingTransaction(
        input.paymentId,
        { hash: log.transactionHash, value: "0", from: payer },
        true
      )
      if (confirmed) return true
    }

    console.info("[watcher:evm] no PaymentSplit event matched paymentId", {
      paymentId: input.paymentId,
      splitContract: splitContractEvm,
      logsChecked: logs.length
    })
    return false
  }

  // ── direct payment: scan blocks for ETH transfer to merchant ─────────────────
  const blockNumbers: number[] = []
  for (let n = startBlock; n <= currentBlock; n++) blockNumbers.push(n)

  const blocks = await Promise.all(
    blockNumbers.map((n) => getBlockByNumber(rpcUrl, n).catch(() => null))
  )

  const transactions: EvmTransaction[] = []
  for (const block of blocks) {
    if (block?.transactions?.length) {
      transactions.push(...block.transactions)
    }
  }

  const grossRequired =
    typeof input.expectedAmountNative === "number" && Number.isFinite(input.expectedAmountNative)
      ? input.expectedAmountNative
      : input.merchantAmount + input.pinetreeFee

  const threshold = grossRequired * matchRatio

  for (const tx of transactions) {
    if (!tx.to) continue
    const toAddress = tx.to.toLowerCase()
    if (toAddress !== merchantWalletEvm) continue

    const value = weiToEth(tx.value)
    if (value >= threshold) {
      const confirmed = await handleMatchingTransaction(input.paymentId, tx, false)
      if (confirmed) return true
    } else {
      console.info("[watcher:evm] direct tx below threshold", {
        paymentId: input.paymentId,
        txHash: tx.hash,
        receivedNative: value,
        expectedNative: grossRequired,
        thresholdNative: threshold
      })
    }
  }

  return false
}

// ─── State machine ────────────────────────────────────────────────────────────

/**
 * Advance a payment through its confirmation state machine.
 *
 * Safe to call from both the watcher and webhook paths — the unique DB
 * constraint on payment_id in the ledger table ensures only the first
 * write wins if both paths race.
 */
async function handleMatchingTransaction(
  paymentId: string,
  tx: { hash: string; value: string; from: string },
  feeCaptureValidated: boolean
): Promise<boolean> {
  const transaction = await getTransactionByPaymentId(paymentId)

  if (transaction && tx.hash) {
    try {
      await updateTransactionProviderReference(transaction.id, tx.hash)
    } catch (error) {
      console.warn("[watcher] Failed to update transaction reference:", error)
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

  // Advance lifecycle in strict order to avoid read-after-write issues
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
        rawPayload: { txHash: tx.hash, value: tx.value, from: tx.from }
      })
      if (transaction) {
        await updateTransactionStatus(transaction.id, "PROCESSING")
      }
      status = "PROCESSING"
    }

    if (status === "PROCESSING") {
      const payment = await getPaymentById(paymentId)
      if (!payment) return false

      await upsertLedgerEntry({
        merchant_id: payment.merchant_id,
        payment_id: paymentId,
        transaction_id: transaction?.id,
        provider: payment.provider,
        network: payment.network,
        asset: payment.currency,
        amount: payment.gross_amount,
        usd_value: payment.gross_amount,
        wallet_address: tx.from,
        direction: "INBOUND",
        status: "CONFIRMED"
      })

      await updatePaymentStatus(paymentId, "CONFIRMED", {
        providerEvent: "blockchain_confirmation",
        rawPayload: { txHash: tx.hash, value: tx.value, from: tx.from, feeCaptureValidated }
      })

      if (transaction) {
        await updateTransactionStatus(transaction.id, "CONFIRMED")
      }

      return true
    }
  } catch (error) {
    console.error("[watcher] State transition failed for payment", paymentId, error)
    return false
  }

  return false
}

// ─── RPC helpers ─────────────────────────────────────────────────────────────

async function getPaymentStatus(paymentId: string): Promise<PaymentStatus | null> {
  const { data, error } = await supabaseDb
    .from("payments")
    .select("status")
    .eq("id", paymentId)
    .single()

  if (error || !data?.status) return null
  return data.status as PaymentStatus
}

async function getCurrentBlockHeight(rpcUrl: string): Promise<number> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

async function getBlockByNumber(rpcUrl: string, blockNumber: number): Promise<EvmBlock | null> {
  const blockHex = "0x" + blockNumber.toString(16)
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

function weiToEth(wei: string): number {
  return Number(wei) / 1e18
}

type EvmLog = {
  data: string
  topics: string[]
  transactionHash: string
}

type DecodedPaymentSplitLog = {
  merchantAmount: bigint
  feeAmount: bigint
  paymentRef: string
  token: string
}

async function getContractEventLogs(
  rpcUrl: string,
  contractAddress: string,
  topic: string,
  fromBlock: string
): Promise<EvmLog[]> {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getLogs",
        params: [{
          address: contractAddress,
          topics: [topic],
          fromBlock,
          toBlock: "latest"
        }],
        id: 1
      })
    })
    const data = await response.json()
    if (data?.error) {
      console.warn("[watcher:evm] eth_getLogs rpc error", { rpcError: data.error })
      return []
    }
    if (!Array.isArray(data?.result)) return []
    return data.result as EvmLog[]
  } catch (error) {
    console.error("[watcher:evm] eth_getLogs request failed", {
      error: error instanceof Error ? error.message : String(error)
    })
    return []
  }
}

function decodePaymentSplitLog(data: string): DecodedPaymentSplitLog | null {
  try {
    // Non-indexed params order: uint256 merchantAmount, uint256 feeAmount, string paymentRef, address token
    const decoded = AbiCoder.defaultAbiCoder().decode(
      ["uint256", "uint256", "string", "address"],
      data
    )
    return {
      merchantAmount: decoded[0] as bigint,
      feeAmount: decoded[1] as bigint,
      paymentRef: decoded[2] as string,
      token: decoded[3] as string
    }
  } catch {
    return null
  }
}

async function getSolanaSignatures(
  rpcUrl: string,
  address: string,
  sinceSlot: number
): Promise<string[]> {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "getSignaturesForAddress",
        params: [address, { minContextSlot: sinceSlot, limit: 100 }],
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

async function getSolanaParsedTransaction(
  rpcUrl: string,
  signature: string
): Promise<SolanaParsedTransaction | null> {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "getTransaction",
        params: [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
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

/**
 * Find a Solana transaction that splits to both the merchant and PineTree wallets
 * AND contains a memo instruction matching the expected paymentId.
 *
 * Matching criteria (all must be satisfied):
 *   1. Signature appears in BOTH merchant wallet AND treasury wallet history
 *   2. Transfer to merchant wallet ≥ expectedMerchantLamports × matchRatio
 *   3. Transfer to treasury wallet ≥ expectedFeeLamports × matchRatio
 *   4. Memo instruction content === paymentId
 *
 * Criterion 4 prevents false positives where two concurrent unrelated payments
 * happen to overlap on the same wallets within the lookback window.
 */
async function findMatchingSolanaSplitTransaction(input: {
  rpcUrl: string
  merchantWallet: string
  pinetreeWallet: string
  sinceSlot: number
  expectedMerchantLamports: number
  expectedFeeLamports: number
  matchRatio: number
  paymentId: string
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
    let memoMatches = false

    for (const ix of instructions) {
      // Memo program instruction: programId matches and parsed is a plain string
      if (
        ix.programId === SOLANA_MEMO_PROGRAM_ID &&
        typeof ix.parsed === "string"
      ) {
        memoMatches = ix.parsed === input.paymentId
        continue
      }

      // System program transfer instruction: parsed is an object with type/info
      const parsed = ix?.parsed
      if (!parsed || typeof parsed === "string" || parsed.type !== "transfer") continue

      const info = parsed.info || {}
      const destination = String(info.destination || "").toLowerCase()
      const lamports = Number(info.lamports || 0)
      const from = String(info.source || "")

      if (!source && from) source = from

      if (
        destination === input.merchantWallet.toLowerCase() ||
        destination === input.merchantWallet
      ) {
        merchantLamports += lamports
      }

      if (
        destination === input.pinetreeWallet.toLowerCase() ||
        destination === input.pinetreeWallet
      ) {
        feeLamports += lamports
      }
    }

    // Require the on-chain memo to match the expected paymentId.
    // This prevents false matches from amount-only coincidence.
    if (!memoMatches) {
      console.info("[watcher:solana] signature missing required payment reference memo", {
        signature,
        paymentId: input.paymentId
      })
      continue
    }

    const merchantThreshold =
      input.expectedMerchantLamports > 0 ? input.expectedMerchantLamports * input.matchRatio : 0
    const feeThreshold =
      input.expectedFeeLamports > 0 ? input.expectedFeeLamports * input.matchRatio : 0

    if (merchantLamports >= merchantThreshold && feeLamports >= feeThreshold) {
      return { hash: signature, from: source, totalLamports: merchantLamports + feeLamports }
    }

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

  console.info("[watcher:solana] candidate signatures did not meet split thresholds", {
    merchantAddress: input.merchantWallet,
    treasuryAddress: input.pinetreeWallet,
    candidateCount: candidateSignatures.length,
    expectedMerchantLamports: input.expectedMerchantLamports,
    expectedFeeLamports: input.expectedFeeLamports
  })

  return null
}
