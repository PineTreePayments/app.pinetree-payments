import { createPayment } from "@/engine/createPayment"
import { getMerchantTaxSettings } from "@/database/merchants"
import { hasAnyWalletConnected, selectBestWallet } from "@/database/merchantWallets"
import { getPaymentById, supabase, supabaseAdmin } from "@/database"
import { createPaymentIntentEngine } from "./paymentIntents"
import {
  normalizeWalletNetwork
} from "./providerMappings"
import { PINETREE_FEE } from "./config"
import { chooseBestAdapter } from "./providerSelector"
import { calculatePosTotals, type PosTotalBreakdown, type TerminalTaxConfig } from "./posTotals"

const db = supabaseAdmin || supabase

export type PosTerminalContext = {
  merchantId: string
  terminalId?: string
  preferredNetwork?: string
}

export type CreatePosPaymentInput = {
  amount: number
  currency?: string
  asset?: string
  idempotencyKey?: string
  terminal: PosTerminalContext
}

export type CreatePosPaymentResult = {
  paymentId: string
  intentId?: string
  provider: string
  state: "CREATED" | "PENDING" | "PROCESSING" | "CONFIRMED" | "FAILED" | "INCOMPLETE"
  paymentUrl: string
  qrCodeUrl: string
  nativeAmount?: number
  nativeSymbol?: string
  availableNetworks?: string[]
  routing?: {
    network: string
    walletId: string
    walletAddress: string
  }
  breakdown: {
    subtotalAmount: number
    taxAmount: number
    serviceFee: number
    grossAmount: number
    totalAmount: number
  }
}

async function resolvePosRouting(merchantId: string, networkHint?: string) {
  const preferredNetwork = normalizeWalletNetwork(networkHint) || undefined

  const wallet = await selectBestWallet(merchantId, preferredNetwork)
  if (!wallet) {
    const err = new Error("No wallet configured for merchant") as Error & { status?: number }
    err.status = 400
    throw err
  }

  const walletNetwork = normalizeWalletNetwork(wallet.network)
  if (!walletNetwork) {
    const err = new Error("Wallet network is not supported for POS") as Error & { status?: number }
    err.status = 400
    throw err
  }

  const adapterId = await chooseBestAdapter({
    merchantId,
    network: walletNetwork
  })

  if (!adapterId) {
    const err = new Error(`No compatible provider connected for wallet network: ${walletNetwork}`) as Error & {
      status?: number
    }
    err.status = 400
    throw err
  }

  return {
    adapterId,
    wallet,
    network: walletNetwork
  }
}

export async function calculatePosTotalsForTerminal(
  merchantId: string,
  terminalId: string,
  subtotalAmount: number
): Promise<PosTotalBreakdown> {
  const { data: terminal, error } = await db
    .from("terminals")
    .select("tax_mode,tax_rate,tax_label")
    .eq("id", terminalId)
    .eq("merchant_id", merchantId)
    .maybeSingle()

  if (error || !terminal) {
    throw Object.assign(new Error("Terminal tax configuration not found"), { status: 404 })
  }

  const terminalTax: TerminalTaxConfig = {
    taxMode: terminal.tax_mode === "merchant_default" || terminal.tax_mode === "custom" ? terminal.tax_mode : "none",
    taxRate: terminal.tax_rate === null ? null : Number(terminal.tax_rate),
    taxLabel: String(terminal.tax_label || "Sales tax")
  }
  const merchantTax = terminalTax.taxMode === "merchant_default"
    ? await getMerchantTaxSettings(merchantId)
    : null

  return calculatePosTotals({
    subtotalAmount,
    terminalTax,
    merchantDefaultTaxRate: merchantTax?.taxEnabled ? merchantTax.taxRate : null,
    serviceFee: PINETREE_FEE
  })
}

export async function hasConnectedWalletForPosEngine(merchantId: string) {
  return hasAnyWalletConnected(merchantId)
}

export async function checkPosReadinessEngine(merchantId: string, networkHint?: string) {
  if (!merchantId) {
    return {
      connected: false,
      reason: "Missing merchant id"
    }
  }

  try {
    await resolvePosRouting(merchantId, networkHint)
    return {
      connected: true,
      reason: null as string | null
    }
  } catch (error) {
    return {
      connected: false,
      reason: error instanceof Error ? error.message : "POS routing prerequisites not met"
    }
  }
}

