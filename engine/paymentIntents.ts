import {
  createPaymentIntent as createPaymentIntentRecord,
  getPaymentIntentById,
  markPaymentIntentSelected,
  expirePaymentIntent,
  getMerchantWallets,
  getConnectedHostedCheckoutNetworks,
  getPaymentById
} from "@/database"
import { getTransactionByPaymentId } from "@/database/transactions"
import QRCode from "qrcode"
import { createPayment, buildCreatePaymentRequest } from "./createPayment"
import { normalizeWalletNetwork, type WalletNetwork } from "./providerMappings"
import { PINETREE_FEE } from "./config"
import { markPaymentIncomplete } from "./paymentStateActions"
import { loadProviders } from "./loadProviders"
import { getMerchantProviders } from "@/database/merchants"
import { getLightningNwcReadiness, SPEED_PROVIDER_NAME } from "@/database/merchantProviders"
import { getProviderMetadata, isProviderHealthy, providerSupportsFeeAtPaymentTime } from "./providerRegistry"

const SUPPORTED_NETWORKS: WalletNetwork[] = ["solana", "base", "shift4", "bitcoin_lightning"]
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

function getLightningEstimatedSats(_metadata: unknown): number | undefined {
  // NWC invoices encode the sats amount in the invoice itself — no provider metadata needed.
  return undefined
}

type WalletOption = {
  id: string
  label: string
  url: string
  href: string
}

type PaymentAsset = "SOL" | "USDC" | "ETH" | "BTC"

function normalizePaymentAsset(value?: string): PaymentAsset | null {
  const normalized = String(value || "").trim().toUpperCase()
  if (normalized === "ETH") return "ETH"
  if (normalized === "SOL") return "SOL"
  if (normalized === "USDC") return "USDC"
  if (normalized === "BTC") return "BTC"
  return null
}

function resolveSupportedAssetForNetwork(network: WalletNetwork, asset?: string): PaymentAsset | undefined {
  if (network === "base") {
    const normalizedAsset = normalizePaymentAsset(asset) || "ETH"
    if (normalizedAsset !== "ETH" && normalizedAsset !== "USDC") {
      throw new Error("Base payments support ETH and USDC only")
    }
    return normalizedAsset
  }

  if (network === "bitcoin_lightning") {
    const normalizedAsset = normalizePaymentAsset(asset) || "BTC"
    if (normalizedAsset !== "BTC") {
      throw new Error("Bitcoin Lightning payments support BTC only")
    }
    return normalizedAsset
  }

  if (network !== "solana") return undefined

  const normalizedAsset = normalizePaymentAsset(asset)
  if (!normalizedAsset) {
    throw new Error("Missing Solana asset selection")
  }

  return normalizedAsset
}

function walletNetworkToProviderKey(network: WalletNetwork): string | null {
  if (network === "solana") return "solana"
  if (network === "base") return "base"
  if (network === "shift4") return "shift4"
  if (network === "bitcoin_lightning") return "lightning"
  return null
}

function isProviderAvailableForCheckout(
  network: WalletNetwork,
  enabledProviders: Set<string>
): boolean {
  if (network === "bitcoin_lightning") {
    return enabledProviders.has(SPEED_PROVIDER_NAME) ||
      enabledProviders.has("lightning") ||
      enabledProviders.has("lightning_nwc")
  }
  const providerKey = walletNetworkToProviderKey(network)
  if (!providerKey) return false
  return enabledProviders.has(providerKey)
}

function buildWalletOptions(walletUrl: string, network?: string): WalletOption[] {
  const normalizedUrl = String(walletUrl || "").trim()
  if (!normalizedUrl) return []

  const encodedWalletUrl = encodeURIComponent(normalizedUrl)
  const net = String(network || "").toLowerCase().trim()
  const isSolana = net === "solana"
  const isBase = net === "base"
  const isLightning = net === "bitcoin_lightning"

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
  if (isLightning) {
    const lightningUri = normalizedUrl.toLowerCase().startsWith("lightning:")
      ? normalizedUrl
      : `lightning:${normalizedUrl}`

    return [
      {
        id: "lightning",
        label: "Open Lightning Wallet",
        url: lightningUri,
        href: lightningUri
      }
    ]
  }
  return [...solanaWallets, ...evmWallets]
}

