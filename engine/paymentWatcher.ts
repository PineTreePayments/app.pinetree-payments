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
 * Callers   : app/api/cron/check-payments/route.ts → direct call
 *             engine/checkPaymentOnce.ts
 */

import { getRpcUrl } from "./config"
import { processPaymentEvent } from "./eventProcessor"
import { id as ethersId, AbiCoder } from "ethers"

// Solana Memo Program ID — same constant used in solanaSplitTransaction.ts
const SOLANA_MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
const USDC_MINT_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

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
  asset?: string
  txHash?: string
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

type EvmReceiptLog = {
  address: string
  data: string
  topics: string[]
  transactionHash: string
}

type EvmTransactionReceipt = {
  logs: EvmReceiptLog[]
  status?: string
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

type SolanaTokenBalance = {
  accountIndex: number
  mint: string
  uiTokenAmount: {
    amount: string
  }
  owner?: string
}

type SolanaParsedTransaction = {
  transaction?: {
    message?: {
      instructions?: SolanaParsedInstruction[]
    }
  }
  meta?: {
    preTokenBalances?: SolanaTokenBalance[]
    postTokenBalances?: SolanaTokenBalance[]
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
  // Solana: 1500 slots ≈ 10 minutes — safely covers a 5-min cron interval with overlap.
  // EVM: 300 blocks ≈ 10 minutes on Base (2-s block time) — covers 1-min cron with 10× overlap.
  const defaultValue = normalized === "solana" ? 1500 : 300
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
 *   4. If a matching transaction is found, emit a payment.processing event to the
 *      engine and return true.
 *   5. If no match is found, return false immediately.
 *
 * The block-range iteration in step 3 is bounded and finite — it walks over
 * blocks that are already on chain. It does NOT poll for future blocks.
 *
 * @returns true  if a matching transaction was detected during this check.
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
    const isUsdc = String(input.asset || "").toUpperCase() === "USDC"

    // ── txHash fast-path ────────────────────────────────────────────────────
    // When the UI passes a signature immediately after signing, skip the full
    // getSignaturesForAddress scan (which only returns finalized transactions)
    // and check the specific transaction directly. Falls through to the full
    // scan if the transaction isn't available yet or validation fails.
    if (input.txHash) {
      try {
        const tx = await getSolanaParsedTransaction(rpcUrl, input.txHash)
        if (tx) {
          if (isUsdc) {
            const match = parseSolanaUsdcSplitTx(tx, {
              merchantWallet,
              pinetreeWallet,
              expectedMerchantAtomic: Number(input.expectedMerchantAtomic || 0),
              expectedFeeAtomic: Number(input.expectedFeeAtomic || 0),
              matchRatio,
              paymentId: input.paymentId,
            })
            if (match) {
              console.log("[SOLANA] USDC payment detected via txHash fast-path", {
                paymentId: input.paymentId,
                txHash: input.txHash,
              })
              return handleMatchingTransaction(
                input.paymentId,
                { hash: input.txHash, value: match.totalAtomic.toString(), from: match.from },
                true
              )
            }
          } else {
            const match = parseSolanaSplitTx(tx, {
              merchantWallet,
              pinetreeWallet,
              expectedMerchantLamports: Number(input.expectedMerchantAtomic || 0),
              expectedFeeLamports: Number(input.expectedFeeAtomic || 0),
              matchRatio,
              paymentId: input.paymentId,
            })
            if (match) {
              console.log("[SOLANA] payment detected via txHash fast-path", {
                paymentId: input.paymentId,
                txHash: input.txHash,
              })
              return handleMatchingTransaction(
                input.paymentId,
                { hash: input.txHash, value: String(match.totalLamports / 1e9), from: match.from },
                true
              )
            }
          }
        }
      } catch (err) {
        console.error("[watcher:solana] txHash fast-path failed, falling through to scan:", err)
      }
    }

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

    if (isUsdc) {
      const splitTx = await findMatchingSolanaUsdcSplitTransaction({
        rpcUrl,
        merchantWallet,
        pinetreeWallet,
        sinceSlot,
        expectedMerchantAtomic: Number(input.expectedMerchantAtomic || 0),
        expectedFeeAtomic: Number(input.expectedFeeAtomic || 0),
        matchRatio,
        paymentId: input.paymentId
      })

      if (!splitTx) return false

      console.log("[SOLANA] USDC payment detected", {
        paymentId: input.paymentId,
        signature: splitTx.hash
      })

      return handleMatchingTransaction(
        input.paymentId,
        { hash: splitTx.hash, value: splitTx.totalAtomic.toString(), from: splitTx.from },
        true // fee capture validated for Solana split
      )
    }

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

    console.log("[SOLANA] payment detected", {
      paymentId: input.paymentId,
      signature: splitTx.hash
    })

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

  // ── contract_split: query PaymentSplit event logs ────────────────────────────
  if (feeCaptureMethod === "contract_split") {
    if (!splitContractEvm) {
      console.warn("[watcher:evm] missing split contract for contract_split payment", {
        paymentId: input.paymentId
      })
      return false
    }

    // txHash-first: check the exact transaction receipt instead of scanning all logs.
    // This path is taken when detect is called after on-chain confirmation (receipt known).
    if (input.txHash) {
      const receipt = await getTransactionReceipt(rpcUrl, input.txHash)

      if (!receipt) {
        console.info("[watcher:evm] txHash receipt not yet available", {
          paymentId: input.paymentId,
          txHash: input.txHash
        })
        return false
      }

      const matchingLog = receipt.logs.find(
        (log) =>
          log.address.toLowerCase() === splitContractEvm &&
          log.topics[0] === PAYMENT_SPLIT_TOPIC
      )

      if (!matchingLog) {
        console.info("[watcher:evm] txHash receipt has no PaymentSplit log for this contract", {
          paymentId: input.paymentId,
          txHash: input.txHash,
          contractAddress: splitContractEvm
        })
        return false
      }

      const decoded = decodePaymentSplitLog(matchingLog.data)
      if (!decoded) return false

      if (decoded.paymentRef !== input.paymentId) {
        console.info("[watcher:evm] txHash receipt PaymentSplit log paymentRef mismatch", {
          paymentId: input.paymentId,
          paymentRef: decoded.paymentRef,
          txHash: input.txHash
        })
        return false
      }

      const merchantAmountNum = Number(decoded.merchantAmount)
      const feeAmountNum = Number(decoded.feeAmount)
      const expectedMerchantNum = Number(input.expectedMerchantAtomic || 0)
      const expectedFeeNum = Number(input.expectedFeeAtomic || 0)
      const merchantThreshold = expectedMerchantNum > 0 ? expectedMerchantNum * matchRatio : 0
      const feeThreshold = expectedFeeNum > 0 ? expectedFeeNum * matchRatio : 0

      if (merchantAmountNum < merchantThreshold || feeAmountNum < feeThreshold) {
        console.info("[watcher:evm] txHash receipt PaymentSplit amounts below threshold", {
          paymentId: input.paymentId,
          txHash: input.txHash,
          merchantAmount: merchantAmountNum,
          expectedMerchant: expectedMerchantNum,
          merchantThreshold,
          feeAmount: feeAmountNum,
          expectedFee: expectedFeeNum,
          feeThreshold
        })
        return false
      }

      const payerTopic = String(matchingLog.topics[3] || "")
      const payer = payerTopic.length >= 42 ? "0x" + payerTopic.slice(-40) : "unknown"
      const totalAtomic = String(merchantAmountNum + feeAmountNum)

      console.info("[watcher:evm] txHash receipt PaymentSplit matched — both legs validated", {
        paymentId: input.paymentId,
        txHash: input.txHash,
        payer,
        merchantAmount: merchantAmountNum,
        feeAmount: feeAmountNum
      })

      return handleMatchingTransaction(
        input.paymentId,
        { hash: input.txHash, value: totalAtomic, from: payer },
        true
      )
    }

    // fallback: broad eth_getLogs scan (cron / webhook paths, no txHash available)
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

      // Validate both legs against expected amounts before accepting this event.
      // The contract emits amounts in the token's atomic unit (Wei for ETH).
      // expectedMerchantAtomic / expectedFeeAtomic are stored in the same unit.
      const merchantAmountNum = Number(decoded.merchantAmount)
      const feeAmountNum = Number(decoded.feeAmount)
      const expectedMerchantNum = Number(input.expectedMerchantAtomic || 0)
      const expectedFeeNum = Number(input.expectedFeeAtomic || 0)
      const merchantThreshold = expectedMerchantNum > 0 ? expectedMerchantNum * matchRatio : 0
      const feeThreshold = expectedFeeNum > 0 ? expectedFeeNum * matchRatio : 0

      if (merchantAmountNum < merchantThreshold || feeAmountNum < feeThreshold) {
        console.info("[watcher:evm] PaymentSplit event amounts below threshold", {
          paymentId: input.paymentId,
          txHash: log.transactionHash,
          merchantAmount: merchantAmountNum,
          expectedMerchant: expectedMerchantNum,
          merchantThreshold,
          feeAmount: feeAmountNum,
          expectedFee: expectedFeeNum,
          feeThreshold
        })
        continue
      }

      // payer is topics[3] (indexed) — last 20 bytes = 40 hex chars
      const payerTopic = String(log.topics[3] || "")
      const payer = payerTopic.length >= 42 ? "0x" + payerTopic.slice(-40) : "unknown"

      console.info("[watcher:evm] PaymentSplit event matched — both legs validated", {
        paymentId: input.paymentId,
        txHash: log.transactionHash,
        payer,
        token: decoded.token,
        merchantAmount: merchantAmountNum,
        feeAmount: feeAmountNum
      })

      // Pass total atomic value (merchant + fee) for audit trail.
      // feeCaptureValidated: true because both legs are on-chain and validated above.
      const totalAtomic = String(merchantAmountNum + feeAmountNum)
      const detected = await handleMatchingTransaction(
        input.paymentId,
        { hash: log.transactionHash, value: totalAtomic, from: payer },
        true
      )
      if (detected) return true
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
      // Direct mode: a single full-amount transfer to the merchant wallet is the
      // complete on-chain proof for this payment.  updatePaymentStatus auto-validates
      // feeCaptureMethod === "direct", so we emit payment.confirmed immediately rather
      // than stopping at payment.processing (which has no follow-up confirmation path).
      const detected = await handleMatchingTransaction(input.paymentId, tx, true)
      if (detected) return true
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

// ─── Engine handoff ───────────────────────────────────────────────────────────

/**
 * Hand a detected transaction off to the engine's event processor.
 *
 * The watcher's only responsibility is detection and matching. All state
 * transitions and DB writes belong to the engine via processPaymentEvent.
 *
 * feeCaptureValidated: true  → both merchant and fee legs were verified on-chain
 *                              → emit payment.confirmed so the engine can finalize
 * feeCaptureValidated: false → only a single transfer was detected (direct payment)
 *                              → emit payment.processing; engine awaits full confirmation
 */
async function handleMatchingTransaction(
  paymentId: string,
  tx: { hash: string; value: string; from: string },
  feeCaptureValidated: boolean
): Promise<boolean> {
  await processPaymentEvent({
    type: feeCaptureValidated ? "payment.confirmed" : "payment.processing",
    paymentId,
    txHash: tx.hash,
    value: tx.value,
    from: tx.from,
    feeCaptureValidated
  })

  return true
}

// ─── RPC helpers ─────────────────────────────────────────────────────────────

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

async function getTransactionReceipt(rpcUrl: string, txHash: string): Promise<EvmTransactionReceipt | null> {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getTransactionReceipt",
        params: [txHash],
        id: 1
      })
    })
    const data = await response.json()
    if (data?.error) {
      console.warn("[watcher:evm] eth_getTransactionReceipt rpc error", { txHash, rpcError: data.error })
      return null
    }
    return (data?.result || null) as EvmTransactionReceipt | null
  } catch (error) {
    console.error("[watcher:evm] eth_getTransactionReceipt request failed", {
      txHash,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
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

/**
 * Validate a single parsed Solana transaction against the expected payment split.
 * Returns { from, totalLamports } on match, null otherwise.
 * Used by both the txHash fast-path and the full signature scan.
 */
function parseSolanaSplitTx(
  tx: SolanaParsedTransaction,
  params: {
    merchantWallet: string
    pinetreeWallet: string
    expectedMerchantLamports: number
    expectedFeeLamports: number
    matchRatio: number
    paymentId: string
  }
): { from: string; totalLamports: number } | null {
  const instructions = tx?.transaction?.message?.instructions
  if (!Array.isArray(instructions)) return null

  let merchantLamports = 0
  let feeLamports = 0
  let source = ""
  let memoMatches = false

  for (const ix of instructions) {
    if (ix.programId === SOLANA_MEMO_PROGRAM_ID && typeof ix.parsed === "string") {
      memoMatches = ix.parsed.trim() === params.paymentId.trim()
      continue
    }

    const parsed = ix?.parsed
    if (!parsed || typeof parsed === "string" || parsed.type !== "transfer") continue

    const info = parsed.info || {}
    const destination = String(info.destination || "").toLowerCase()
    const lamports = Number(info.lamports || 0)
    const from = String(info.source || "")

    if (!source && from) source = from

    if (destination === params.merchantWallet.toLowerCase()) merchantLamports += lamports
    if (destination === params.pinetreeWallet.toLowerCase()) feeLamports += lamports
  }

  if (!memoMatches) return null

  const merchantThreshold =
    params.expectedMerchantLamports > 0 ? params.expectedMerchantLamports * params.matchRatio : 0
  const feeThreshold =
    params.expectedFeeLamports > 0 ? params.expectedFeeLamports * params.matchRatio : 0

  if (merchantLamports >= merchantThreshold && feeLamports >= feeThreshold) {
    return { from: source, totalLamports: merchantLamports + feeLamports }
  }

  return null
}

/**
 * Validate a single parsed Solana transaction for a USDC SPL split.
 *
 * SPL token transfers are validated from token balance deltas rather than native
 * System Program transfer instructions. The receiver accounts are matched by
 * token-account owner, while the USDC mint filters out unrelated token movement.
 */
function parseSolanaUsdcSplitTx(
  tx: SolanaParsedTransaction,
  params: {
    merchantWallet: string
    pinetreeWallet: string
    expectedMerchantAtomic: number
    expectedFeeAtomic: number
    matchRatio: number
    paymentId: string
  }
): { from: string; totalAtomic: number } | null {
  const instructions = tx?.transaction?.message?.instructions
  if (!Array.isArray(instructions)) return null

  let memoMatches = false
  for (const ix of instructions) {
    if (ix.programId === SOLANA_MEMO_PROGRAM_ID && typeof ix.parsed === "string") {
      memoMatches = ix.parsed.trim() === params.paymentId.trim()
      break
    }
  }

  if (!memoMatches) return null

  const preBalances = tx.meta?.preTokenBalances
  const postBalances = tx.meta?.postTokenBalances
  if (!Array.isArray(preBalances) || !Array.isArray(postBalances)) return null

  const preByAccount = new Map<number, SolanaTokenBalance>()
  const postByAccount = new Map<number, SolanaTokenBalance>()

  for (const balance of preBalances) {
    if (String(balance.mint || "") === USDC_MINT_ADDRESS) {
      preByAccount.set(balance.accountIndex, balance)
    }
  }

  for (const balance of postBalances) {
    if (String(balance.mint || "") === USDC_MINT_ADDRESS) {
      postByAccount.set(balance.accountIndex, balance)
    }
  }

  const accountIndexes = new Set<number>([
    ...Array.from(preByAccount.keys()),
    ...Array.from(postByAccount.keys())
  ])

  let merchantAtomic = 0
  let feeAtomic = 0
  let source = ""

  for (const accountIndex of accountIndexes) {
    const pre = preByAccount.get(accountIndex)
    const post = postByAccount.get(accountIndex)
    const owner = String(post?.owner || pre?.owner || "").trim()
    const preAmount = Number(pre?.uiTokenAmount?.amount || 0)
    const postAmount = Number(post?.uiTokenAmount?.amount || 0)
    const delta = postAmount - preAmount

    if (delta > 0 && owner === params.merchantWallet) {
      merchantAtomic += delta
    }

    if (delta > 0 && owner === params.pinetreeWallet) {
      feeAtomic += delta
    }

    if (delta < 0 && !source && owner) {
      source = owner
    }
  }

  const merchantThreshold =
    params.expectedMerchantAtomic > 0 ? params.expectedMerchantAtomic * params.matchRatio : 0
  const feeThreshold =
    params.expectedFeeAtomic > 0 ? params.expectedFeeAtomic * params.matchRatio : 0

  if (merchantAtomic >= merchantThreshold && feeAtomic >= feeThreshold) {
    return { from: source, totalAtomic: merchantAtomic + feeAtomic }
  }

  return null
}

async function findMatchingSolanaUsdcSplitTransaction(input: {
  rpcUrl: string
  merchantWallet: string
  pinetreeWallet: string
  sinceSlot: number
  expectedMerchantAtomic: number
  expectedFeeAtomic: number
  matchRatio: number
  paymentId: string
}): Promise<{ hash: string; from: string; totalAtomic: number } | null> {
  const [merchantSignatures, treasurySignatures] = await Promise.all([
    getSolanaSignatures(input.rpcUrl, input.merchantWallet, input.sinceSlot),
    getSolanaSignatures(input.rpcUrl, input.pinetreeWallet, input.sinceSlot)
  ])

  if (!merchantSignatures.length || !treasurySignatures.length) {
    console.info("[watcher:solana] no signatures found for USDC split detection", {
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
    console.info("[watcher:solana] no overlapping signatures for USDC split detection", {
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
    if (!tx) continue

    const match = parseSolanaUsdcSplitTx(tx, {
      merchantWallet: input.merchantWallet,
      pinetreeWallet: input.pinetreeWallet,
      expectedMerchantAtomic: input.expectedMerchantAtomic,
      expectedFeeAtomic: input.expectedFeeAtomic,
      matchRatio: input.matchRatio,
      paymentId: input.paymentId
    })

    if (match) {
      return { hash: signature, from: match.from, totalAtomic: match.totalAtomic }
    }

    console.info("[watcher:solana] USDC signature did not match split requirements", {
      signature,
      paymentId: input.paymentId,
      expectedMerchantAtomic: input.expectedMerchantAtomic,
      expectedFeeAtomic: input.expectedFeeAtomic,
      matchRatio: input.matchRatio
    })
  }

  console.info("[watcher:solana] candidate signatures did not meet USDC split thresholds", {
    merchantAddress: input.merchantWallet,
    treasuryAddress: input.pinetreeWallet,
    candidateCount: candidateSignatures.length,
    expectedMerchantAtomic: input.expectedMerchantAtomic,
    expectedFeeAtomic: input.expectedFeeAtomic
  })

  return null
}

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
    let memoObserved = ""

    for (const ix of instructions) {
      // Memo program instruction: programId matches and parsed is a plain string.
      // Trim both sides — some RPC providers pad the memo with whitespace.
      if (
        ix.programId === SOLANA_MEMO_PROGRAM_ID &&
        typeof ix.parsed === "string"
      ) {
        memoObserved = ix.parsed.trim()
        memoMatches = memoObserved === input.paymentId.trim()
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
      if (memoObserved) {
        console.warn("[SOLANA] reference mismatch", {
          expected: input.paymentId,
          observed: memoObserved,
          signature
        })
      }
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
