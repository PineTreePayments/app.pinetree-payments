import { supabase, supabaseAdmin } from "@/database"
import { getMerchantWallets } from "@/database/merchantWallets"
import { getMerchantAvailableNetworks } from "@/engine/paymentIntents"
import { listCheckoutLinksEngine, type CheckoutLinkWithUrl } from "@/engine/checkoutLinks"
import type { PaymentStatus } from "@/database/payments"

const db = supabaseAdmin || supabase

type RawProviderRow = {
  provider?: string | null
  status?: string | null
  enabled?: boolean | null
  dashboard_status?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type RawMerchantRow = {
  id?: string | null
  business_name?: string | null
  email?: string | null
  status?: string | null
}

type RawSettingsRow = {
  business_name?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  country?: string | null
  phone?: string | null
  business_type?: string | null
  default_provider?: string | null
  pinetree_fee_enabled?: boolean | null
  pinetree_fee_amount?: number | string | null
  smart_routing_enabled?: boolean | null
  auto_conversion_enabled?: boolean | null
}

type RawTaxSettingsRow = {
  tax_enabled?: boolean | null
  tax_rate?: number | string | null
}

type RawPaymentRow = {
  id: string
  status: PaymentStatus | string
  provider?: string | null
  network?: string | null
  gross_amount?: number | string | null
  merchant_amount?: number | string | null
  pinetree_fee?: number | string | null
  currency?: string | null
  created_at: string
  updated_at?: string | null
}

type RawTicketRow = {
  id: string
  category: string
  subject: string
  priority: string
  status: string
  related_payment_id?: string | null
  created_at: string
  last_response_at?: string | null
}

type RawTerminalRow = {
  status?: string | null
}

export type AssistantProviderContext = {
  provider: string
  label: string
  status: string
  enabled: boolean
  dashboardStatus: string | null
}

export type AssistantWalletContext = {
  id: string
  network: string
  asset: string | null
  walletType: string | null
  provider: string | null
  status: string
  updatedAt: string | null
}

export type AssistantPaymentContext = {
  id: string
  status: PaymentStatus | string
  provider: string | null
  network: string | null
  grossAmount: number
  merchantAmount: number
  pinetreeFee: number
  currency: string
  createdAt: string
  updatedAt: string | null
}

export type AssistantSupportTicketContext = {
  id: string
  category: string
  subject: string
  priority: string
  status: string
  relatedPaymentId: string | null
  createdAt: string
  lastResponseAt: string | null
}

export type AssistantRailSummary = {
  rail: string
  provider: string
  network?: string
  asset?: string
  connected: boolean
  enabled: boolean
  availableForPos: boolean
  availableForCheckout: boolean
  sourceSignals: string[]
  status?: string
  readySignal?: string
  updatedAt?: string
}

export type AssistantSetupSourceSummary = {
  providerRows: number
  walletRows: number
  connectedRails: number
  enabledRails: number
  posAvailableRails: number
  checkoutAvailableRails: number
  railNames: string[]
}

export type AssistantSetupSummary = {
  accountProfile: { status: "complete" | "incomplete" | "unknown"; detail: string }
  wallets: { status: "ready" | "missing" | "unknown"; detail: string }
  paymentRails: { status: "ready" | "missing" | "incomplete" | "unknown"; detail: string }
  checkout: { status: "ready" | "not_ready" | "unknown"; detail: string }
  pos: { status: "ready" | "not_ready" | "unknown"; detail: string }
  testPayment: { status: "found" | "not_found" | "unknown"; detail: string }
  supportAttention: { status: "yes" | "no"; detail: string }
}

export type AssistantSourceDiagnostic = {
  source: string
  ok: boolean
  rawCount: number
  errorMessage?: string
}

export type AssistantDiagnostics = {
  merchantIdMasked: string
  sources: {
    merchantProfile: AssistantSourceDiagnostic & { found: boolean }
    providers: AssistantSourceDiagnostic & {
      connectedCount: number
      enabledCount: number
      providerKeys: string[]
      statuses: string[]
    }
    wallets: AssistantSourceDiagnostic & {
      addressPresentCount: number
      networks: string[]
      assets: string[]
      walletTypes: string[]
    }
    availableNetworks: AssistantSourceDiagnostic & {
      networks: string[]
    }
    checkout: AssistantSourceDiagnostic & {
      activeCount: number
    }
    payments: AssistantSourceDiagnostic & {
      confirmedCount: number
      pendingCount: number
      processingCount: number
      failedCount: number
      incompleteCount: number
      recentProviders: string[]
      recentNetworks: string[]
    }
    tickets: AssistantSourceDiagnostic
    terminals: AssistantSourceDiagnostic
  }
}

export type PineTreeAssistantContext = {
  merchant: {
    id: string
    businessName: string | null
    email: string | null
    status: string | null
  } | null
  settings: {
    defaultProvider: string | null
    smartRoutingEnabled: boolean | null
    autoConversionEnabled: boolean | null
    pinetreeFeeEnabled: boolean | null
    pinetreeFeeAmount: number | null
    taxEnabled: boolean | null
    taxRate: number | null
    businessProfileFields: {
      businessName: string | null
      address: string | null
      city: string | null
      state: string | null
      zip: string | null
      country: string | null
      phone: string | null
      businessType: string | null
    }
  } | null
  providers: AssistantProviderContext[]
  wallets: AssistantWalletContext[]
  railSummaries: AssistantRailSummary[]
  setupSourceSummary: AssistantSetupSourceSummary
  recentPayments: AssistantPaymentContext[]
  recentTickets: AssistantSupportTicketContext[]
  checkoutLinks: {
    activeCount: number
    totalCount: number
    mostRecentName: string | null
    mostRecentStatus: string | null
  }
  pos: {
    terminalCount: number
    activeTerminalCount: number
  }
  setupSummary: AssistantSetupSummary
  diagnostics?: AssistantDiagnostics
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function providerLabel(provider: string) {
  const normalized = provider.toLowerCase().trim()
  if (normalized === "solana") return "Solana Pay"
  if (
    normalized === "base" ||
    normalized === "base_pay" ||
    normalized === "basepay" ||
    normalized === "base-pay" ||
    normalized === "evm"
  ) return "Base payments"
  if (normalized === "shift4") return "Shift4"
  if (normalized === "lightning") return "TrySpeed / Lightning"
  if (normalized === "coinbase") return "Coinbase"
  if (normalized === "walletconnect") return "WalletConnect"
  return provider || "Unknown provider"
}

function normalizeProviderRow(row: RawProviderRow): AssistantProviderContext {
  const provider = String(row.provider || "unknown").trim()
  return {
    provider,
    label: providerLabel(provider),
    status: String(row.status || "unknown").trim(),
    enabled: row.enabled !== false,
    dashboardStatus: row.dashboard_status ? String(row.dashboard_status) : null
  }
}

export function isConnectedStatus(status: string) {
  const normalized = status.toLowerCase().trim()
  return (
    normalized === "connected" ||
    normalized === "active" ||
    normalized === "enabled" ||
    normalized === "ready" ||
    normalized === "configured" ||
    normalized === "on"
  )
}

function isTerminalActive(status?: string | null) {
  const normalized = String(status || "").toLowerCase().trim()
  return !normalized || normalized === "active" || normalized === "open"
}

function maskMerchantId(id: string): string {
  if (id.length <= 8) return `${id.slice(0, 2)}...`
  return `${id.slice(0, 4)}...${id.slice(-4)}`
}

// Maps getMerchantAvailableNetworks() WalletNetwork values to provider row keys
function networkToProviderKey(network: string): string {
  if (network === "bitcoin_lightning") return "lightning"
  return network.toLowerCase()
}

// ── Tracked query helpers (capture errors for diagnostics) ───────────────────

type TrackedListResult<T> = {
  ok: boolean
  data: T[]
  rawCount: number
  errorMessage?: string
}

type TrackedSingleResult<T> = {
  ok: boolean
  data: T | null
  found: boolean
  errorMessage?: string
}

async function trackedList<T>(
  label: string,
  query: PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>
): Promise<TrackedListResult<T>> {
  const { data, error } = await query
  if (error) {
    console.warn(`[pinetree-ai-context] ${label} query failed`, {
      source: label,
      errorMessage: error.message
    })
    return { ok: false, data: [], rawCount: 0, errorMessage: error.message }
  }
  const result = data || []
  return { ok: true, data: result, rawCount: result.length }
}

async function trackedSingle<T>(
  label: string,
  query: PromiseLike<{ data: T | null; error: { message: string } | null }>
): Promise<TrackedSingleResult<T>> {
  const { data, error } = await query
  if (error) {
    console.warn(`[pinetree-ai-context] ${label} query failed`, {
      source: label,
      errorMessage: error.message
    })
    return { ok: false, data: null, found: false, errorMessage: error.message }
  }
  return { ok: true, data, found: data !== null }
}

// ── Rail summaries ────────────────────────────────────────────────────────────

function buildRailSummaries(
  normalizedProviders: AssistantProviderContext[],
  normalizedWallets: AssistantWalletContext[],
  availableNetworkKeys: Set<string>
): AssistantRailSummary[] {
  const walletsByNetwork = new Map(normalizedWallets.map((w) => [w.network.toLowerCase(), w]))
  const summaries: AssistantRailSummary[] = []

  for (const provider of normalizedProviders) {
    const key = provider.provider.toLowerCase().trim()
    const isWalletBased = key === "solana" || key === "base"
    const providerStatusOk = isConnectedStatus(provider.status)
    const walletPresent = isWalletBased ? walletsByNetwork.has(key) : true
    const connected = providerStatusOk && walletPresent

    // Use getMerchantAvailableNetworks() result as source of truth for availability
    const availableForPos = availableNetworkKeys.has(key)
    const availableForCheckout = availableNetworkKeys.has(key)

    const sourceSignals: string[] = ["provider-row"]
    if (isWalletBased && walletPresent) sourceSignals.push("wallet-row")
    if (providerStatusOk) sourceSignals.push("connected-status")
    if (provider.enabled) sourceSignals.push("enabled-flag")
    if (availableForPos) sourceSignals.push("available-via-payment-engine")

    const summary: AssistantRailSummary = {
      rail: provider.provider,
      provider: provider.label,
      connected,
      enabled: provider.enabled,
      availableForPos,
      availableForCheckout,
      sourceSignals,
      status: provider.status,
      readySignal: availableForPos
        ? "available-for-payments"
        : connected && provider.enabled
          ? "connected-not-yet-available"
          : connected
            ? "connected-not-enabled"
            : "not-connected"
    }

    if (key === "base") {
      summary.network = "Base"
      summary.asset = "USDC"
    } else if (key === "solana") {
      summary.network = "Solana"
      summary.asset = "USDC"
    }

    summaries.push(summary)
  }

  // Wallet rows without a matching provider entry
  for (const wallet of normalizedWallets) {
    const key = wallet.network.toLowerCase()
    if (!normalizedProviders.some((p) => p.provider.toLowerCase() === key)) {
      summaries.push({
        rail: wallet.network,
        provider: providerLabel(wallet.network),
        network: wallet.network,
        asset: wallet.asset || undefined,
        connected: true,
        enabled: false,
        availableForPos: availableNetworkKeys.has(key),
        availableForCheckout: availableNetworkKeys.has(key),
        sourceSignals: ["wallet-row"],
        status: wallet.status,
        readySignal: "wallet-without-provider",
        updatedAt: wallet.updatedAt || undefined
      })
    }
  }

  return summaries
}

// ── Setup summary ─────────────────────────────────────────────────────────────

function buildSetupSummary(
  input: Omit<PineTreeAssistantContext, "setupSummary" | "diagnostics">,
  diag?: AssistantDiagnostics
): AssistantSetupSummary {
  const settingsFields = input.settings?.businessProfileFields
  const hasBusinessProfile = Boolean(
    settingsFields?.businessName &&
      settingsFields?.businessType &&
      settingsFields?.country
  )
  const connectedWallets = input.wallets.filter((wallet) => wallet.network && wallet.status !== "missing")

  const railSummaries = input.railSummaries
  const connectedRails = railSummaries.filter((r) => r.connected)
  const posAvailableRails = railSummaries.filter((r) => r.availableForPos)
  const checkoutAvailableRails = railSummaries.filter((r) => r.availableForCheckout)
  const connectedRailSet = new Set(connectedRails.map((r) => r.rail.toLowerCase()))

  const connectedProviders = input.providers.filter((provider) =>
    connectedRailSet.has(provider.provider.toLowerCase()) || isConnectedStatus(provider.status)
  )
  const hasActiveCheckoutLink = input.checkoutLinks.activeCount > 0
  const hasConfirmedPayment = input.recentPayments.some((payment) => payment.status === "CONFIRMED")
  const openProblemPayments = input.recentPayments.filter((payment) =>
    ["CREATED", "PENDING", "PROCESSING", "FAILED"].includes(String(payment.status))
  )
  const openTickets = input.recentTickets.filter((ticket) =>
    ["open", "in_review", "waiting_on_merchant"].includes(ticket.status)
  )

  return {
    accountProfile: {
      status: hasBusinessProfile ? "complete" : "incomplete",
      detail: hasBusinessProfile
        ? "Business profile basics are present."
        : "I do not see enough profile information to verify business name, type, and country."
    },
    wallets: {
      status: connectedWallets.length > 0 ? "ready" : "missing",
      detail: connectedWallets.length > 0
        ? `${connectedWallets.map((wallet) => wallet.network).join(", ")} wallet setup found.`
        : diag?.sources.wallets.ok === false
          ? "I could not verify wallet setup — the wallet source returned an error."
          : "I do not see a connected Solana or Base wallet yet."
    },
    paymentRails: {
      status: posAvailableRails.length > 0 ? "ready" : connectedProviders.length > 0 ? "incomplete" : "missing",
      detail: posAvailableRails.length > 0
        ? `${posAvailableRails.map((r) => r.provider).join(", ")} connected and enabled.`
        : connectedProviders.length > 0
          ? `${connectedProviders.map((provider) => provider.label).join(", ")} connected, but I do not see an enabled rail available for payments yet.`
          : diag?.sources.providers.ok === false
            ? "I could not verify payment rail setup — the provider source returned an error."
            : "I do not see a connected payment rail yet."
    },
    checkout: {
      status: hasActiveCheckoutLink && checkoutAvailableRails.length > 0 ? "ready" : "not_ready",
      detail: hasActiveCheckoutLink
        ? checkoutAvailableRails.length > 0
          ? `At least one active payment link found. Available for checkout: ${checkoutAvailableRails.map((r) => r.provider).join(", ")}.`
          : "A checkout link exists, but I do not see an enabled payment rail."
        : "I do not see an active checkout payment link yet."
    },
    pos: {
      status: input.pos.terminalCount > 0 && posAvailableRails.length > 0 ? "ready" : "not_ready",
      detail: input.pos.terminalCount > 0
        ? posAvailableRails.length > 0
          ? `${input.pos.terminalCount} POS terminal${input.pos.terminalCount === 1 ? "" : "s"} found. Available for POS: ${posAvailableRails.map((r) => r.provider).join(", ")}.`
          : "POS terminal setup exists, but I do not see an enabled payment rail."
        : "I do not see a POS terminal yet."
    },
    testPayment: {
      status: hasConfirmedPayment ? "found" : "not_found",
      detail: hasConfirmedPayment
        ? "A recent confirmed payment is visible."
        : "I do not see a recent confirmed test payment yet."
    },
    supportAttention: {
      status: openTickets.length > 0 || openProblemPayments.length > 0 ? "yes" : "no",
      detail: openTickets.length > 0
        ? `${openTickets.length} open or in-review support ticket${openTickets.length === 1 ? "" : "s"} found.`
        : openProblemPayments.length > 0
          ? `${openProblemPayments.length} recent payment${openProblemPayments.length === 1 ? "" : "s"} may need review if the issue is unresolved.`
          : "No obvious support blockers found in recent tickets or payment statuses."
    }
  }
}

// ── Main context loader ───────────────────────────────────────────────────────

export async function getPineTreeAssistantContext(merchantId: string): Promise<PineTreeAssistantContext> {
  const [
    merchantResult,
    settingsResult,
    taxSettingsResult,
    providersResult,
    walletEngineResult,
    availableNetworksResult,
    paymentsResult,
    ticketsResult,
    checkoutLinksEngineResult,
    terminalsResult
  ] = await Promise.all([
    trackedSingle<RawMerchantRow>(
      "merchant",
      db.from("merchants").select("id,business_name,email,status").eq("id", merchantId).maybeSingle()
    ),
    trackedSingle<RawSettingsRow>(
      "merchant_settings",
      db
        .from("merchant_settings")
        .select("business_name,address,city,state,zip,country,phone,business_type,default_provider,pinetree_fee_enabled,pinetree_fee_amount,smart_routing_enabled,auto_conversion_enabled")
        .eq("merchant_id", merchantId)
        .maybeSingle()
    ),
    trackedSingle<RawTaxSettingsRow>(
      "merchant_tax_settings",
      db.from("merchant_tax_settings").select("tax_enabled,tax_rate").eq("merchant_id", merchantId).maybeSingle()
    ),
    trackedList<RawProviderRow>(
      "merchant_providers",
      db
        .from("merchant_providers")
        .select("provider,status,enabled,dashboard_status,created_at,updated_at")
        .eq("merchant_id", merchantId)
        .order("provider", { ascending: true })
    ),
    // Use the same wallet helper as the payment engine (cross-references providers)
    getMerchantWallets(merchantId)
      .then((data) => ({ ok: true as const, data, rawCount: data.length, errorMessage: undefined }))
      .catch((e: unknown) => ({
        ok: false as const,
        data: [] as Awaited<ReturnType<typeof getMerchantWallets>>,
        rawCount: 0,
        errorMessage: e instanceof Error ? e.message : String(e)
      })),
    // Use the same availability helper as POS methods
    getMerchantAvailableNetworks(merchantId)
      .then((networks) => ({ ok: true as const, networks, rawCount: networks.length, errorMessage: undefined }))
      .catch((e: unknown) => ({
        ok: false as const,
        networks: [] as string[],
        rawCount: 0,
        errorMessage: e instanceof Error ? e.message : String(e)
      })),
    trackedList<RawPaymentRow>(
      "payments",
      db
        .from("payments")
        .select("id,status,provider,network,gross_amount,merchant_amount,pinetree_fee,currency,created_at,updated_at")
        .eq("merchant_id", merchantId)
        .order("created_at", { ascending: false })
        .limit(12)
    ),
    trackedList<RawTicketRow>(
      "support_tickets",
      db
        .from("support_tickets")
        .select("id,category,subject,priority,status,related_payment_id,created_at,last_response_at")
        .eq("merchant_id", merchantId)
        .order("created_at", { ascending: false })
        .limit(5)
    ),
    // Use the same checkout link engine as /api/checkout-links (resolves expiry correctly)
    listCheckoutLinksEngine(merchantId)
      .then((data) => ({ ok: true as const, data, rawCount: data.length, errorMessage: undefined }))
      .catch((e: unknown) => ({
        ok: false as const,
        data: [] as CheckoutLinkWithUrl[],
        rawCount: 0,
        errorMessage: e instanceof Error ? e.message : String(e)
      })),
    trackedList<RawTerminalRow>(
      "terminals",
      db.from("terminals").select("status").eq("merchant_id", merchantId)
    )
  ])

  const merchant = merchantResult.data
  const settings = settingsResult.data
  const taxSettings = taxSettingsResult.data
  const normalizedProviders = providersResult.data.map(normalizeProviderRow)
  const merchantWallets = walletEngineResult.data
  const availableNetworks = availableNetworksResult.networks
  const payments = paymentsResult.data
  const tickets = ticketsResult.data
  const checkoutLinksData = checkoutLinksEngineResult.data
  const terminals = terminalsResult.data

  // Map MerchantWallet rows to AssistantWalletContext (no address exposed)
  const normalizedWallets: AssistantWalletContext[] = merchantWallets.map((wallet) => ({
    id: wallet.id,
    network: wallet.network,
    asset: wallet.asset || null,
    walletType: wallet.wallet_type || null,
    provider: null,
    status: "connected",
    updatedAt: wallet.created_at || null
  }))

  // Build available provider key set from getMerchantAvailableNetworks()
  const availableNetworkKeys = new Set(availableNetworks.map(networkToProviderKey))

  const railSummaries = buildRailSummaries(normalizedProviders, normalizedWallets, availableNetworkKeys)

  const setupSourceSummary: AssistantSetupSourceSummary = {
    providerRows: normalizedProviders.length,
    walletRows: normalizedWallets.length,
    connectedRails: railSummaries.filter((r) => r.connected).length,
    enabledRails: railSummaries.filter((r) => r.enabled).length,
    posAvailableRails: railSummaries.filter((r) => r.availableForPos).length,
    checkoutAvailableRails: railSummaries.filter((r) => r.availableForCheckout).length,
    railNames: railSummaries.map((r) => r.rail)
  }

  // Build diagnostics for debug/support use
  const diagnostics: AssistantDiagnostics = {
    merchantIdMasked: maskMerchantId(merchantId),
    sources: {
      merchantProfile: {
        source: "merchants",
        ok: merchantResult.ok,
        rawCount: merchantResult.found ? 1 : 0,
        found: merchantResult.found,
        errorMessage: merchantResult.errorMessage
      },
      providers: {
        source: "merchant_providers",
        ok: providersResult.ok,
        rawCount: providersResult.rawCount,
        connectedCount: normalizedProviders.filter((p) => isConnectedStatus(p.status)).length,
        enabledCount: normalizedProviders.filter((p) => p.enabled).length,
        providerKeys: normalizedProviders.map((p) => p.provider),
        statuses: [...new Set(normalizedProviders.map((p) => p.status))],
        errorMessage: providersResult.errorMessage
      },
      wallets: {
        source: "merchant_wallets via getMerchantWallets()",
        ok: walletEngineResult.ok,
        rawCount: walletEngineResult.rawCount,
        addressPresentCount: normalizedWallets.length,
        networks: [...new Set(normalizedWallets.map((w) => w.network))],
        assets: [...new Set(normalizedWallets.map((w) => w.asset).filter(Boolean) as string[])],
        walletTypes: [...new Set(normalizedWallets.map((w) => w.walletType).filter(Boolean) as string[])],
        errorMessage: walletEngineResult.errorMessage
      },
      availableNetworks: {
        source: "getMerchantAvailableNetworks()",
        ok: availableNetworksResult.ok,
        rawCount: availableNetworksResult.rawCount,
        networks: availableNetworksResult.networks,
        errorMessage: availableNetworksResult.errorMessage
      },
      checkout: {
        source: "listCheckoutLinksEngine()",
        ok: checkoutLinksEngineResult.ok,
        rawCount: checkoutLinksEngineResult.rawCount,
        activeCount: checkoutLinksData.filter((l) => l.resolvedStatus === "active").length,
        errorMessage: checkoutLinksEngineResult.errorMessage
      },
      payments: {
        source: "payments",
        ok: paymentsResult.ok,
        rawCount: paymentsResult.rawCount,
        confirmedCount: payments.filter((p) => String(p.status) === "CONFIRMED").length,
        pendingCount: payments.filter((p) => String(p.status) === "PENDING").length,
        processingCount: payments.filter((p) => String(p.status) === "PROCESSING").length,
        failedCount: payments.filter((p) => String(p.status) === "FAILED").length,
        incompleteCount: payments.filter((p) => String(p.status) === "INCOMPLETE").length,
        recentProviders: [...new Set(payments.map((p) => p.provider).filter(Boolean) as string[])],
        recentNetworks: [...new Set(payments.map((p) => p.network).filter(Boolean) as string[])]
      },
      tickets: {
        source: "support_tickets",
        ok: ticketsResult.ok,
        rawCount: ticketsResult.rawCount,
        errorMessage: ticketsResult.errorMessage
      },
      terminals: {
        source: "terminals",
        ok: terminalsResult.ok,
        rawCount: terminalsResult.rawCount,
        errorMessage: terminalsResult.errorMessage
      }
    }
  }

  if (process.env.NODE_ENV !== "production") {
    const sourceErrors = Object.entries(diagnostics.sources)
      .filter(([, s]) => !s.ok)
      .map(([key, s]) => ({ key, errorMessage: (s as AssistantSourceDiagnostic).errorMessage }))

    console.info("[pinetree-ai-context] context loaded", {
      merchantIdMasked: diagnostics.merchantIdMasked,
      setupSourceSummary,
      sourceErrors: sourceErrors.length > 0 ? sourceErrors : "none"
    })
  }

  const safeContext: Omit<PineTreeAssistantContext, "setupSummary" | "diagnostics"> = {
    merchant: merchant
      ? {
          id: String(merchant.id),
          businessName: merchant.business_name ? String(merchant.business_name) : null,
          email: merchant.email ? String(merchant.email) : null,
          status: merchant.status ? String(merchant.status) : null
        }
      : null,
    settings: {
      defaultProvider: settings?.default_provider ? String(settings.default_provider) : null,
      smartRoutingEnabled: typeof settings?.smart_routing_enabled === "boolean" ? settings.smart_routing_enabled : null,
      autoConversionEnabled: typeof settings?.auto_conversion_enabled === "boolean" ? settings.auto_conversion_enabled : null,
      pinetreeFeeEnabled: typeof settings?.pinetree_fee_enabled === "boolean" ? settings.pinetree_fee_enabled : null,
      pinetreeFeeAmount: settings?.pinetree_fee_amount === undefined || settings?.pinetree_fee_amount === null ? null : Number(settings.pinetree_fee_amount),
      taxEnabled: typeof taxSettings?.tax_enabled === "boolean" ? taxSettings.tax_enabled : null,
      taxRate: taxSettings?.tax_rate === undefined || taxSettings?.tax_rate === null ? null : Number(taxSettings.tax_rate),
      businessProfileFields: {
        businessName: settings?.business_name ? String(settings.business_name) : merchant?.business_name ? String(merchant.business_name) : null,
        address: settings?.address ? String(settings.address) : null,
        city: settings?.city ? String(settings.city) : null,
        state: settings?.state ? String(settings.state) : null,
        zip: settings?.zip ? String(settings.zip) : null,
        country: settings?.country ? String(settings.country) : null,
        phone: settings?.phone ? String(settings.phone) : null,
        businessType: settings?.business_type ? String(settings.business_type) : null
      }
    },
    providers: normalizedProviders,
    wallets: normalizedWallets,
    railSummaries,
    setupSourceSummary,
    recentPayments: payments.map((payment) => ({
      id: String(payment.id),
      status: payment.status,
      provider: payment.provider ? String(payment.provider) : null,
      network: payment.network ? String(payment.network) : null,
      grossAmount: Number(payment.gross_amount || 0),
      merchantAmount: Number(payment.merchant_amount || 0),
      pinetreeFee: Number(payment.pinetree_fee || 0),
      currency: String(payment.currency || "USD"),
      createdAt: String(payment.created_at),
      updatedAt: payment.updated_at ? String(payment.updated_at) : null
    })),
    recentTickets: tickets.map((ticket) => ({
      id: String(ticket.id),
      category: String(ticket.category || "General Support"),
      subject: String(ticket.subject || "Support ticket"),
      priority: String(ticket.priority || "Normal"),
      status: String(ticket.status || "open"),
      relatedPaymentId: ticket.related_payment_id ? String(ticket.related_payment_id) : null,
      createdAt: String(ticket.created_at),
      lastResponseAt: ticket.last_response_at ? String(ticket.last_response_at) : null
    })),
    // Use resolvedStatus from listCheckoutLinksEngine (handles expiry correctly)
    checkoutLinks: {
      activeCount: checkoutLinksData.filter((l) => l.resolvedStatus === "active").length,
      totalCount: checkoutLinksData.length,
      mostRecentName: checkoutLinksData[0]?.name || null,
      mostRecentStatus: checkoutLinksData[0]?.resolvedStatus || null
    },
    pos: {
      terminalCount: terminals.length,
      activeTerminalCount: terminals.filter((t) => isTerminalActive(t.status)).length
    }
  }

  return {
    ...safeContext,
    setupSummary: buildSetupSummary(safeContext, diagnostics),
    diagnostics
  }
}
