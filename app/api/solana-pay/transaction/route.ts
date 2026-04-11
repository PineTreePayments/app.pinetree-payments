import { NextRequest, NextResponse } from "next/server"
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

export async function POST(req: NextRequest) {
  try {
    const paymentId = String(req.nextUrl.searchParams.get("paymentId") || "").trim()
    if (!paymentId) {
      return NextResponse.json({ error: "Missing paymentId" }, { status: 400 })
    }

    const body = (await req.json()) as {
      account?: string
    }

    const senderAccount = String(body?.account || "").trim()
    if (!senderAccount) {
      return NextResponse.json({ error: "Missing sender account" }, { status: 400 })
    }

    const payment = await getPaymentById(paymentId)
    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 })
    }

    const network = String(payment.network || "").toLowerCase()
    if (network !== "solana") {
      return NextResponse.json({ error: "Payment is not Solana network" }, { status: 400 })
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
      return NextResponse.json({ error: "Missing split wallet metadata" }, { status: 500 })
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

    const serialized = tx.serialize({ requireAllSignatures: false }).toString("base64")

    return NextResponse.json({
      transaction: serialized,
      message: "Sign to complete split payment"
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build Solana split transaction"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
