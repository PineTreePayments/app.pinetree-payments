import {
  createPaymentIntent as createPaymentIntentRecord,
  getPaymentIntentById,
  markPaymentIntentSelected,
  getMerchantWallets,
  getConnectedHostedCheckoutNetworks,
  getPaymentById
} from "@/database"
import QRCode from "qrcode"
import { createPayment } from "./createPayment"
import { buildCreatePaymentRequest } from "./createPayment"
import { getUnifiedPaymentStatusEngine } from "./paymentStatusOrchestrator"
import { normalizeWalletNetwork, type WalletNetwork } from "./providerMappings"
import { PINETREE_FEE } from "./config"

const SUPPORTED_NETWORKS: WalletNetwork[] = ["solana", "base", "shift4"]
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

type StoredPaymentSplitMetadata = {
  split?: {
    merchantWallet?: string
    feeCaptureMethod?: string
    splitContract?: string
    expectedAmountNative?: number
    merchantNativeAmount?: number
    feeNativeAmount?: number
  }
}

type WalletOption = {
  id: string
  label: string
  href: string
}

function buildWalletOptions(walletUrl: string, network?: string): WalletOption[] {
  const normalizedUrl = String(walletUrl || "").trim()
  if (!normalizedUrl) return []

  const encodedWalletUrl = encodeURIComponent(normalizedUrl)
  const net = String(network || "").toLowerCase().trim()
  const isSolana = net === "solana"
  const isBase = net === "base"

  const solanaWallets: WalletOption[] = [
    { id: "phantom", label: "Phantom", href: `https://phantom.app/ul/browse/${encodedWalletUrl}` },
    { id: "solflare", label: "Solflare", href: `https://solflare.com/ul/v1/browse/${encodedWalletUrl}` }
  ]

  const evmWallets: WalletOption[] = [
    { id: "metamask", label: "MetaMask", href: `metamask://dapp?url=${encodedWalletUrl}` },
    { id: "basewallet", label: "Base Wallet", href: `cbwallet://dapp?url=${encodedWalletUrl}` },
    { id: "coinbase", label: "Coinbase App", href: `https://go.cb-w.com/dapp?cb_url=${encodedWalletUrl}` },
    { id: "trust", label: "Trust Wallet", href: `https://link.trustwallet.com/open_url?url=${encodedWalletUrl}` }
  ]

  if (isSolana) return solanaWallets
  if (isBase) return evmWallets
  return [...solanaWallets, ...evmWallets]
}

function inferNativeSymbolFromNetwork(network?: string): string | undefined {
  const normalized = String(network || "").toLowerCase().trim()
  if (normalized === "solana") return "SOL"
  if (normalized === "base" || normalized === "ethereum") return "ETH"
  return undefined
}

function inferNativeAmountFromPayment(payment: { metadata?: unknown } | null | undefined): number | undefined {
  const metadata = (payment?.metadata || null) as StoredPaymentSplitMetadata | null
  const split = metadata?.split

  const expectedAmountNative = Number(split?.expectedAmountNative || 0)
  if (expectedAmountNative > 0) return expectedAmountNative

  const merchantNativeAmount = Number(split?.merchantNativeAmount || 0)
  const feeNativeAmount = Number(split?.feeNativeAmount || 0)
  const total = merchantNativeAmount + feeNativeAmount
  return total > 0 ? total : undefined
}

function inferRecipientAddressFromPayment(payment: { metadata?: unknown } | null | undefined): string | undefined {
  const metadata = (payment?.metadata || null) as StoredPaymentSplitMetadata | null
  const split = metadata?.split
  // For contract_split payments show the split contract address (where user must send)
  if (String(split?.feeCaptureMethod || "").toLowerCase() === "contract_split" && split?.splitContract) {
    return String(split.splitContract).trim() || undefined
  }
  const recipient = String(split?.merchantWallet || "").trim()
  return recipient || undefined
}

