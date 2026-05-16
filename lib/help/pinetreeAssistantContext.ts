import { supabase, supabaseAdmin } from "@/database"
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

type RawWalletRow = {
  id?: string | null
  network?: string | null
  asset?: string | null
  wallet_type?: string | null
  wallet_address?: string | null
  status?: string | null
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
  status?: string
  readySignal?: string
  updatedAt?: string
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
}

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
    enabled: Boolean(row.enabled),
    dashboardStatus: row.dashboard_status ? String(row.dashboard_status) : null
  }
}

function isConnectedStatus(status: string) {
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

async function safeSingle<T>(label: string, query: PromiseLike<{ data: T | null; error: { message: string } | null }>) {
  const { data, error } = await query
  if (error) {
    console.warn(`[pinetree-ai-context] ${label} unavailable`, { error: error.message })
    return null
  }
  return data
}

function buildRailSummaries(
  normalizedProviders: AssistantProviderContext[],
  normalizedWallets: AssistantWalletContext[]
): AssistantRailSummary[] {
  const walletsByNetwork = new Map(normalizedWallets.map((w) => [w.network.toLowerCase(), w]))
  const summaries: AssistantRailSummary[] = []

  for (const provider of normalizedProviders) {
    const key = provider.provider.toLowerCase().trim()
    const isWalletBased = key === "solana" || key === "base"
    const providerStatusOk = isConnectedStatus(provider.status)
    const walletPresent = isWalletBased ? walletsByNetwork.has(key) : true
    const connected = providerStatusOk && walletPresent

    const summary: AssistantRailSummary = {
      rail: provider.provider,
      provider: provider.label,
      connected,
      enabled: provider.enabled,
      status: provider.status,
      readySignal: connected && provider.enabled
        ? "connected-and-enabled"
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
        status: wallet.status,
        readySignal: "wallet-without-provider",
        updatedAt: wallet.updatedAt || undefined
      })
    }
  }

  return summaries
}

async function safeList<T>(label: string, query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const { data, error } = await query
  if (error) {
    console.warn(`[pinetree-ai-context] ${label} unavailable`, { error: error.message })
    return []
  }
  return data || []
}

