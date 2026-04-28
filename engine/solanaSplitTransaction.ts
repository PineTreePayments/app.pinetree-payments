import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction
} from "@solana/web3.js"
import { getPaymentById } from "@/database/payments"
import { getRpcUrl } from "@/engine/config"
import { normalizeToStrictPaymentStatus } from "./paymentStateMachine"

// Solana Memo Program — used to attach a deterministic payment reference on-chain.
// The watcher reads this back to guarantee payment identity before confirming.
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")
const SYSTEM_PROGRAM_ADDRESS = SystemProgram.programId.toBase58()

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

  console.log("[SOLANA ENGINE][TX] build request", {
    paymentId,
    senderAccount
  })

  if (!paymentId) {
    throw new Error("Missing paymentId")
  }

  if (!senderAccount) {
    throw new Error("Missing sender account")
  }

  if (senderAccount === SYSTEM_PROGRAM_ADDRESS) {
    console.error("[SOLANA ENGINE][TX] invalid payer account", {
      paymentId,
      senderAccount
    })
    throw new Error("Invalid payer account")
  }

  let payerPublicKey: PublicKey
  try {
    payerPublicKey = new PublicKey(senderAccount)
  } catch {
    console.error("[SOLANA ENGINE][TX] invalid payer account", {
      paymentId,
      senderAccount
    })
    throw new Error("Invalid payer account")
  }

  const payment = await getPaymentById(paymentId)
  if (!payment) {
    console.error("[SOLANA ENGINE][TX] payment not found", { paymentId })
    throw new Error("Payment not found")
  }

  console.log("[SOLANA ENGINE][TX] payment lookup success", {
    paymentId,
    status: payment.status,
    network: payment.network,
    hasMetadata: Boolean(payment.metadata)
  })

  const network = String(payment.network || "").toLowerCase()
  if (network !== "solana") {
    console.error("[SOLANA ENGINE][TX] wrong network", { paymentId, network })
    throw new Error("Payment is not Solana network")
  }

  const status = normalizeToStrictPaymentStatus(payment.status)
  if (status === "CONFIRMED" || status === "FAILED" || status === "INCOMPLETE") {
    console.error("[SOLANA ENGINE][TX] terminal payment rejected", { paymentId, status })
    throw new Error("Payment is no longer payable")
  }

  const metadata = (payment.metadata || {}) as {
    selectedAsset?: string
    split?: {
      merchantWallet?: string
      pinetreeWallet?: string
      merchantNativeAmountAtomic?: number
      feeNativeAmountAtomic?: number
    }
  }

  const selectedAsset = String(metadata.selectedAsset || "SOL").trim().toUpperCase()
  if (selectedAsset !== "SOL") {
    console.error("[SOLANA ENGINE][TX] unsupported asset", { paymentId, selectedAsset })
    throw new Error("Unsupported Solana asset")
  }

  const split = metadata.split
  const merchantWallet = String(split?.merchantWallet || "").trim()
  const pinetreeWallet = String(split?.pinetreeWallet || "").trim()

  if (!merchantWallet || !pinetreeWallet) {
    console.error("[SOLANA ENGINE][TX] missing split wallet metadata", {
      paymentId,
      hasMerchantWallet: Boolean(merchantWallet),
      hasPinetreeWallet: Boolean(pinetreeWallet)
    })
    throw new Error("Missing split wallet metadata")
  }

  const merchantLamports = toLamportsFromAtomic(split?.merchantNativeAmountAtomic)
  const feeLamports = toLamportsFromAtomic(split?.feeNativeAmountAtomic)

  console.log("[SOLANA ENGINE][TX] split resolved", {
    paymentId,
    senderAccount,
    merchantWallet,
    pinetreeWallet,
    merchantLamports,
    feeLamports,
    selectedAsset
  })

  const rpcUrl = getRpcUrl("solana")
  const connection = new Connection(rpcUrl, "confirmed")
  const { blockhash } = await connection.getLatestBlockhash("confirmed")
  console.log("[SOLANA ENGINE][TX] blockhash resolved", {
    paymentId,
    blockhash
  })

  const tx = new Transaction({
    feePayer: payerPublicKey,
    recentBlockhash: blockhash
  })

  tx.add(
    SystemProgram.transfer({
      fromPubkey: payerPublicKey,
      toPubkey: new PublicKey(merchantWallet),
      lamports: merchantLamports
    }),
    SystemProgram.transfer({
      fromPubkey: payerPublicKey,
      toPubkey: new PublicKey(pinetreeWallet),
      lamports: feeLamports
    }),
    // Attach the PineTree paymentId as an on-chain memo so the watcher can
    // verify the reference deterministically rather than relying on amounts alone.
    new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(paymentId, "utf8")
    })
  )

  console.log("[SOLANA ENGINE][TX] transaction built", {
    paymentId,
    feePayer: tx.feePayer?.toBase58(),
    recentBlockhash: tx.recentBlockhash,
    instructionCount: tx.instructions.length,
    instructions: tx.instructions.map((instruction, index) => ({
      index,
      programId: instruction.programId.toBase58(),
      keyCount: instruction.keys.length,
      dataLength: instruction.data.length
    }))
  })

  const serialized = tx.serialize({ requireAllSignatures: false }).toString("base64")
  console.log("[SOLANA ENGINE][TX] serialized transaction", {
    paymentId,
    feePayer: tx.feePayer?.toBase58(),
    recentBlockhash: tx.recentBlockhash,
    instructionCount: tx.instructions.length,
    base64Length: serialized.length
  })

  return serialized
}

export async function getSolanaUnsignedTransaction(input: {
  paymentId: string
  senderAccount: string
}): Promise<string> {
  return buildSolanaSplitTransactionEngine(input)
}
