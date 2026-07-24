import {
  createPaymentIntent as createPaymentIntentRecord,
  getPaymentIntentById,
  markPaymentIntentSelected,
  markPaymentIntentSelectedIfUnchanged,
  expirePaymentIntent,
  getMerchantWallets,
  getConnectedHostedCheckoutNetworks,
  getPaymentById
} from "@/database"
import { getTransactionByPaymentId } from "@/database/transactions"
import { getPaymentEvents } from "@/database/paymentEvents"
import QRCode from "qrcode"
import { createPayment, buildCreatePaymentRequest } from "./createPayment"
import { normalizeWalletNetwork, type WalletNetwork } from "./providerMappings"
import { PINETREE_FEE } from "./config"
import { markPaymentIncomplete, markPaymentIncompleteIfAbandoned } from "./paymentStateActions"
import { loadProviders } from "./loadProviders"
import { getMerchantProviders } from "@/database/merchants"
import { SPEED_PROVIDER_NAME } from "@/database/merchantProviders"
import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import { getPineTreeSpeedConfigStatus } from "@/providers/lightning/speedClient"
import { merchantProviderCanProcessPayments } from "@/providers/cardProviderReadiness"
import { buildPineTreeRailReadiness, getPineTreeRailReadinessDiagnostics } from "@/lib/pinetreeRailReadiness"
import { getPaymentRailDefinition } from "@/types/payment"

// Deliberately NOT derived from the full canonical rail set
// (types/payment.ts's PAYMENT_RAIL_DEFINITIONS has 6 networks, including
// fluidpay) - fluidpay is not yet wired into checkout/POS network
// resolution below, so it stays excluded here until that's implemented and
// tested. This is a genuinely narrower, intentionally scoped subset, not a
// duplicate of the canonical list.
const SUPPORTED_NETWORKS: WalletNetwork[] = ["solana", "base", "shift4", "stripe", "bitcoin_lightning"]
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

function getLightningEstimatedSats(): number | undefined {
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
  if (normalizedAsset !== "SOL" && normalizedAsset !== "USDC") {
    throw new Error("Solana payments support SOL and USDC only")
  }

  return normalizedAsset
}

// Exported for direct classification tests - see
// __tests__/paymentNetworkClassification.test.ts. This is the single place
// a wallet network (solana/base/shift4/stripe/bitcoin_lightning) maps to the
// merchant_providers row that must be connected+enabled for it to be
// eligible - card and crypto networks are always distinct keys here, never
// merged. The actual key values come from the canonical rail definitions
// (types/payment.ts's providerCapability field) rather than being
// hardcoded a second time here; the SUPPORTED_NETWORKS guard preserves the
// existing, deliberate exclusion of fluidpay (see the comment above that
// constant) even though fluidpay has its own canonical rail definition.
export function walletNetworkToProviderKey(network: WalletNetwork): string | null {
  if (!SUPPORTED_NETWORKS.includes(network)) return null
  return getPaymentRailDefinition(network).providerCapability
}