export async function createPosPaymentEngine(
  input: CreatePosPaymentInput
): Promise<CreatePosPaymentResult> {
  const subtotalAmount = Number(input.amount || 0)
  if (!subtotalAmount || subtotalAmount <= 0) {
    const err = new Error("Invalid payment amount") as Error & { status?: number }
    err.status = 400
    throw err
  }

  const merchantId = String(input.terminal.merchantId || "").trim()
  if (!merchantId) {
    const err = new Error("Missing merchant id") as Error & { status?: number }
    err.status = 400
    throw err
  }

  const terminalId = String(input.terminal.terminalId || "").trim()
  if (!terminalId) throw Object.assign(new Error("Missing terminal id"), { status: 400 })
  const totals = await calculatePosTotalsForTerminal(merchantId, terminalId, subtotalAmount)
  const merchantAmount = totals.subtotalAmount + totals.taxAmount
  const routing = await resolvePosRouting(merchantId, input.terminal.preferredNetwork)

  const payment = await createPayment({
    amount: merchantAmount,
    currency: input.currency || "USD",
    adapterId: routing.adapterId,
    merchantId,
    preferredNetwork: routing.network,
    asset: input.asset,
    channel: "pos",
    metadata: {
      terminalId: input.terminal.terminalId,
      walletId: routing.wallet.id,
      walletAddress: routing.wallet.wallet_address,
      network: routing.network,
      subtotalAmount,
      merchantAmount,
      taxAmount: totals.taxAmount,
      taxRate: totals.taxRate,
      serviceFee: totals.serviceFee,
      pinetreeFee: totals.serviceFee,
      totalAmount: totals.totalAmount,
      amountsPrecomputed: true
    },
    idempotencyKey: input.idempotencyKey
  })

  return {
    paymentId: payment.id,
    provider: payment.provider,
    state: "PENDING",
    paymentUrl: payment.paymentUrl,
    qrCodeUrl: payment.qrCodeUrl,
    nativeAmount: payment.nativeAmount,
    nativeSymbol: payment.nativeSymbol,
    routing: {
      network: routing.network,
      walletId: routing.wallet.id,
      walletAddress: routing.wallet.wallet_address
    },
    breakdown: {
      ...totals
    }
  }
}

export async function createPosPaymentIntentEngine(input: CreatePosPaymentInput) {
  const subtotalAmount = Number(input.amount || 0)
  if (!subtotalAmount || subtotalAmount <= 0) {
    const err = new Error("Invalid payment amount") as Error & { status?: number }
    err.status = 400
    throw err
  }

  const merchantId = String(input.terminal.merchantId || "").trim()
  if (!merchantId) {
    const err = new Error("Missing merchant id") as Error & { status?: number }
    err.status = 400
    throw err
  }

  const terminalId = String(input.terminal.terminalId || "").trim()
  if (!terminalId) throw Object.assign(new Error("Missing terminal id"), { status: 400 })
  const totals = await calculatePosTotalsForTerminal(merchantId, terminalId, subtotalAmount)
  const merchantAmount = totals.subtotalAmount + totals.taxAmount

  const intent = await createPaymentIntentEngine({
    merchantId,
    amount: merchantAmount,
    currency: input.currency || "USD",
    terminalId: input.terminal.terminalId,
    metadata: {
      subtotalAmount,
      taxAmount: totals.taxAmount,
      taxRate: totals.taxRate,
      serviceFee: totals.serviceFee,
      totalAmount: totals.totalAmount,
      channel: "pos",
      amountsPrecomputed: true
    }
  })

  return {
    paymentId: intent.intentId,
    intentId: intent.intentId,
    provider: "multi",
    state: "PENDING" as const,
    paymentUrl: intent.checkoutUrl,
    qrCodeUrl: intent.qrCodeUrl,
    availableNetworks: intent.availableNetworks,
    breakdown: {
      ...totals
    }
  }
}

export async function getPosPaymentStatusEngine(paymentId: string) {
  const payment = await getPaymentById(paymentId)
  return {
    status: payment?.status ?? null,
    paymentId: payment?.id ?? paymentId
  }
}

export type PosBreakdown = PosTotalBreakdown

export async function previewPosBreakdownEngine(
  merchantId: string,
  terminalId: string,
  subtotalAmount: number
): Promise<PosBreakdown> {
  return calculatePosTotalsForTerminal(merchantId, terminalId, subtotalAmount)
}
