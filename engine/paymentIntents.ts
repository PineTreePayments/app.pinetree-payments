import {
  createPaymentIntent as createPaymentIntentRecord,
  getPaymentIntentById,
  markPaymentIntentSelected,
  getMerchantWallets,
  getPaymentById
} from "@/database"
import QRCode from "qrcode"
import { createPayment } from "./createPayment"
import { buildCreatePaymentRequest } from "./createPayment"
import { networkToProvider, normalizeWalletNetwork, type WalletNetwork } from "./providerMappings"

const SUPPORTED_NETWORKS: WalletNetwork[] = ["solana", "base"]
const PAYMENT_DETAILS_TIMEOUT_MS = Number(process.env.PAYMENT_DETAILS_TIMEOUT_MS || 12000)

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      })
    ])
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}

function uniqueNetworks(networks: WalletNetwork[]) {
  return [...new Set(networks)]
}

export async function getMerchantAvailableNetworks(merchantId: string): Promise<WalletNetwork[]> {
  const wallets = await getMerchantWallets(merchantId)
  const networks = wallets
    .map((wallet) => normalizeWalletNetwork(wallet.network))
    .filter((network): network is WalletNetwork => Boolean(network && SUPPORTED_NETWORKS.includes(network)))

  return uniqueNetworks(networks)
}

export async function createPaymentIntentEngine(input: {
  merchantId: string
  amount: number
  currency: string
  terminalId?: string
  pinetreeFee?: number
  metadata?: Record<string, unknown>
}) {
  const merchantId = String(input.merchantId || "").trim()
  const amount = Number(input.amount || 0)
  const currency = String(input.currency || "USD").trim() || "USD"

  if (!merchantId) throw new Error("Missing merchant id")
  if (!amount || amount <= 0) throw new Error("Invalid payment amount")

  const availableNetworks = await getMerchantAvailableNetworks(merchantId)
  if (availableNetworks.length === 0) {
    throw new Error("No supported wallets connected (requires Solana and/or Base)")
  }

  const intentId = crypto.randomUUID()
  const pinetreeFee = Number(input.pinetreeFee ?? 0.15)

  const intent = await createPaymentIntentRecord({
    id: intentId,
    merchant_id: merchantId,
    amount,
    currency,
    terminal_id: input.terminalId || null,
    pinetree_fee: pinetreeFee,
    metadata: input.metadata,
    available_networks: availableNetworks
  })

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.pinetree-payments.com"
  const checkoutUrl = `${baseUrl}/pay?intent=${encodeURIComponent(intent.id)}`
  const qrCodeUrl = await QRCode.toDataURL(checkoutUrl)

  return {
    intentId: intent.id,
    amount,
    currency,
    pinetreeFee,
    availableNetworks,
    expiresAt: intent.expires_at,
    checkoutUrl,
    qrCodeUrl
  }
}

export async function getPaymentIntentEngine(intentId: string) {
  const intent = await getPaymentIntentById(intentId)
  if (!intent) return null

  const selectedPayment = intent.payment_id ? await getPaymentById(intent.payment_id) : null

  return {
    intentId: intent.id,
    amount: Number(intent.amount),
    currency: intent.currency,
    pinetreeFee: Number(intent.pinetree_fee || 0),
    terminalId: intent.terminal_id || undefined,
    availableNetworks: Array.isArray(intent.available_networks)
      ? intent.available_networks.map((n) => String(n))
      : [],
    selectedNetwork: intent.selected_network || null,
    paymentId: intent.payment_id || null,
    status: intent.status,
    paymentStatus: selectedPayment?.status || null,
    paymentProviderReference: selectedPayment?.provider_reference || null,
    expiresAt: intent.expires_at,
    metadata: (intent.metadata || undefined) as Record<string, unknown> | undefined,
    checkoutUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://app.pinetree-payments.com"}/pay?intent=${encodeURIComponent(intent.id)}`
  }
}

export async function selectPaymentIntentNetworkEngine(input: {
  intentId: string
  network: string
  idempotencyKey?: string
}) {
  const startedAt = Date.now()
  const intent = await getPaymentIntentById(input.intentId)
  if (!intent) throw new Error("Payment intent not found")

  if (intent.status === "SELECTED" && intent.payment_id) {
    const existingPayment = await getPaymentById(intent.payment_id)

    return {
      intentId: intent.id,
      paymentId: intent.payment_id,
      selectedNetwork: intent.selected_network,
      alreadySelected: true,
      universalUrl: undefined,
      paymentUrl: existingPayment?.payment_url || undefined,
      qrCodeUrl: existingPayment?.qr_code_url || undefined,
      provider: existingPayment?.provider || undefined
    }
  }

  const normalizedNetwork = normalizeWalletNetwork(input.network)
  if (!normalizedNetwork || !SUPPORTED_NETWORKS.includes(normalizedNetwork)) {
    throw new Error("Unsupported network selection")
  }

  const available = Array.isArray(intent.available_networks)
    ? intent.available_networks.map((n) => String(n).toLowerCase())
    : []

  if (!available.includes(normalizedNetwork)) {
    throw new Error("Selected network is not enabled for this merchant")
  }

  const provider = networkToProvider(normalizedNetwork)

  try {
    console.info("[payment-intent] select-network:start", {
      intentId: intent.id,
      network: normalizedNetwork,
      provider
    })

    const { createPaymentInput } = await withTimeout(
      buildCreatePaymentRequest({
        amount: Number(intent.amount),
        currency: intent.currency,
        provider,
        merchantId: intent.merchant_id,
        terminalId: intent.terminal_id || undefined,
        pinetreeFee: Number(intent.pinetree_fee || 0.15),
        metadata: {
          ...(intent.metadata || {}),
          paymentIntentId: intent.id,
          selectedNetwork: normalizedNetwork
        }
      }),
      PAYMENT_DETAILS_TIMEOUT_MS,
      "Payment preparation"
    )

    const payment = await withTimeout(
      createPayment({
        ...createPaymentInput,
        preferredNetwork: normalizedNetwork,
        idempotencyKey: input.idempotencyKey || `payment-intent:${intent.id}:${normalizedNetwork}`
      }),
      PAYMENT_DETAILS_TIMEOUT_MS,
      "Payment creation"
    )

    await markPaymentIntentSelected({
      id: intent.id,
      selected_network: normalizedNetwork,
      payment_id: payment.id
    })

    console.info("[payment-intent] select-network:success", {
      intentId: intent.id,
      network: normalizedNetwork,
      durationMs: Date.now() - startedAt,
      paymentId: payment.id
    })

    return {
      intentId: intent.id,
      paymentId: payment.id,
      selectedNetwork: normalizedNetwork,
      provider: payment.provider,
      paymentUrl: payment.paymentUrl,
      qrCodeUrl: payment.qrCodeUrl,
      address: payment.address,
      universalUrl: payment.universalUrl,
      alreadySelected: false
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to prepare payment details"

    console.error("[payment-intent] select-network:error", {
      intentId: intent.id,
      network: normalizedNetwork,
      durationMs: Date.now() - startedAt,
      error: message
    })

    if (message.toLowerCase().includes("timed out")) {
      throw new Error("Payment details timed out, please retry")
    }

    throw error
  }
}
