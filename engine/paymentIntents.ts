import {
  createPaymentIntent as createPaymentIntentRecord,
  getPaymentIntentById,
  markPaymentIntentSelected,
  getMerchantWallets,
  getConnectedHostedCheckoutNetworks,
  getPaymentById
} from "@/database"
import QRCode from "qrcode"
import { createPayment, buildCreatePaymentRequest } from "./createPayment"
import { normalizeWalletNetwork, type WalletNetwork } from "./providerMappings"
import { PINETREE_FEE } from "./config"
import { markPaymentIncomplete } from "./paymentStateActions"

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

type WalletOption = {
  id: string
  label: string
  url: string
  href: string
}

type PaymentAsset = "SOL" | "USDC"

function normalizePaymentAsset(value?: string): PaymentAsset | null {
  const normalized = String(value || "").trim().toUpperCase()
  if (normalized === "SOL") return "SOL"
  if (normalized === "USDC") return "USDC"
  return null
}

function resolveSupportedAssetForNetwork(network: WalletNetwork, asset?: string): PaymentAsset | undefined {
  if (network !== "solana") return undefined

  const normalizedAsset = normalizePaymentAsset(asset)
  if (!normalizedAsset) {
    throw new Error("Missing Solana asset selection")
  }

  return normalizedAsset
}

function buildWalletOptions(walletUrl: string, network?: string): WalletOption[] {
  const normalizedUrl = String(walletUrl || "").trim()
  if (!normalizedUrl) return []

  const encodedWalletUrl = encodeURIComponent(normalizedUrl)
  const net = String(network || "").toLowerCase().trim()
  const isSolana = net === "solana"
  const isBase = net === "base"

  const solanaWallets: WalletOption[] = [
    {
      id: "solana-pay",
      label: "Open Solana Wallet",
      url: `solana:${normalizedUrl}`,
      href: `solana:${normalizedUrl}`
    }
  ]

  const evmWallets: WalletOption[] = [
    { id: "metamask", label: "MetaMask", url: `metamask://dapp?url=${encodedWalletUrl}`, href: `metamask://dapp?url=${encodedWalletUrl}` },
    { id: "basewallet", label: "Base Wallet", url: `cbwallet://dapp?url=${encodedWalletUrl}`, href: `cbwallet://dapp?url=${encodedWalletUrl}` },
    { id: "coinbase", label: "Coinbase App", url: `https://go.cb-w.com/dapp?cb_url=${encodedWalletUrl}`, href: `https://go.cb-w.com/dapp?cb_url=${encodedWalletUrl}` },
    { id: "trust", label: "Trust Wallet", url: `https://link.trustwallet.com/open_url?url=${encodedWalletUrl}`, href: `https://link.trustwallet.com/open_url?url=${encodedWalletUrl}` }
  ]

  if (isSolana) return solanaWallets
  if (isBase) return evmWallets
  return [...solanaWallets, ...evmWallets]
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
    checkoutUrl: `${(() => { const u = process.env.NEXT_PUBLIC_APP_URL || ""; return u && !u.includes("localhost") && !u.includes("127.0.0.1") ? u : "https://app.pinetree-payments.com" })()}/pay?intent=${encodeURIComponent(intent.id)}`
  }
}

export async function selectPaymentIntentNetworkEngine(input: {
  intentId: string
  network: string
  asset?: string
  idempotencyKey?: string
}) {
  const startedAt = Date.now()
  const intent = await getPaymentIntentById(input.intentId)
  if (!intent) throw new Error("Payment intent not found")

  const normalizedNetwork = normalizeWalletNetwork(input.network)
  if (!normalizedNetwork || !SUPPORTED_NETWORKS.includes(normalizedNetwork)) {
    throw new Error("Unsupported network selection")
  }

  const selectedAsset = resolveSupportedAssetForNetwork(normalizedNetwork, input.asset)

  const available = Array.isArray(intent.available_networks)
    ? intent.available_networks.map((n) => String(n).toLowerCase())
    : []

  if (!available.includes(normalizedNetwork)) {
    throw new Error("Selected network is not enabled for this merchant")
  }

  // Capture the old payment ID before entering the try block. markPaymentIncomplete is
  // called only AFTER the new payment is successfully created and linked — if creation
  // fails the intent must still point to the old PENDING payment so the user can retry.
  const prevPaymentId = intent.payment_id || null

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
          selectedNetwork: normalizedNetwork,
          selectedAsset
        }
      }),
      PAYMENT_DETAILS_TIMEOUT_MS,
      "Payment preparation"
    )

    const payment = await withTimeout(
      createPayment({
        ...createPaymentInput,
        preferredNetwork: normalizedNetwork,
        asset: selectedAsset,
        idempotencyKey: `payment-intent:${intent.id}:${crypto.randomUUID()}`
      }),
      PAYMENT_DETAILS_TIMEOUT_MS,
      "Payment creation"
    )

    await markPaymentIntentSelected({
      id: intent.id,
      selected_network: normalizedNetwork,
      payment_id: payment.id
    })

    // New payment is safely linked — now it is safe to retire the previous payment.
    if (prevPaymentId) {
      await markPaymentIncomplete(prevPaymentId, {
        providerEvent: "network_switched",
        rawPayload: { reason: "network_switched" }
      })
    }

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

    const walletUrl = normalizedNetwork === "solana"
      ? String(payment.paymentUrl || "")
      : String(payment.universalUrl || payment.paymentUrl || "")

    return {
      intentId: intent.id,
      paymentId: payment.id,
      network: normalizedNetwork,
      selectedNetwork: normalizedNetwork,
      asset: selectedAsset,
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
