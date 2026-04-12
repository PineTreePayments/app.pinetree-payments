import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js"
import { getPaymentById } from "@/database/payments"

function getRequiredEnv(name: string): string {
  const value = String(process.env[name] || "").trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function toLamportsFromAtomic(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("Invalid lamport amount in payment split metadata")
  }
  return Math.round(n)
}

export async function buildSolanaSplitTransactionEngine(input: {
  paymentId: string
  senderAccount: string
}) {
  const paymentId = String(input.paymentId || "").trim()
  const senderAccount = String(input.senderAccount || "").trim()

  if (!paymentId) {
    throw new Error("Missing paymentId")
  }

  if (!senderAccount) {
    throw new Error("Missing sender account")
  }

  const payment = await getPaymentById(paymentId)
  if (!payment) {
    throw new Error("Payment not found")
  }

  const network = String(payment.network || "").toLowerCase()
  if (network !== "solana") {
    throw new Error("Payment is not Solana network")
  }

  const metadata = (payment.metadata || {}) as {
    split?: {
      merchantWallet?: string
      pinetreeWallet?: string
      merchantNativeAmountAtomic?: number
      feeNativeAmountAtomic?: number
    }
  }

  const split = metadata.split
  const merchantWallet = String(split?.merchantWallet || "").trim()
  const pinetreeWallet = String(split?.pinetreeWallet || "").trim()

  if (!merchantWallet || !pinetreeWallet) {
    throw new Error("Missing split wallet metadata")
  }

  const merchantLamports = toLamportsFromAtomic(split?.merchantNativeAmountAtomic)
  const feeLamports = toLamportsFromAtomic(split?.feeNativeAmountAtomic)

  const rpcUrl = getRequiredEnv("SOLANA_RPC_URL")
  const connection = new Connection(rpcUrl, "confirmed")
  const { blockhash } = await connection.getLatestBlockhash("confirmed")

  const tx = new Transaction({
    feePayer: new PublicKey(senderAccount),
    recentBlockhash: blockhash
  })

  tx.add(
    SystemProgram.transfer({
      fromPubkey: new PublicKey(senderAccount),
      toPubkey: new PublicKey(merchantWallet),
      lamports: merchantLamports
    }),
    SystemProgram.transfer({
      fromPubkey: new PublicKey(senderAccount),
      toPubkey: new PublicKey(pinetreeWallet),
      lamports: feeLamports
    })
  )

  return tx.serialize({ requireAllSignatures: false }).toString("base64")
}