#!/usr/bin/env node

import fs from "node:fs"
import { createClient } from "@supabase/supabase-js"
import { AbiCoder, id } from "ethers"

for (const file of [".env.local", ".env"]) {
  if (!fs.existsSync(file)) continue
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match || process.env[match[1]]) continue
    let value = match[2]
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[match[1]] = value
  }
}

const paymentId = String(process.argv[2] || "").trim()
const apply = process.argv.includes("--apply")
if (!paymentId) {
  console.error("Usage: node scripts/reconcile-base-payment.mjs <paymentId> [--apply]")
  process.exit(1)
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!supabaseUrl || !supabaseKey) throw new Error("Missing Supabase environment")

const supabase = createClient(supabaseUrl, supabaseKey)
const rpcCandidates = [
  process.env.BASE_RPC_URL,
  process.env.ALCHEMY_API_KEY
    ? `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
    : "",
  "https://mainnet.base.org"
].filter(Boolean)
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
const PAYMENT_SPLIT_TOPIC = id("PaymentSplit(address,address,uint256,uint256,string,address,address)")
const TRANSFER_TOPIC = id("Transfer(address,address,uint256)")

function mask(value) {
  const normalized = String(value || "")
  if (/^0x[a-fA-F0-9]{64}$/.test(normalized)) return `${normalized.slice(0, 10)}...${normalized.slice(-8)}`
  if (/^0x[a-fA-F0-9]{40}$/.test(normalized)) return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`
  return normalized || null
}

function topicAddress(topic) {
  const normalized = String(topic || "").toLowerCase()
  return normalized.length >= 42 ? `0x${normalized.slice(-40)}` : ""
}

async function rpcAt(rpcUrl, method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  })
  const data = await response.json()
  if (data?.error) throw new Error(`${method} RPC error: ${JSON.stringify(data.error)}`)
  return data.result
}

let selectedRpcUrl = null
async function rpc(method, params) {
  if (selectedRpcUrl) return rpcAt(selectedRpcUrl, method, params)
  let lastError = null
  for (const candidate of rpcCandidates) {
    try {
      await rpcAt(candidate, "eth_blockNumber", [])
      selectedRpcUrl = candidate
      return rpcAt(candidate, method, params)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error("No usable Base RPC endpoint")
}

const { data: payment, error: paymentError } = await supabase
  .from("payments")
  .select("*")
  .eq("id", paymentId)
  .maybeSingle()
if (paymentError) throw new Error(paymentError.message)
if (!payment) throw new Error("Payment not found")

const { data: transaction } = await supabase
  .from("transactions")
  .select("*")
  .eq("payment_id", paymentId)
  .maybeSingle()

const split = payment.metadata?.split || {}
const txHash = String(transaction?.provider_transaction_id || "").trim()
const evidence = {
  paymentId,
  status: payment.status,
  transactionStatus: transaction?.status || null,
  providerTransactionId: mask(txHash),
  splitContract: mask(split.splitContract),
  merchantWallet: mask(split.merchantWallet),
  pineTreeWallet: mask(split.pinetreeWallet),
  expectedMerchantAmountAtomic: split.merchantNativeAmountAtomic || split.expectedMerchantAtomic || null,
  expectedFeeAmountAtomic: split.feeNativeAmountAtomic || split.expectedFeeAtomic || null,
  chain: null
}

if (/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
  const [chainTx, receipt] = await Promise.all([
    rpc("eth_getTransactionByHash", [txHash]),
    rpc("eth_getTransactionReceipt", [txHash])
  ])
  const logs = Array.isArray(receipt?.logs) ? receipt.logs : []
  const transferLogs = logs.filter(
    (log) =>
      String(log.address || "").toLowerCase() === USDC &&
      String(log.topics?.[0] || "").toLowerCase() === TRANSFER_TOPIC.toLowerCase()
  )
  const splitLogs = logs.flatMap((log) => {
    if (
      String(log.address || "").toLowerCase() !== String(split.splitContract || "").toLowerCase() ||
      String(log.topics?.[0] || "").toLowerCase() !== PAYMENT_SPLIT_TOPIC.toLowerCase()
    ) {
      return []
    }
    try {
      const decoded = AbiCoder.defaultAbiCoder().decode(
        ["uint256", "uint256", "string", "address"],
        log.data
      )
      return [{
        txHash: mask(log.transactionHash),
        merchantAmount: String(decoded[0]),
        feeAmount: String(decoded[1]),
        paymentRef: String(decoded[2]),
        token: mask(String(decoded[3])),
        payer: mask(topicAddress(log.topics?.[3]))
      }]
    } catch {
      return [{ txHash: mask(log.transactionHash), decodeError: true }]
    }
  })
  evidence.chain = {
    txTo: mask(chainTx?.to),
    txFrom: mask(chainTx?.from),
    selector: String(chainTx?.input || "").slice(0, 10),
    receiptStatus: receipt?.status || null,
    blockNumber: receipt?.blockNumber || null,
    gasUsed: receipt?.gasUsed || null,
    logsCount: logs.length,
    splitLogs,
    transfers: transferLogs.map((log) => ({
      txHash: mask(log.transactionHash),
      from: mask(topicAddress(log.topics?.[1])),
      to: mask(topicAddress(log.topics?.[2])),
      amount: String(BigInt(log.data))
    }))
  }
}

console.log(JSON.stringify({ dryRun: !apply, evidence }, null, 2))

if (apply) {
  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "")
  const secret = process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET
  if (!appUrl || !secret) {
    throw new Error("Applying requires NEXT_PUBLIC_APP_URL and CRON_SECRET or INTERNAL_API_SECRET")
  }
  const response = await fetch(`${appUrl}/api/internal/base-payments/${encodeURIComponent(paymentId)}/reconcile`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ timeoutMs: 8000 })
  })
  const body = await response.json().catch(() => null)
  console.log(JSON.stringify({ applied: response.ok, status: response.status, result: body }, null, 2))
}