export function isProviderAvailableForCheckout(
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

  const [wallets, hostedNetworks, providers, pineTreeWalletProfile, lightningProfile] = await Promise.all([
    getMerchantWallets(merchantId),
    getConnectedHostedCheckoutNetworks(merchantId),
    getMerchantProviders(merchantId),
    getPineTreeWalletProfile(merchantId),
    import("@/database/merchantLightningProfiles")
      .then((mod) => mod.getMerchantLightningProfile(merchantId))
      .catch(() => null)
  ])

  // Build the set of provider keys that are both connected and enabled.
  // Rows with enabled=null/undefined (pre-toggle legacy rows) are treated as enabled
  // to preserve backward compatibility for existing merchants.
  const enabledProviders = new Set(
    providers
      .filter(merchantProviderCanProcessPayments)
      .map((p) => String(p.provider || "").toLowerCase().trim())
  )

  // All connected/active provider keys regardless of enabled state — used to
  // distinguish "row exists but disabled" from "no row at all" in walletNetworks.
  const allProviderKeys = new Set(
    providers.map((p) => String(p.provider || "").toLowerCase().trim())
  )

  const speedProvider = providers.find((provider) => String(provider.provider || "").toLowerCase().trim() === SPEED_PROVIDER_NAME)
  const speedCredentials = (speedProvider?.credentials || {}) as {
    speed_account_id?: string
    account_id?: string
    setup_status?: string
  }
  const speedConfig = getPineTreeSpeedConfigStatus()
  const speedAccountReady = Boolean(
    lightningProfile?.status === "ready" ||
    (
      String(speedCredentials.speed_account_id || speedCredentials.account_id || "").trim() &&
      (String(speedCredentials.setup_status || "").trim() === "ready" ||
        String(speedCredentials.setup_status || "").trim() === "ready_for_payments")
    )
  )
  const railReadiness = buildPineTreeRailReadiness({
    providers,
    walletProfile: pineTreeWalletProfile,
    speed: {
      configured: speedConfig.configured,
      accountReady: speedAccountReady,
      payoutReady: Boolean(speedAccountReady && pineTreeWalletProfile?.btc_payout_enabled),
      status: lightningProfile?.status || String(speedCredentials.setup_status || "")
    }
  })

  if (process.env.NODE_ENV !== "production" || process.env.PINETREE_RAIL_READINESS_DEBUG === "true") {
    console.info("[pinetree-rail-readiness] payment-networks", {
      merchantId,
      ...getPineTreeRailReadinessDiagnostics(railReadiness)
    })
  }

  const walletNetworks = wallets
    .map((w) => normalizeWalletNetwork(w.network))
    .filter((n): n is WalletNetwork => {
      if (!n || !SUPPORTED_NETWORKS.includes(n)) return false
      if (n === "solana") return railReadiness.solana.paymentReady
      if (n === "base") return railReadiness.base.paymentReady
      const providerKey = walletNetworkToProviderKey(n)
      if (!providerKey) return false
      if (enabledProviders.has(providerKey)) return true
      if (allProviderKeys.has(providerKey)) return false
      // No provider row for this network — include the wallet for backward compat
      return true
    })

  const pineTreeWalletNetworks: WalletNetwork[] = [
    ...(railReadiness.solana.paymentReady ? ["solana" as const] : []),
    ...(railReadiness.base.paymentReady ? ["base" as const] : []),
  ]

  const hostedCheckoutNetworks = hostedNetworks
    .map((n) => normalizeWalletNetwork(n))
    .filter((n): n is WalletNetwork => Boolean(n && SUPPORTED_NETWORKS.includes(n)))

  const enabledHostedNetworks = hostedCheckoutNetworks.filter((network) => {
    if (network === "bitcoin_lightning") return railReadiness.bitcoin_lightning.paymentReady
    if (!isProviderAvailableForCheckout(network, enabledProviders)) return false

    return true

  })

  return uniqueNetworks([...walletNetworks, ...pineTreeWalletNetworks, ...enabledHostedNetworks])
}

