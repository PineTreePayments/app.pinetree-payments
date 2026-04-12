import { createPayment } from "@/engine/createPayment"
import { getMerchantTaxSettings, getMerchantProviders } from "@/database/merchants"
import { hasAnyWalletConnected, selectBestWallet } from "@/database/merchantWallets"
import { createPaymentIntentEngine } from "./paymentIntents"
import { getUnifiedPaymentStatusEngine } from "./paymentStatusOrchestrator"
import {
  normalizeWalletNetwork,
  providerToPreferredNetwork,
  networkToProvider
} from "./providerMappings"

export type PosTaxSettings = {
  taxEnabled: boolean
  taxRate: number
}

export type PosTerminalContext = {
  merchantId: string
  terminalId?: string
  provider?: string
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

async function resolvePosRouting(merchantId: string, terminalHint?: string) {
  const hintedNetwork = normalizeWalletNetwork(terminalHint)
  const hintedProviderNetwork = providerToPreferredNetwork(terminalHint)
  const preferredNetwork = hintedNetwork || hintedProviderNetwork || undefined

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

  const connectedProviders = await getMerchantProviders(merchantId)
  const connected = new Set(connectedProviders.map((p) => String(p.provider || "").toLowerCase()))

  const provider = networkToProvider(walletNetwork)
  if (!connected.has(provider)) {
    const err = new Error(`No compatible provider connected for wallet network: ${walletNetwork}`) as Error & {
      status?: number
    }
    err.status = 400
    throw err
  }

  return {
    provider,
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

export async function checkPosReadinessEngine(merchantId: string, providerHint?: string) {
  if (!merchantId) {
    return {
      connected: false,
      reason: "Missing merchant id"
    }
  }

  try {
    await resolvePosRouting(merchantId, providerHint)
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
  const serviceFee = 0.15
  const totalAmount = merchantAmount + serviceFee
  const routing = await resolvePosRouting(merchantId, input.terminal.provider)

  const payment = await createPayment({
    amount: totalAmount,
    currency: input.currency || "USD",
    provider: routing.provider,
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
    idempotencyKey: input.idempotencyKey,
    pinetreeFee: serviceFee
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
  const serviceFee = 0.15

  const intent = await createPaymentIntentEngine({
    merchantId,
    amount: merchantAmount,
    currency: input.currency || "USD",
    terminalId: input.terminal.terminalId,
    pinetreeFee: serviceFee,
    metadata: {
      subtotalAmount,
      taxAmount,
      serviceFee,
      totalAmount: merchantAmount + serviceFee,
      channel: "pos"
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