export async function getMerchantAvailableNetworks(merchantId: string): Promise<WalletNetwork[]> {
  await loadProviders()

  const [wallets, hostedNetworks, providers] = await Promise.all([
    getMerchantWallets(merchantId),
    getConnectedHostedCheckoutNetworks(merchantId),
    getMerchantProviders(merchantId)
  ])

  // Build the set of provider keys that are both connected and enabled.
  // Rows with enabled=null/undefined (pre-toggle legacy rows) are treated as enabled
  // to preserve backward compatibility for existing merchants.
  const enabledProviders = new Set(
    providers
      .filter((p) => p.enabled !== false)
      .map((p) => String(p.provider || "").toLowerCase().trim())
  )

  // All connected/active provider keys regardless of enabled state — used to
  // distinguish "row exists but disabled" from "no row at all" in walletNetworks.
  const allProviderKeys = new Set(
    providers.map((p) => String(p.provider || "").toLowerCase().trim())
  )

  const walletNetworks = wallets
    .map((w) => normalizeWalletNetwork(w.network))
    .filter((n): n is WalletNetwork => {
      if (!n || !SUPPORTED_NETWORKS.includes(n)) return false
      const providerKey = walletNetworkToProviderKey(n)
      if (!providerKey) return false
      if (enabledProviders.has(providerKey)) return true
      if (allProviderKeys.has(providerKey)) return false
      // No provider row for this network — include the wallet for backward compat
      return true
    })

  const hostedCheckoutNetworks = hostedNetworks
    .map((n) => normalizeWalletNetwork(n))
    .filter((n): n is WalletNetwork => Boolean(n && SUPPORTED_NETWORKS.includes(n)))

  const enabledHostedNetworks = hostedCheckoutNetworks.filter((network) => {
    if (!isProviderAvailableForCheckout(network, enabledProviders)) return false

    if (network !== "bitcoin_lightning") return true

    return providers.some((provider) => {
      const providerId = String(provider.provider || "").toLowerCase().trim()
      const metadata = getProviderMetadata(providerId)
      if (!metadata?.supportedNetworks.includes("bitcoin_lightning")) return false
      if (!metadata.capabilities?.supportsLightningInvoice) return false
      if (!isProviderHealthy(providerId)) return false
      // NWC uses polling and post-payment fee — does not require webhook or atomic fee capture
      if (providerId === SPEED_PROVIDER_NAME) {
        const credentials = (provider.credentials || {}) as {
          speed_account_id?: string
          setup_status?: string
        }
        const setupStatus = String(credentials.setup_status || "").trim()
        return Boolean(
          String(credentials.speed_account_id || "").trim() &&
          (setupStatus === "ready_for_payments" || setupStatus === "ready")
        )
      }
      if (providerId === "lightning_nwc") {
        const credentials = (provider.credentials || {}) as { capabilities?: Parameters<typeof getLightningNwcReadiness>[0] }
        return getLightningNwcReadiness(credentials.capabilities).ready
      }
      return Boolean(
        metadata.capabilities?.supportsWebhookConfirmation &&
        providerSupportsFeeAtPaymentTime(providerId)
      )
    })
  })

  return uniqueNetworks([...walletNetworks, ...enabledHostedNetworks])
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
    throw new Error("No crypto payment methods are enabled for this merchant.")
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
  const selectedTransaction = selectedPayment?.id
    ? await getTransactionByPaymentId(selectedPayment.id)
    : null
  const selectedPaymentMetadata = (selectedPayment?.metadata || null) as {
    selectedAsset?: string | null
  } | null

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
    selectedAsset: selectedPaymentMetadata?.selectedAsset || null,
    paymentId: intent.payment_id || null,
    paymentUrl: selectedPayment?.payment_url || null,
    status: intent.status,
    paymentStatus: selectedPayment?.status || null,
    paymentProviderReference: selectedPayment?.provider_reference || null,
    paymentTxHash: selectedTransaction?.provider_transaction_id || null,
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

  if (intent.status === "EXPIRED") {
    throw new Error("This payment session has been canceled")
  }

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

  // Fast-path: reuse an active payment when the intent already has one for the same
  // network and asset. This prevents creating a duplicate payment (and marking the
  // active one INCOMPLETE) when the checkout resumes after a browser suspension —
  // e.g. when the customer returns from a mobile wallet mid EIP-3009 signing.
  if (intent.payment_id) {
    const existingPayment = await getPaymentById(intent.payment_id)
    if (existingPayment) {
      const existingStatus = String(existingPayment.status || "").toUpperCase()
      const existingNetwork = String(existingPayment.network || "").toLowerCase().trim()
      const existingMeta = (existingPayment.metadata ?? null) as {
        selectedAsset?: string
        split?: { baseUsdcStrategy?: string; splitContract?: string }
      } | null
      const existingSelectedAsset = String(existingMeta?.selectedAsset || "").toUpperCase()
      const isSameNetwork = existingNetwork === normalizedNetwork
      const isSameAsset = !selectedAsset || existingSelectedAsset === String(selectedAsset || "").toUpperCase()
      const isActiveStatus = existingStatus === "CREATED" || existingStatus === "PENDING" || existingStatus === "PROCESSING"

      if (isActiveStatus && isSameNetwork && isSameAsset) {
        const existingSplit = existingMeta?.split
        const reuseStrategy = existingSplit?.baseUsdcStrategy === "v7_eip3009_relayer"
          ? "v7_eip3009_relayer" as const
          : undefined
        const reuseSplitContract = String(existingSplit?.splitContract || "").trim() || undefined
        const reusePaymentUrl = String(existingPayment.payment_url || "").trim()
        const reuseWalletUrl = reusePaymentUrl
        const reuseEstimatedSats = normalizedNetwork === "bitcoin_lightning"
          ? getLightningEstimatedSats(existingPayment.metadata)
          : undefined

        console.info("[payment-intent] select-network:reuse-existing", {
          intentId: intent.id,
          paymentId: existingPayment.id,
          network: normalizedNetwork,
          status: existingStatus,
          durationMs: Date.now() - startedAt
        })

        return {
          intentId: intent.id,
          paymentId: existingPayment.id,
          network: normalizedNetwork,
          selectedNetwork: normalizedNetwork,
          asset: selectedAsset,
          provider: String(existingPayment.provider || ""),
          paymentUrl: reusePaymentUrl,
          qrCodeUrl: String(existingPayment.qr_code_url || ""),
          address: reuseSplitContract,
          walletUrl: reuseWalletUrl || undefined,
          walletOptions: buildWalletOptions(reuseWalletUrl, normalizedNetwork),
          universalUrl: undefined,
          nativeAmount: undefined,
          nativeSymbol: undefined,
          estimatedSats: reuseEstimatedSats,
          baseUsdcStrategy: reuseStrategy,
          metadata: {
            split: {
              baseUsdcStrategy: reuseStrategy,
              splitContract: reuseSplitContract
            }
          },
          alreadySelected: true
        }
      }
    }
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
          selectedAsset,
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
    const persistedSplit = (persistedPayment.metadata as { split?: Record<string, unknown> } | null)?.split
    const persistedBaseUsdcStrategy = persistedSplit?.baseUsdcStrategy === "v7_eip3009_relayer"
      ? "v7_eip3009_relayer"
      : payment.baseUsdcStrategy
    const persistedSplitContract = String(persistedSplit?.splitContract || payment.address || "").trim() || undefined
    const estimatedSats = normalizedNetwork === "bitcoin_lightning"
      ? getLightningEstimatedSats(persistedPayment.metadata)
      : undefined

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
      estimatedSats,
      baseUsdcStrategy: persistedBaseUsdcStrategy,
      metadata: {
        split: {
          baseUsdcStrategy: persistedBaseUsdcStrategy,
          splitContract: persistedSplitContract
        }
      },
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

export async function cancelPaymentIntentEngine(intentId: string): Promise<void> {
  const intent = await getPaymentIntentById(intentId)
  if (!intent) throw new Error("Payment intent not found")

  // Mark the linked payment INCOMPLETE before expiring the intent so the
  // realtime subscription on the hosted checkout fires immediately.
  if (intent.payment_id) {
    await markPaymentIncomplete(intent.payment_id, {
      providerEvent: "terminal_cancel",
      rawPayload: { reason: "merchant_canceled", intentId }
    })
  }

  // Expire the intent so any subsequent select-network calls are rejected.
  await expirePaymentIntent(intentId)
}