export async function createPaymentIntentEngine(input: {
  merchantId: string
  amount: number
  currency: string
  terminalId?: string
  metadata?: Record<string, unknown>
  allowedNetworks?: string[]
}) {
  const merchantId = String(input.merchantId || "").trim()
  const amount = Number(input.amount || 0)
  const currency = String(input.currency || "USD").trim() || "USD"

  if (!merchantId) throw new Error("Missing merchant id")
  if (!amount || amount <= 0) throw new Error("Invalid payment amount")

  const merchantNetworks = await getMerchantAvailableNetworks(merchantId)
  const allowedNetworks = Array.isArray(input.allowedNetworks)
    ? new Set(input.allowedNetworks.map((network) => String(network).toLowerCase().trim()))
    : null
  const availableNetworks = allowedNetworks
    ? merchantNetworks.filter((network) => allowedNetworks.has(network))
    : merchantNetworks
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
  let intent = await getPaymentIntentById(intentId)
  if (!intent) return null

  const expiresAtMs = new Date(intent.expires_at).getTime()
  const isExpired = Number.isFinite(expiresAtMs) && Date.now() >= expiresAtMs
  if (intent.status !== "EXPIRED" && isExpired) {
    let shouldExpireIntent = !intent.payment_id
    if (intent.payment_id) {
      shouldExpireIntent = await markPaymentIncompleteIfAbandoned(intent.payment_id)
    }
    if (shouldExpireIntent) {
      await expirePaymentIntent(intent.id)
      intent = await getPaymentIntentById(intentId)
      if (!intent) return null
    }
  }

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

type ExistingPaymentForReuse = {
  id: string
  status: string
  network?: string | null
  provider?: string | null
  payment_url?: string | null
  qr_code_url?: string | null
  metadata?: unknown
}

/**
 * Build the "reuse an already-active payment" response shape. Shared by the
 * upfront fast-path (below) and by the concurrent-selection recovery path —
 * both cases end the same way: return the one canonical payment the intent
 * is actually linked to, never a payment the caller created but lost.
 */
function buildReuseSelectNetworkResponse(input: {
  intentId: string
  normalizedNetwork: string
  selectedAsset?: string
  existingPayment: ExistingPaymentForReuse
}) {
  const { intentId, normalizedNetwork, selectedAsset, existingPayment } = input
  const existingMeta = (existingPayment.metadata ?? null) as {
    split?: { baseUsdcStrategy?: string; splitContract?: string }
  } | null
  const existingSplit = existingMeta?.split
  const reuseStrategy = existingSplit?.baseUsdcStrategy === "v7_eip3009_relayer"
    ? "v7_eip3009_relayer" as const
    : undefined
  const reuseSplitContract = String(existingSplit?.splitContract || "").trim() || undefined
  const reusePaymentUrl = String(existingPayment.payment_url || "").trim()
  const reuseWalletUrl = reusePaymentUrl
  const reuseEstimatedSats = normalizedNetwork === "bitcoin_lightning"
    ? getLightningEstimatedSats()
    : undefined

  return {
    intentId,
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
    clientSecret: undefined,
    metadata: {
      split: {
        baseUsdcStrategy: reuseStrategy,
        splitContract: reuseSplitContract
      }
    },
    alreadySelected: true
  }
}

function isActiveReusablePayment(
  payment: ExistingPaymentForReuse,
  normalizedNetwork: string,
  selectedAsset?: string
): boolean {
  const existingStatus = String(payment.status || "").toUpperCase()
  const existingNetwork = String(payment.network || "").toLowerCase().trim()
  const existingMeta = (payment.metadata ?? null) as { selectedAsset?: string } | null
  const existingSelectedAsset = String(existingMeta?.selectedAsset || "").toUpperCase()
  const isSameNetwork = existingNetwork === normalizedNetwork
  const isSameAsset = !selectedAsset || existingSelectedAsset === String(selectedAsset || "").toUpperCase()
  const isActiveStatus = existingStatus === "CREATED" || existingStatus === "PENDING" || existingStatus === "PROCESSING"
  return isActiveStatus && isSameNetwork && isSameAsset
}

/**
 * Recover from losing a concurrent /select-network race for the same intent
 * (a double-tapped QR link, a stale tab plus a fresh one, a POS refresh
 * racing the phone). The winner has already — or is about to — link its
 * payment to the intent; poll briefly for that link to land, then return the
 * SAME canonical payment instead of leaving the loser's own orphaned.
 */
async function resolveConcurrentSelectionWinner(input: {
  intentId: string
  normalizedNetwork: string
  selectedAsset?: string
}) {
  const maxAttempts = 6
  const delayMs = 400

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const intent = await getPaymentIntentById(input.intentId)
    if (intent?.payment_id) {
      const payment = await getPaymentById(intent.payment_id)
      if (payment && isActiveReusablePayment(payment, input.normalizedNetwork, input.selectedAsset)) {
        console.info("[payment-intent] select-network:concurrent-selection-resolved", {
          intentId: input.intentId,
          winningPaymentId: payment.id,
          attempt
        })
        return buildReuseSelectNetworkResponse({
          intentId: input.intentId,
          normalizedNetwork: input.normalizedNetwork,
          selectedAsset: input.selectedAsset,
          existingPayment: payment
        })
      }
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  throw new Error("Payment selection is already in progress for this session. Please retry in a moment.")
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
  //
  // Stripe client secrets are deliberately never persisted. A repeated Stripe
  // selection therefore creates a fresh PaymentIntent instead of returning an
  // unusable response or storing a reusable secret in PineTree metadata.
  if (intent.payment_id && normalizedNetwork !== "stripe") {
    const existingPayment = await getPaymentById(intent.payment_id)
    if (existingPayment && isActiveReusablePayment(existingPayment, normalizedNetwork, selectedAsset)) {
      console.info("[payment-intent] select-network:reuse-existing", {
        intentId: intent.id,
        paymentId: existingPayment.id,
        network: normalizedNetwork,
        status: existingPayment.status,
        durationMs: Date.now() - startedAt
      })

      return buildReuseSelectNetworkResponse({
        intentId: intent.id,
        normalizedNetwork,
        selectedAsset,
        existingPayment
      })
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

    // Deterministic per-"attempt epoch" key so two concurrent calls that both
    // see the same prevPaymentId (neither has linked yet) collide on the SAME
    // idempotency claim instead of each creating their own payment/provider
    // invoice — see database/idempotency.ts's claimIdempotencyKey. A caller
    // that supplies its own key (e.g. Lightning's per-tab sessionStorage key)
    // is honoured as-is; the epoch fallback still changes on every legitimate
    // subsequent retry, once prevPaymentId itself has moved on.
    const idempotencyKey = input.idempotencyKey
      || `payment-intent:${intent.id}:${normalizedNetwork}:${selectedAsset || "default"}:after:${prevPaymentId ?? "initial"}`

    let payment: Awaited<ReturnType<typeof createPayment>>
    try {
      payment = await withTimeout(
        createPayment({
          ...createPaymentInput,
          preferredNetwork: normalizedNetwork,
          asset: selectedAsset,
          idempotencyKey
        }),
        normalizedNetwork === "bitcoin_lightning" ? Math.max(PAYMENT_DETAILS_TIMEOUT_MS, 20_000) : PAYMENT_DETAILS_TIMEOUT_MS,
        "Payment creation"
      )
    } catch (createError) {
      if (createError instanceof Error && createError.message.includes("Duplicate idempotency key")) {
        // A concurrent call already claimed this exact selection attempt.
        // Wait for it to finish linking and reuse its payment rather than
        // surfacing an error for what is, from the customer's perspective,
        // the same tap that already succeeded on another tab/device.
        console.info("[payment-intent] select-network:idempotency-collision", {
          intentId: intent.id,
          network: normalizedNetwork
        })
        return await resolveConcurrentSelectionWinner({ intentId: intent.id, normalizedNetwork, selectedAsset })
      }
      throw createError
    }

    if (normalizedNetwork === "stripe") {
      await markPaymentIntentSelected({
        id: intent.id,
        selected_network: normalizedNetwork,
        payment_id: payment.id
      })
    } else {
      const linked = await markPaymentIntentSelectedIfUnchanged({
        id: intent.id,
        selected_network: normalizedNetwork,
        payment_id: payment.id,
        expectedPreviousPaymentId: prevPaymentId
      })

      if (!linked) {
        // Lost the race: some other concurrent call linked a different
        // payment to this intent between our read and our write. Retire the
        // orphaned payment we just created — it will never be shown to the
        // customer as canonical — and return the winner's payment instead.
        console.warn("[payment-intent] select-network:lost-concurrent-link", {
          intentId: intent.id,
          orphanedPaymentId: payment.id,
          network: normalizedNetwork
        })
        await markPaymentIncomplete(payment.id, {
          providerEvent: "concurrent_selection_lost",
          rawPayload: { reason: "concurrent_selection_lost" }
        }).catch((cleanupError) => {
          console.warn("[payment-intent] select-network:orphan-cleanup-failed", {
            intentId: intent.id,
            orphanedPaymentId: payment.id,
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          })
        })
        return await resolveConcurrentSelectionWinner({ intentId: intent.id, normalizedNetwork, selectedAsset })
      }
    }

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
      ? getLightningEstimatedSats()
      : undefined

    if (normalizedNetwork === "stripe") {
      return {
        paymentId: payment.id,
        provider: payment.provider,
        network: normalizedNetwork,
        clientSecret: payment.clientSecret,
        stripeAccountId: payment.stripeAccountId
      }
    }

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
      clientSecret: payment.clientSecret,
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

/**
 * Thrown by cancelPaymentIntentEngine when the linked payment already has
 * submitted-transaction evidence (a stored on-chain tx hash, PROCESSING
 * status, or a verified receipt). The route surfaces this as a 409 with an
 * explanatory message instead of silently no-op'ing or, worse, letting a
 * race with the customer's own detect call drop real evidence.
 */
export class PaymentAlreadySubmittedError extends Error {
  constructor(message = "Payment already submitted; confirmation is still being checked.") {
    super(message)
    this.name = "PaymentAlreadySubmittedError"
    Object.assign(this, { status: 409 })
  }
}

export async function cancelPaymentIntentEngine(intentId: string): Promise<void> {
  const intent = await getPaymentIntentById(intentId)
  if (!intent) throw new Error("Payment intent not found")
  if (intent.status === "EXPIRED") return

  // Mark the linked payment INCOMPLETE before expiring the intent so the
  // realtime subscription on the hosted checkout fires immediately.
  if (intent.payment_id) {
    const payment = await getPaymentById(intent.payment_id)
    const status = String(payment?.status || "").toUpperCase()
    if (status === "CONFIRMED" || status === "PROCESSING" || status === "FAILED") {
      throw new PaymentAlreadySubmittedError()
    }

    // DB-recorded submission evidence (a stored tx hash from a prior detect
    // call, or a payment.processing event) is checked before any network
    // call. This is cheap, does not depend on RPC availability, and closes
    // the race where a customer's wallet already broadcast a transaction —
    // and detect already persisted the hash — moments before a merchant
    // cancel arrives: without this check the cancel would win the race and
    // silently strand a real, submitted transaction as INCOMPLETE forever.
    if (status !== "INCOMPLETE") {
      const [transaction, events] = await Promise.all([
        getTransactionByPaymentId(intent.payment_id),
        getPaymentEvents(intent.payment_id).catch(() => [])
      ])
      const hasStoredTxHash = Boolean(transaction?.provider_transaction_id)
      const hasProcessingEvidence = events.some((event) =>
        String(event.event_type || "") === "payment.processing"
      )
      if (hasStoredTxHash || hasProcessingEvidence) {
        console.info("[paymentIntents] cancel rejected — submitted transaction evidence already stored", {
          intentId,
          paymentId: intent.payment_id,
          hasStoredTxHash,
          hasProcessingEvidence
        })
        throw new PaymentAlreadySubmittedError()
      }
    }

    // Base wallet-signed payments are cancelled from a client-observed error
    // (e.g. a WalletConnect request timing out) that does not prove the
    // customer's wallet never actually submitted the transaction — a slow
    // relay round-trip can leave the wallet completing the send after the
    // dApp already gave up waiting. Before honouring the cancel, take one
    // bounded look at the chain itself. If the payment already has genuine
    // on-chain evidence, let it advance instead of cancelling out from under
    // it — this is the same canonical verification every Base payment uses,
    // just invoked a moment earlier than the routine watcher would.
    if (status !== "INCOMPLETE" && String(payment?.network || "").toLowerCase() === "base") {
      try {
        const { reconcileBasePaymentFromChain } = await import("./baseChainReconciliation")
        const preCheck = await reconcileBasePaymentFromChain(intent.payment_id, { timeoutMs: 3_500 })
        if (preCheck.detected) {
          console.info("[paymentIntents] cancel pre-empted by chain evidence", {
            intentId,
            paymentId: intent.payment_id,
            resolvedStatus: preCheck.status
          })
          return
        }
      } catch (error) {
        console.warn("[paymentIntents] pre-cancel chain check failed — proceeding with cancel", {
          intentId,
          paymentId: intent.payment_id,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    const changed = await markPaymentIncomplete(intent.payment_id, {
      providerEvent: "terminal_cancel",
      rawPayload: { reason: "merchant_canceled", intentId }
    })
    if (!changed && status !== "INCOMPLETE") return
  }

  // Expire the intent so any subsequent select-network calls are rejected.
  await expirePaymentIntent(intentId)
}
