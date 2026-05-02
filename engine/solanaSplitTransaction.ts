import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction
} from "@solana/web3.js"
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  getAccount
} from "@solana/spl-token"
import { getPaymentById } from "@/database/payments"
import { getRpcUrl } from "@/engine/config"
import { normalizeToStrictPaymentStatus } from "./paymentStateMachine"

// Solana Memo Program — used to attach a deterministic payment reference on-chain.
// The watcher reads this back to guarantee payment identity before confirming.
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")
const SYSTEM_PROGRAM_ADDRESS = SystemProgram.programId.toBase58()
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
const USDC_DECIMALS = 6
const USDC_BASE_UNITS = BigInt(1_000_000)

function toAtomicAmount(value: unknown, label: string): bigint {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid atomic amount for ${label} in payment split metadata`)
  }
  return BigInt(Math.round(n))
}

function formatUsdcAmount(amount: bigint): string {
  const whole = amount / USDC_BASE_UNITS
  const fraction = amount % USDC_BASE_UNITS
  const fractionText = fraction.toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "")
  return fractionText ? `${whole.toString()}.${fractionText}` : whole.toString()
}

async function assertConnectedWalletUsdcBalance(input: {
  connection: Connection
  senderAta: PublicKey
  payerPublicKey: PublicKey
  requiredAtomic: bigint
}) {
  let sourceAccount: Awaited<ReturnType<typeof getAccount>>

  try {
    sourceAccount = await getAccount(input.connection, input.senderAta, "confirmed")
  } catch {
    throw new Error("Connected wallet does not have a Solana USDC token account for PineTree USDC.")
  }

  if (!sourceAccount.mint.equals(USDC_MINT)) {
    throw new Error("Connected wallet USDC token account does not match PineTree Solana USDC mint.")
  }

  if (!sourceAccount.owner.equals(input.payerPublicKey)) {
    throw new Error("Connected wallet USDC token account is not owned by the connected wallet.")
  }

  if (sourceAccount.amount < input.requiredAtomic) {
    throw new Error(
      `Insufficient Solana USDC balance. Required ${formatUsdcAmount(input.requiredAtomic)} USDC, available ${formatUsdcAmount(sourceAccount.amount)} USDC.`
    )
  }
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
  if (selectedAsset !== "SOL" && selectedAsset !== "USDC") {
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

  const merchantAtomic = toAtomicAmount(split?.merchantNativeAmountAtomic, "merchant")
  const feeAtomic = toAtomicAmount(split?.feeNativeAmountAtomic, "fee")

  console.log("[SOLANA ENGINE][TX] split resolved", {
    paymentId,
    senderAccount,
    merchantWallet,
    pinetreeWallet,
    merchantAtomic: merchantAtomic.toString(),
    feeAtomic: feeAtomic.toString(),
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

  const memoInstruction = new TransactionInstruction({
    keys: [],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(paymentId, "utf8")
  })

  if (selectedAsset === "USDC") {
    const merchantPubkey = new PublicKey(merchantWallet)
    const pinetreePubkey = new PublicKey(pinetreeWallet)

    const [senderAta, merchantAta, pinetreeAta] = await Promise.all([
      getAssociatedTokenAddress(USDC_MINT, payerPublicKey),
      getAssociatedTokenAddress(USDC_MINT, merchantPubkey),
      getAssociatedTokenAddress(USDC_MINT, pinetreePubkey)
    ])

    await assertConnectedWalletUsdcBalance({
      connection,
      senderAta,
      payerPublicKey,
      requiredAtomic: merchantAtomic + feeAtomic
    })

    tx.add(
      // Idempotent ATA creation — no-op if account already exists.
      // Payer funds rent if the ATA needs to be created.
      createAssociatedTokenAccountIdempotentInstruction(
        payerPublicKey, merchantAta, merchantPubkey, USDC_MINT
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        payerPublicKey, pinetreeAta, pinetreePubkey, USDC_MINT
      ),
      createTransferInstruction(senderAta, merchantAta, payerPublicKey, merchantAtomic),
      createTransferInstruction(senderAta, pinetreeAta, payerPublicKey, feeAtomic),
      memoInstruction
    )
  } else {
    // SOL — native lamport transfers
    tx.add(
      SystemProgram.transfer({
        fromPubkey: payerPublicKey,
        toPubkey: new PublicKey(merchantWallet),
        lamports: Number(merchantAtomic)
      }),
      SystemProgram.transfer({
        fromPubkey: payerPublicKey,
        toPubkey: new PublicKey(pinetreeWallet),
        lamports: Number(feeAtomic)
      }),
      // Attach the PineTree paymentId as an on-chain memo so the watcher can
      // verify the reference deterministically rather than relying on amounts alone.
      memoInstruction
    )
  }

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
