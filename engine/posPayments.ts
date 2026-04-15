import { createPayment } from "@/engine/createPayment"
import { getMerchantTaxSettings } from "@/database/merchants"
import { hasAnyWalletConnected, selectBestWallet } from "@/database/merchantWallets"
import { claimIdempotencyKey, getIdempotencyKey } from "@/database/idempotency"
import { getPaymentIntentById } from "@/database"
import { createPaymentIntentEngine } from "./paymentIntents"
import { getUnifiedPaymentStatusEngine } from "./paymentStatusOrchestrator"
import {
  normalizeWalletNetwork
} from "./providerMappings"
import { PINETREE_FEE } from "./config"
import { chooseBestAdapter } from "./providerSelector"

export type PosTaxSettings = {
  taxEnabled: boolean
  taxRate: number
}

export type PosTerminalContext = {
  merchantId: string
  terminalId?: string
  preferredNetwork?: string
}

export type CreatePosPaymentInput = {
  amount: number
  currency?: string
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

export async function getPosTaxSettingsEngine(merchantId: string): Promise<PosTaxSettings> {
  const settings = await getMerchantTaxSettings(merchantId)
  return {
    taxEnabled: Boolean(settings?.taxEnabled),
    taxRate: Number(settings?.taxRate || 0)
  }
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

  const tax = await getPosTaxSettingsEngine(merchantId)
  const taxAmount = tax.taxEnabled ? subtotalAmount * (tax.taxRate / 100) : 0
  const merchantAmount = subtotalAmount + taxAmount
  const serviceFee = PINETREE_FEE
  const totalAmount = merchantAmount + serviceFee
  const routing = await resolvePosRouting(merchantId, input.terminal.preferredNetwork)

  const payment = await createPayment({
    amount: totalAmount,
    currency: input.currency || "USD",
    adapterId: routing.adapterId,
    merchantId,
    preferredNetwork: routing.network,
    channel: "pos",
    metadata: {
      terminalId: input.terminal.terminalId,
      walletId: routing.wallet.id,
      walletAddress: routing.wallet.wallet_address,
      network: routing.network,
      subtotalAmount,
      merchantAmount,
      taxAmount,
      serviceFee,
      totalAmount
    },
    idempotencyKey: input.idempotencyKey
  })

  const grossAmount = totalAmount

  return {
    paymentId: payment.id,
    provider: payment.provider,
    state: "PENDING",
    paymentUrl: payment.paymentUrl,
    qrCodeUrl: payment.qrCodeUrl,
    routing: {
      network: routing.network,
      walletId: routing.wallet.id,
      walletAddress: routing.wallet.wallet_address
    },
    breakdown: {
      subtotalAmount,
      taxAmount,
      serviceFee,
      grossAmount,
      totalAmount
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

  const tax = await getPosTaxSettingsEngine(merchantId)
  const taxAmount = tax.taxEnabled ? subtotalAmount * (tax.taxRate / 100) : 0
  const merchantAmount = subtotalAmount + taxAmount
  const serviceFee = PINETREE_FEE

  // Idempotency: generate a deterministic key scoped to a 5-minute window.
  // If the POS terminal retries (e.g. network timeout after intent was created),
  // the same key is returned instead of creating a duplicate charge.
  const terminalId = input.terminal.terminalId || "none"
  const amountCents = Math.round(subtotalAmount * 100)
  const timeBucket = Math.floor(Date.now() / (5 * 60 * 1000)) // changes every 5 min
  const idempotencyKey = `pos-intent:${merchantId}:${amountCents}:${terminalId}:${timeBucket}`

  const existingIntentId = await getIdempotencyKey(idempotencyKey)
  if (existingIntentId) {
    const existingIntent = await getPaymentIntentById(existingIntentId)
    if (existingIntent) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.pinetree-payments.com"
      const checkoutUrl = `${baseUrl}/pay?intent=${encodeURIComponent(existingIntent.id)}`
      return {
        paymentId: existingIntent.id,
        intentId: existingIntent.id,
        provider: "multi",
        state: "PENDING" as const,
        paymentUrl: checkoutUrl,
        qrCodeUrl: "",
        availableNetworks: existingIntent.available_networks || [],
        breakdown: {
          subtotalAmount,
          taxAmount,
          serviceFee,
          grossAmount: merchantAmount + serviceFee,
          totalAmount: merchantAmount + serviceFee
        }
      }
    }
  }

  const intent = await createPaymentIntentEngine({
    merchantId,
    amount: merchantAmount,
    currency: input.currency || "USD",
    terminalId: input.terminal.terminalId,
    metadata: {
      subtotalAmount,
      taxAmount,
      serviceFee,
      totalAmount: merchantAmount + serviceFee,
      channel: "pos"
    }
  })

  // Claim the idempotency key against the new intent ID
  await claimIdempotencyKey(idempotencyKey, intent.intentId)

  return {
    paymentId: intent.intentId,
    intentId: intent.intentId,
    provider: "multi",
    state: "PENDING" as const,
    paymentUrl: intent.checkoutUrl,
    qrCodeUrl: intent.qrCodeUrl,
    availableNetworks: intent.availableNetworks,
    breakdown: {
      subtotalAmount,
      taxAmount,
      serviceFee,
      grossAmount: merchantAmount + serviceFee,
      totalAmount: merchantAmount + serviceFee
    }
  }
}

export async function getPosPaymentStatusEngine(paymentId: string) {
  const resolved = await getUnifiedPaymentStatusEngine(paymentId, "pos:get-status")

  return {
    status: resolved.status,
    paymentId: resolved.paymentId
  }
}

export type PosBreakdown = {
  subtotalAmount: number
  taxAmount: number
  taxRate: number
  taxEnabled: boolean
  serviceFee: number
  grossAmount: number
  totalAmount: number
}

export async function previewPosBreakdownEngine(
  merchantId: string,
  subtotalAmount: number
): Promise<PosBreakdown> {
  if (!subtotalAmount || subtotalAmount <= 0) {
    const err = new Error("Invalid amount") as Error & { status?: number }
    err.status = 400
    throw err
  }

  const tax = await getPosTaxSettingsEngine(merchantId)
  const taxAmount = tax.taxEnabled ? subtotalAmount * (tax.taxRate / 100) : 0
  const merchantAmount = subtotalAmount + taxAmount
  const serviceFee = PINETREE_FEE
  const grossAmount = merchantAmount + serviceFee

  return {
    subtotalAmount,
    taxAmount,
    taxRate: tax.taxRate,
    taxEnabled: tax.taxEnabled,
    serviceFee,
    grossAmount,
    totalAmount: grossAmount
  }
}