function buildSetupSummary(input: Omit<PineTreeAssistantContext, "setupSummary">): AssistantSetupSummary {
  const settingsFields = input.settings?.businessProfileFields
  const hasBusinessProfile = Boolean(
    settingsFields?.businessName &&
      settingsFields?.businessType &&
      settingsFields?.country
  )
  const connectedWallets = input.wallets.filter((wallet) => wallet.network && wallet.status !== "missing")

  const railSummaries = input.railSummaries
  const connectedRails = railSummaries.filter((r) => r.connected)
  const enabledRailSet = new Set(railSummaries.filter((r) => r.connected && r.enabled).map((r) => r.rail.toLowerCase()))
  const connectedRailSet = new Set(connectedRails.map((r) => r.rail.toLowerCase()))

  const connectedProviders = input.providers.filter((provider) =>
    connectedRailSet.has(provider.provider.toLowerCase()) || isConnectedStatus(provider.status)
  )
  const enabledProviders = input.providers.filter((provider) =>
    enabledRailSet.has(provider.provider.toLowerCase()) || (isConnectedStatus(provider.status) && provider.enabled)
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
        : "I do not see a connected Solana or Base wallet yet."
    },
    paymentRails: {
      status: enabledProviders.length > 0 ? "ready" : connectedProviders.length > 0 ? "incomplete" : "missing",
      detail: enabledProviders.length > 0
        ? `${enabledProviders.map((provider) => provider.label).join(", ")} enabled.`
        : connectedProviders.length > 0
          ? `${connectedProviders.map((provider) => provider.label).join(", ")} connected, but I do not see an enabled rail.`
          : "I do not see a connected payment rail yet."
    },
    checkout: {
      status: hasActiveCheckoutLink && enabledProviders.length > 0 ? "ready" : "not_ready",
      detail: hasActiveCheckoutLink
        ? enabledProviders.length > 0
          ? "At least one active payment link and enabled rail are present."
          : "A checkout link exists, but I do not see an enabled payment rail."
        : "I do not see an active checkout payment link yet."
    },
    pos: {
      status: input.pos.terminalCount > 0 && enabledProviders.length > 0 ? "ready" : "not_ready",
      detail: input.pos.terminalCount > 0
        ? enabledProviders.length > 0
          ? `${input.pos.terminalCount} POS terminal${input.pos.terminalCount === 1 ? "" : "s"} found with an enabled rail.`
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

export async function getPineTreeAssistantContext(merchantId: string): Promise<PineTreeAssistantContext> {
  const [
    merchant,
    settings,
    taxSettings,
    providers,
    wallets,
    payments,
    tickets,
    checkoutLinks,
    terminals
  ] = await Promise.all([
    safeSingle<RawMerchantRow>("merchant", db.from("merchants").select("id,business_name,email,status").eq("id", merchantId).maybeSingle()),
    safeSingle<RawSettingsRow>(
      "merchant settings",
      db
        .from("merchant_settings")
        .select("business_name,address,city,state,zip,country,phone,business_type,default_provider,pinetree_fee_enabled,pinetree_fee_amount,smart_routing_enabled,auto_conversion_enabled")
        .eq("merchant_id", merchantId)
        .maybeSingle()
    ),
    safeSingle<RawTaxSettingsRow>(
      "tax settings",
      db.from("merchant_tax_settings").select("tax_enabled,tax_rate").eq("merchant_id", merchantId).maybeSingle()
    ),
    safeList<RawProviderRow>(
      "providers",
      db
        .from("merchant_providers")
        .select("provider,status,enabled,dashboard_status,created_at,updated_at")
        .eq("merchant_id", merchantId)
        .order("provider", { ascending: true })
    ),
    safeList<RawWalletRow>(
      "wallets",
      db
        .from("merchant_wallets")
        .select("id,network,asset,wallet_type,wallet_address,status,created_at,updated_at")
        .eq("merchant_id", merchantId)
        .order("created_at", { ascending: false })
    ),
    safeList<{
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
    }>(
      "payments",
      db
        .from("payments")
        .select("id,status,provider,network,gross_amount,merchant_amount,pinetree_fee,currency,created_at,updated_at")
        .eq("merchant_id", merchantId)
        .order("created_at", { ascending: false })
        .limit(12)
    ),
    safeList<{
      id: string
      category: string
      subject: string
      priority: string
      status: string
      related_payment_id?: string | null
      created_at: string
      last_response_at?: string | null
    }>(
      "support tickets",
      db
        .from("support_tickets")
        .select("id,category,subject,priority,status,related_payment_id,created_at,last_response_at")
        .eq("merchant_id", merchantId)
        .order("created_at", { ascending: false })
        .limit(5)
    ),
    safeList<{
      name?: string | null
      status?: string | null
      created_at?: string | null
    }>(
      "checkout links",
      db
        .from("checkout_links")
        .select("name,status,created_at")
        .eq("merchant_id", merchantId)
        .order("created_at", { ascending: false })
        .limit(10)
    ),
    safeList<{ status?: string | null }>(
      "terminals",
      db.from("terminals").select("status").eq("merchant_id", merchantId)
    )
  ])

  const normalizedProviders = providers.map(normalizeProviderRow)
  const normalizedWallets = wallets
    .filter((wallet) => Boolean(String(wallet.wallet_address || "").trim()))
    .map((wallet) => ({
      id: String(wallet.id || ""),
      network: String(wallet.network || "unknown"),
      asset: wallet.asset ? String(wallet.asset) : null,
      walletType: wallet.wallet_type ? String(wallet.wallet_type) : null,
      provider: null,
      status: "connected",
      updatedAt: wallet.updated_at ? String(wallet.updated_at) : wallet.created_at ? String(wallet.created_at) : null
    }))

  const railSummaries = buildRailSummaries(normalizedProviders, normalizedWallets)

  console.info("[pinetree-ai-context] context loaded", {
    walletCount: normalizedWallets.length,
    providerCount: normalizedProviders.length,
    connectedRails: railSummaries.filter((r) => r.connected).length,
    enabledRails: railSummaries.filter((r) => r.enabled).length,
    railNames: railSummaries.map((r) => r.rail)
  })

  const safeContext: Omit<PineTreeAssistantContext, "setupSummary"> = {
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
    checkoutLinks: {
      activeCount: checkoutLinks.filter((link) => link.status === "active").length,
      totalCount: checkoutLinks.length,
      mostRecentName: checkoutLinks[0]?.name ? String(checkoutLinks[0].name) : null,
      mostRecentStatus: checkoutLinks[0]?.status ? String(checkoutLinks[0].status) : null
    },
    pos: {
      terminalCount: terminals.length,
      activeTerminalCount: terminals.filter((terminal) => isTerminalActive(terminal.status)).length
    }
  }

  return {
    ...safeContext,
    setupSummary: buildSetupSummary(safeContext)
  }
}
