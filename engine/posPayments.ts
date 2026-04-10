import { createPayment } from "@/engine/createPayment"
import { getMerchantTaxSettings, getMerchantProviders } from "@/lib/database/merchants"
import { hasAnyWalletConnected, selectBestWallet } from "@/lib/database/merchantWallets"
import { getPaymentById } from "@/lib/database/payments"
import { PaymentProvider } from "@/types/payment"

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
  provider: string
  state: "CREATED" | "PENDING" | "PROCESSING" | "CONFIRMED" | "FAILED" | "INCOMPLETE"
  paymentUrl: string
  qrCodeUrl: string
  routing: {
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

function normalizeProvider(provider?: string): PaymentProvider | undefined {
  const value = String(provider || "").toLowerCase().trim()
  if (value === "solana" || value === "coinbase" || value === "shift4") {
    return value as PaymentProvider
  }
  return undefined
}

type WalletNetwork = "solana" | "base" | "ethereum"

function normalizeWalletNetwork(value?: string): WalletNetwork | null {
  const network = String(value || "").toLowerCase().trim()
  if (network === "solana" || network === "base" || network === "ethereum") return network
  return null
}

function providerForWalletNetwork(network: WalletNetwork): PaymentProvider {
  if (network === "solana") return "solana"
  if (network === "base") return "coinbase"
  return "shift4"
}

function providerToPreferredNetwork(provider?: string): WalletNetwork | null {
  const p = normalizeProvider(provider)
  if (p === "solana") return "solana"
  if (p === "coinbase") return "base"
  if (p === "shift4") return "ethereum"
  return null
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

  const provider = providerForWalletNetwork(walletNetwork)
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

export async function getPosPaymentStatusEngine(paymentId: string) {
  if (!paymentId) {
    const err = new Error("Missing paymentId") as Error & { status?: number }
    err.status = 400
    throw err
  }

  const payment = await getPaymentById(paymentId)
  if (!payment) {
    const err = new Error("Payment not found") as Error & { status?: number }
    err.status = 404
    throw err
  }

  const normalized = String(payment.status || "").toUpperCase()
  const state =
    normalized === "EXPIRED"
      ? "INCOMPLETE"
      : normalized === "PENDING" ||
          normalized === "PROCESSING" ||
          normalized === "CONFIRMED" ||
          normalized === "FAILED" ||
          normalized === "INCOMPLETE" ||
          normalized === "CREATED"
        ? normalized
        : "PENDING"

  return {
    status: state,
    paymentId: payment.id
  }
}