export async function getMerchantAvailableNetworks(merchantId: string): Promise<WalletNetwork[]> {
  const [wallets, hostedNetworks] = await Promise.all([
    getMerchantWallets(merchantId),
    getConnectedHostedCheckoutNetworks(merchantId)
  ])

  const walletNetworks = wallets
    .map((w) => normalizeWalletNetwork(w.network))
    .filter((n): n is WalletNetwork => Boolean(n && SUPPORTED_NETWORKS.includes(n)))

  const hostedCheckoutNetworks = hostedNetworks
    .map((n) => normalizeWalletNetwork(n))
    .filter((n): n is WalletNetwork => Boolean(n && SUPPORTED_NETWORKS.includes(n)))

  return uniqueNetworks([...walletNetworks, ...hostedCheckoutNetworks])
}

export async function createPaymentIntentEngine(input: {
  merchantId: string
  amount: number
  currency: string
  terminalId?: string
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
  const pinetreeFee = PINETREE_FEE

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

  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL || ""
  const baseUrl = configuredUrl && !configuredUrl.includes("localhost") && !configuredUrl.includes("127.0.0.1")
    ? configuredUrl
    : "https://app.pinetree-payments.com"
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

  const statusResolution = await getUnifiedPaymentStatusEngine(intent.id, "payment-intents:get")
  const selectedPayment = statusResolution.hasSelectedPayment
    ? await getPaymentById(statusResolution.paymentId)
    : null

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
    paymentId: statusResolution.hasSelectedPayment ? statusResolution.paymentId : null,
    status: intent.status,
    paymentStatus: statusResolution.status,
    paymentProviderReference: selectedPayment?.provider_reference || null,
    expiresAt: intent.expires_at,
    metadata: (intent.metadata || undefined) as Record<string, unknown> | undefined,
    checkoutUrl: `${(() => { const u = process.env.NEXT_PUBLIC_APP_URL || ""; return u && !u.includes("localhost") && !u.includes("127.0.0.1") ? u : "https://app.pinetree-payments.com" })()}/pay?intent=${encodeURIComponent(intent.id)}`
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
    const walletUrl = String(existingPayment?.payment_url || "")
    const recipientAddress = inferRecipientAddressFromPayment(existingPayment)

    return {
      intentId: intent.id,
      paymentId: intent.payment_id,
      selectedNetwork: intent.selected_network,
      alreadySelected: true,
      universalUrl: undefined,
      paymentUrl: existingPayment?.payment_url || undefined,
      qrCodeUrl: existingPayment?.qr_code_url || undefined,
      address: recipientAddress,
      walletUrl: walletUrl || undefined,
      walletOptions: buildWalletOptions(walletUrl, existingPayment?.network || ""),
      provider: existingPayment?.provider || undefined,
      nativeAmount: inferNativeAmountFromPayment(existingPayment),
      nativeSymbol: inferNativeSymbolFromNetwork(existingPayment?.network)
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

  try {
    console.info("[payment-intent] select-network:start", {
      intentId: intent.id,
      network: normalizedNetwork
    })

    const { createPaymentInput } = await withTimeout(
      buildCreatePaymentRequest({
        amount: Number(intent.amount),
        currency: intent.currency,
        merchantId: intent.merchant_id,
        preferredNetwork: normalizedNetwork,
        terminalId: intent.terminal_id || undefined,
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

    const persistedPayment = await getPaymentById(payment.id)
    if (!persistedPayment) {
      throw new Error("Payment was created but could not be loaded")
    }

    console.info("[payment-intent] select-network:success", {
      intentId: intent.id,
      network: normalizedNetwork,
      durationMs: Date.now() - startedAt,
      paymentId: payment.id
    })

    const walletUrl = String(payment.universalUrl || payment.paymentUrl || "")

    return {
      intentId: intent.id,
      paymentId: payment.id,
      selectedNetwork: normalizedNetwork,
      provider: payment.provider,
      paymentUrl: payment.paymentUrl,
      qrCodeUrl: payment.qrCodeUrl,
      address: payment.address,
      walletUrl: walletUrl || undefined,
      walletOptions: buildWalletOptions(walletUrl, normalizedNetwork),
      universalUrl: payment.universalUrl,
      nativeAmount: payment.nativeAmount,
      nativeSymbol: payment.nativeSymbol,
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
