"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useDashboardAutoRefresh } from "@/hooks/useDashboardAutoRefresh"
import ToggleSwitch from "@/components/ui/ToggleSwitch"
import { toast } from "sonner"
import { ChevronRight, X } from "lucide-react"
import {
  DashboardHeroCard,
  DashboardSection,
  ProviderStatusPill,
  dashboardPageTitleClass,
  dashboardSectionLabelClass
} from "@/components/dashboard/DashboardPrimitives"
import {
  getShift4DisplayStatus,
  type Shift4DisplayStatus
} from "@/lib/shift4DisplayStatus"
import { isStripeConnectReady } from "@/lib/providers/cardProviderReadiness"

const shift4ApplicationUrl =
  process.env.NEXT_PUBLIC_SHIFT4_APPLICATION_URL ||
  process.env.SHIFT4_APPLICATION_URL ||
  ""
const canonicalLightningMode =
  process.env.NEXT_PUBLIC_PINE_TREE_LIGHTNING_MODE === "speed_platform_treasury_sweep" ||
  (
    process.env.PINE_TREE_LIGHTNING_PROVIDER === "speed" &&
    process.env.PINE_TREE_LIGHTNING_SETTLEMENT_MODE === "speed_platform_treasury_sweep"
  )

// When true, crypto rails are managed through PineTree Wallet.
// The connect/disconnect UI is hidden; a read-only "Managed" card is shown instead.
const canonicalWalletMode = process.env.NEXT_PUBLIC_PINE_TREE_WALLET_CANONICAL === "true"

type CardOnboardingProvider = "shift4" | "stripe" | "fluidpay"
type CardApplicationStatus = "Not started" | "Pending" | "Approved" | "Denied"

const cardProviderSetupContent: Record<CardOnboardingProvider, {
  name: string
  cta: string
  modalTitle: string
  subtitle: string
  primaryAction: string
  missingUrlMessage: string
}> = {
  shift4: {
    name: "Shift4",
    cta: "Start Shift4 Application",
    modalTitle: "Shift4 Merchant Application",
    subtitle: "Complete the application to begin onboarding for card and crypto payment acceptance through Shift4.",
    primaryAction: "Begin Application",
    missingUrlMessage: "Application link not configured yet."
  },
  stripe: {
    name: "Stripe",
    cta: "Start Stripe Setup",
    modalTitle: "Stripe Merchant Setup",
    subtitle: "Complete setup to begin onboarding for card payment acceptance through Stripe.",
    primaryAction: "Begin Setup",
    missingUrlMessage: "Setup link not configured yet."
  },
  fluidpay: {
    name: "Fluid Pay",
    cta: "Start Fluid Pay Setup",
    modalTitle: "Fluid Pay Merchant Setup",
    subtitle: "Complete setup to begin onboarding for card payment acceptance through Fluid Pay.",
    primaryAction: "Begin Setup",
    missingUrlMessage: "Setup link not configured yet."
  }
}


type ProviderCredentials = {
  api_key?: string
  wallet?: string
  wallet_type?: string | null
  wallet_label?: string
  provider_model?: string
  account_reference?: string
  merchant_approval_status?: string
  api_status?: string
  webhook_status?: string
  notes?: string
  [key: string]: unknown
}


type ProviderRecord = {
  provider: string
  status: string
  enabled: boolean
  credentials?: ProviderCredentials | null
  dashboard_status?: "not_configured" | "address_needs_verification" | "provider_unavailable" | "connected"
  capabilities?: {
    supportsLightningInvoice?: boolean
    supportsFeeAtPaymentTime?: boolean
    supportsSplitSettlement?: boolean
    supportsWebhookConfirmation?: boolean
  } | null
  readiness?: {
    ready: boolean
    missingPermissions: string[]
    reason: string | null
  } | null
}

type WalletRecord = {
  id?: string
  merchant_id: string
  network: string
  asset: string
  wallet_address: string
  wallet_type?: string | null
}

type ProvidersApiResponse = {
  success?: boolean
  providers?: ProviderRecord[]
  wallets?: WalletRecord[]
  pineTreeWalletProfile?: {
    baseAddressPresent: boolean
    solanaAddressPresent: boolean
    bitcoinAddressPresent: boolean
  } | null
  settings?: {
    smart_routing_enabled: boolean
    auto_conversion_enabled: boolean
  }
  error?: string
}


function getConnectedAndEnabledProvidersCount(providers: ProviderRecord[]) {
  return providers.filter(
    (p) => p.enabled && (p.status === "connected" || p.status === "active")
  ).length
}

function formatWalletLabel(
  provider: string,
  walletType?: string | null,
  asset?: string | null
) {
  if (provider === "solana") {
    if (String(walletType || asset).includes("PHANTOM")) return "Phantom"
    if (String(walletType || asset).includes("SOLFLARE")) return "Solflare"
    return "Solana Wallet"
  }

  if (provider === "base") {
    if (String(walletType || asset).includes("BASEAPP")) return "Base Wallet"
    if (String(walletType || asset).includes("METAMASK")) return "MetaMask"
    if (String(walletType || asset).includes("TRUST")) return "Trust Wallet"
    if (String(walletType || asset).includes("BASE")) return "Base Wallet"
    return "Base Wallet"
  }

  return ""
}


export default function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderRecord[]>([])
  const [wallets, setWallets] = useState<WalletRecord[]>([])
  const [pineTreeWalletProfile, setPineTreeWalletProfile] = useState<ProvidersApiResponse["pineTreeWalletProfile"]>(null)
  const [activeProvider, setActiveProvider] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState("")
  const [shift4ApplicationStatusOverride, setShift4ApplicationStatusOverride] = useState<"Pending" | null>(null)
  const [stripeApplicationStatusOverride, setStripeApplicationStatusOverride] = useState<"Pending" | null>(null)
  const [fluidPayApplicationStatusOverride, setFluidPayApplicationStatusOverride] = useState<"Pending" | null>(null)
  const [setupLoadingProvider, setSetupLoadingProvider] = useState<CardOnboardingProvider | null>(null)
  const [setupErrors, setSetupErrors] = useState<Partial<Record<CardOnboardingProvider, string>>>({})
  const [setupReturnNotice, setSetupReturnNotice] = useState("")
  const [loading, setLoading] = useState(false)

  const [smartRouting, setSmartRouting] = useState(false)
  const [autoConversion, setAutoConversion] = useState(false)
  const [engineSettingsPanel, setEngineSettingsPanel] = useState<"routing" | "conversion" | null>(null)
  const [providerFilter, setProviderFilter] = useState<"all" | "card" | "crypto">("all")

  const closeProviderModal = useCallback(() => {
    setActiveProvider(null)
    setInputValue("")
    setSetupErrors({})
  }, [])

  const callProvidersApi = useCallback(async (method: "GET" | "POST", body?: unknown) => {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token

    if (!token) {
      throw new Error("Please sign in again")
    }

    const res = await fetch("/api/providers", {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: method === "POST" ? JSON.stringify(body || {}) : undefined,
      credentials: "include",
      cache: "no-store"
    })

    const payload = (await res.json().catch(() => null)) as ProvidersApiResponse | null

    if (!res.ok) {
      throw new Error(payload?.error || "Provider API failed")
    }

    return payload || {}
  }, [])

  const applyProvidersPayload = useCallback((payload: ProvidersApiResponse) => {
    setProviders(payload.providers || [])
    setWallets(payload.wallets || [])
    setPineTreeWalletProfile(payload.pineTreeWalletProfile || null)
    setSmartRouting(Boolean(payload.settings?.smart_routing_enabled))
    setAutoConversion(Boolean(payload.settings?.auto_conversion_enabled))
  }, [])

  const loadAll = useCallback(async () => {
    try {
      const payload = await callProvidersApi("GET")
      applyProvidersPayload(payload)
    } catch (error) {
      console.error("Failed to load provider dashboard:", error)
      toast.error(error instanceof Error ? error.message : "Failed to load providers")
    }
  }, [applyProvidersPayload, callProvidersApi])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const provider = params.get("provider")
    const setup = params.get("setup")
    if (!isManagedCardProvider(provider) || provider === "shift4" || setup !== "returned") return

    let cancelled = false
    async function recordSetupReturn() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token || !isManagedCardProvider(provider) || provider === "shift4") return

        const res = await fetch(`/api/providers/${provider}/setup-return`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
          cache: "no-store"
        })
        const payload = await res.json().catch(() => null)

        if (!res.ok || !payload?.ok) {
          throw new Error(payload?.error || "Failed to record setup return")
        }

        if (!cancelled) {
          if (provider === "stripe") {
            setStripeApplicationStatusOverride("Pending")
          } else {
            setFluidPayApplicationStatusOverride("Pending")
          }
          setSetupReturnNotice("Setup received. PineTree will update this provider after approval is complete.")
          await loadAll()
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "Failed to record setup return")
        }
      }
    }

    void recordSetupReturn()

    return () => {
      cancelled = true
    }
  }, [loadAll])

  // Refresh provider statuses when returning to this tab or refocusing
  // (e.g. after completing OAuth flow in another tab).
  useDashboardAutoRefresh({ refresh: loadAll, refreshOnMount: false })

  useEffect(() => {
    if (!activeProvider) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeProviderModal()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [activeProvider, closeProviderModal])

  async function updateSettings(field: string, value: boolean) {
    try {
      const payload = await callProvidersApi("POST", {
        action: "updateSettings",
        field,
        value
      })
      applyProvidersPayload(payload)
      toast.success("Engine settings updated")
    } catch (error) {
      console.error("Failed to update settings:", error)
      toast.error(error instanceof Error ? error.message : "Failed to update settings")
    }
  }

  function getProvider(provider: string) {
    return providers.find((p) => p.provider === provider)
  }

  function getWallet(provider: string) {
    return wallets.find((w) => w.network === provider)
  }

  function getStatus(provider: string) {
    if (provider === "lightning") {
      const p = getProvider(provider)
      if (!p || p.dashboard_status === "not_configured") return "Not connected"
      if (p.dashboard_status === "address_needs_verification") return "Needs verification"
      if (p.dashboard_status === "provider_unavailable") return "Provider unavailable"
      if (p.dashboard_status === "connected" && p.readiness && !p.readiness.ready) return "Needs permissions"
      if (p.dashboard_status === "connected") return "Connected"
      return "Not connected"
    }

    if (provider === "lightning_speed") {
      const p = getProvider(provider)
      if (!p || p.dashboard_status === "not_configured") return "Not connected"
      if (p.dashboard_status === "provider_unavailable") return "Missing env"
      if (p.readiness?.ready) return "Ready"
      if (p.dashboard_status === "connected") return "Needs account ID"
      return "Needs setup"
    }

    const wallet = getWallet(provider)

    if ((provider === "solana" || provider === "base") && wallet) return "Connected"

    const p = getProvider(provider)
    if (isManagedCardProvider(provider)) {
      if (provider === "stripe") {
        if (isStripeConnectReady(p || { provider: "stripe" })) return "Connected"
        const credentials = p?.credentials
        const setupInProgress = Boolean(
          p?.enabled &&
          p.status === "active" &&
          (credentials?.details_submitted || credentials?.stripe_account_id)
        )
        return setupInProgress ? "Pending" : "Not connected"
      }
      const applicationStatus = getCardProviderApplicationStatus(provider, p)
      if (applicationStatus === "Approved") return "Connected"
      if (applicationStatus === "Pending") return "Pending"
      if (applicationStatus === "Denied") return "Denied"
      return "Not connected"
    }

    if (!p) return "Not Connected"

    if (p.status === "connected" || p.status === "active") return "Connected"

    return "Not Connected"
  }

  function isEnabled(provider: string) {
    if (provider === "lightning") {
      const speedProv = getProvider("lightning_speed")
      if (speedProv?.enabled) return true
      const p = getProvider(provider)
      const status = getStatus(provider)
      return Boolean(p?.enabled && status === "Connected")
    }

    const wallet = getWallet(provider)

    if ((provider === "solana" || provider === "base") && wallet) {
      const p = getProvider(provider)
      return p?.enabled ?? true
    }

    const p = getProvider(provider)
    return p?.enabled ?? false
  }

function EngineSettingStatus({
  label,
  value,
  active
}: {
  label: string
  value: string
  active: boolean
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3">
      <p className="text-sm font-medium text-gray-700">{label}</p>
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
        active ? "bg-blue-600 text-white" : "border border-gray-200 bg-white text-gray-600"
      }`}>
        {value}
      </span>
    </div>
  )
}

  function openProvider(provider: string) {
    const p = getProvider(provider)
    const existingWallet = getWallet(provider)
    const modalProvider = provider === "speed" ? "lightning" : provider

    if (provider === "shift4") {
      setInputValue("")
    } else if (p?.credentials?.api_key) {
      setInputValue(p.credentials.api_key)
    } else if (p?.credentials?.wallet) {
      setInputValue(p.credentials.wallet)
    } else if (existingWallet?.wallet_address) {
      setInputValue(existingWallet.wallet_address)
    } else {
      setInputValue("")
    }

    setActiveProvider(modalProvider)
  }

  async function saveProvider(provider: string) {
    setLoading(true)

    try {
      if (provider === "coinbase") {
        if (!inputValue.trim()) {
          toast.error("Required field missing")
          return
        }
      }

      const payload = await callProvidersApi("POST", {
        action: "saveProvider",
        provider,
        apiKey: provider === "coinbase" ? inputValue.trim() : undefined
      })

      applyProvidersPayload(payload)
      closeProviderModal()
      toast.success("Provider connected")
    } catch (err: unknown) {
      console.error("SaveProvider crash:", err)
      toast.error(err instanceof Error ? err.message : "Unexpected error")
    } finally {
      setLoading(false)
    }
  }

  async function disconnect(provider: string) {
    try {
      const payload = await callProvidersApi("POST", {
        action: "disconnectProvider",
        provider
      })
      applyProvidersPayload(payload)
      toast.success("Provider disconnected")
    } catch (error) {
      console.error("Failed disconnecting provider:", error)
      toast.error(error instanceof Error ? error.message : "Failed to disconnect provider")
    }
  }

  async function toggleProvider(provider: string, value: boolean) {
    if (value && (provider === "solana" || provider === "base")) {
      const railReady = canonicalWalletMode
        ? isCanonicalRailConfigured(provider as "solana" | "base")
        : Boolean(getWallet(provider))
      if (!railReady) {
        toast.error(canonicalWalletMode ? "Wallet address not provisioned" : "Connect wallet first")
        return
      }
    }

    if (value && provider === "lightning" && !canonicalWalletMode && getLightningCardState().status !== "Connected") {
      toast.error("Connect a Lightning wallet first.")
      return
    }

    try {
      const payload = await callProvidersApi("POST", {
        action: "toggleProvider",
        provider,
        value
      })
      applyProvidersPayload(payload)
      toast.success(value ? "Provider enabled" : "Provider disabled")
    } catch (error) {
      console.error("Failed updating provider:", error)
      toast.error(error instanceof Error ? error.message : "Failed to update provider")
    }
  }

  async function beginCardProviderSetup(provider: CardOnboardingProvider) {
    setSetupErrors((current) => ({ ...current, [provider]: "" }))

    if (provider === "shift4") {
      const url = getCardProviderSetupUrl(provider).trim()
      if (!url) return
      window.open(url, "_blank", "noopener,noreferrer")
      setShift4ApplicationStatusOverride("Pending")
      return
    }

    setSetupLoadingProvider(provider)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        throw new Error("Please sign in again")
      }

      const res = await fetch(`/api/providers/${provider}/start-setup`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
        cache: "no-store"
      })
      const payload = await res.json().catch(() => null)

      if (!res.ok || !payload?.ok || !payload?.url) {
        throw new Error(payload?.error || "Failed to start setup")
      }

      if (provider === "stripe") {
        setStripeApplicationStatusOverride("Pending")
      } else {
        setFluidPayApplicationStatusOverride("Pending")
      }

      window.location.assign(String(payload.url))
    } catch (error) {
      setSetupErrors((current) => ({
        ...current,
        [provider]: error instanceof Error ? error.message : "Failed to start setup"
      }))
    } finally {
      setSetupLoadingProvider(null)
    }
  }

  function optionButtonClass(selected: boolean) {
    return `border rounded-lg py-2 px-3 text-sm transition ${
      selected
        ? "border-blue-600 bg-blue-50 text-blue-600"
        : "border-blue-600 bg-white text-blue-600 hover:bg-blue-50"
    }`
  }

  function actionButtonClass() {
    return "rounded-lg border border-blue-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
  }

  function primaryButtonClass() {
    return "rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
  }

  function secondaryButtonClass() {
    return "rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
  }

  function compactPrimaryButtonClass() {
    return "inline-flex h-10 items-center justify-center rounded-lg bg-blue-600 px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
  }

  function compactSecondaryButtonClass() {
    return "inline-flex h-10 items-center justify-center rounded-lg border border-gray-200 bg-white px-3.5 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-gray-300 hover:bg-gray-50"
  }

  function quietButtonClass() {
    return "inline-flex h-10 items-center justify-center rounded-lg px-2.5 text-sm font-semibold text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
  }

  function lightningInputClass() {
    return "mt-2 w-full rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-sm text-gray-950 shadow-sm outline-none transition placeholder:text-gray-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
  }

  function statusTone(status: string) {
    if (status === "Connected" || status === "Ready" || status === "Managed") return "blue"
    if (status === "Pending" || status === "Setup needed" || status === "Setup pending" || status === "Needs verification" || status === "Needs permissions" || status === "Setup only") return "amber"
    if (status === "Provider unavailable" || status === "Missing env" || status === "Denied") return "red"
    return "default"
  }

  function formatCredentialPart(value: string, leading = 8, trailing = 4) {
    const trimmed = value.trim()
    if (trimmed.length <= leading + trailing + 3) return trimmed
    return `${trimmed.slice(0, leading)}...${trimmed.slice(-trailing)}`
  }

  function getLightningCardState() {
    if (canonicalWalletMode || canonicalLightningMode) {
      return {
        status: "Managed" as const,
        connectionType: "pinetree" as const,
        summary: "Bitcoin Lightning payments settle to the merchant's PineTree Wallet.",
        detail: "PineTree Wallet"
      }
    }

    const speedProvider = getProvider("lightning_speed")
    const speedCredentials = speedProvider?.credentials || {}
    const hasMerchantSpeedAccount = Boolean(String(speedCredentials.account_id || "").trim())
    const nwcStatus = getStatus("lightning")
    const nwcConnected = nwcStatus === "Connected"

    if (hasMerchantSpeedAccount) {
      return {
        status: "Connected" as const,
        connectionType: "speed" as const,
        summary: "Bitcoin Lightning payments route through the merchant Speed Account ID.",
        detail: formatCredentialPart(String(speedCredentials.account_id), 10, 4)
      }
    }

    if (nwcConnected) {
      const walletLabel = String(getProvider("lightning")?.credentials?.wallet_label || "Lightning Wallet")
      return {
        status: "Connected" as const,
        connectionType: "nwc" as const,
        summary: "Bitcoin Lightning payments route through a legacy Lightning wallet.",
        detail: walletLabel
      }
    }

    return {
      status: "Not Connected" as const,
      connectionType: null,
      summary: "Bitcoin Lightning is managed through PineTree Wallet.",
      detail: ""
    }
  }

  function isCanonicalRailConfigured(provider: "solana" | "base" | "lightning") {
    if (provider === "solana") return Boolean(pineTreeWalletProfile?.solanaAddressPresent)
    if (provider === "base") return Boolean(pineTreeWalletProfile?.baseAddressPresent)
    return Boolean(pineTreeWalletProfile?.bitcoinAddressPresent)
  }

  function shift4StatusBadgeClass(tone: Shift4DisplayStatus["tone"]) {
    if (tone === "blue") return "border-blue-200 bg-blue-50 text-blue-700"
    if (tone === "amber") return "border-amber-200 bg-amber-50 text-amber-800"
    if (tone === "red") return "border-red-200 bg-red-50 text-red-700"
    return "border-gray-200 bg-gray-50 text-gray-600"
  }

  function isManagedCardProvider(provider: string | null | undefined): provider is CardOnboardingProvider {
    return provider === "shift4" || provider === "stripe" || provider === "fluidpay"
  }

  function getCardProviderName(provider: CardOnboardingProvider) {
    return cardProviderSetupContent[provider].name
  }

  function getCardProviderSetupUrl(provider: CardOnboardingProvider) {
    if (provider === "shift4") return shift4ApplicationUrl
    return ""
  }

  function getCardProviderSetupCta(provider: CardOnboardingProvider) {
    return cardProviderSetupContent[provider].cta
  }

  function getCardProviderModalTitle(provider: CardOnboardingProvider) {
    return cardProviderSetupContent[provider].modalTitle
  }

  function getCardProviderModalSubtitle(provider: CardOnboardingProvider) {
    return cardProviderSetupContent[provider].subtitle
  }

  function getCardProviderPrimaryAction(provider: CardOnboardingProvider) {
    return cardProviderSetupContent[provider].primaryAction
  }

  function ManagedCryptoRailCard({
    name,
    provider,
    networks,
    description,
  }: {
    name: string
    provider: "solana" | "base" | "lightning"
    networks: string
    description: string
  }) {
    const connected = isCanonicalRailConfigured(provider)
    const enabled = isEnabled(provider)
    const statusLabel = provider === "lightning"
      ? enabled
        ? "Enabled"
        : connected
          ? "Needs setup"
          : "Not enabled"
      : (connected && enabled) ? "Connected" : "Not connected"
    const statusPillTone = (connected && enabled) ? "blue" : ("default" as const)
    const isLightning = provider === "lightning"

    return (
      <div className="flex min-h-[226px] flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 text-base font-semibold leading-tight text-gray-950">{name}</h2>
          <ProviderStatusPill
            label={statusLabel}
            tone={statusPillTone}
            className="shrink-0"
          />
        </div>
        <div className="mt-4 space-y-2.5">
          <div className="grid grid-cols-[92px_1fr] items-center gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Networks</span>
            <span className="min-w-0 text-sm leading-snug text-gray-900">{networks}</span>
          </div>
          <div className="grid grid-cols-[92px_1fr] items-center gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Settlement</span>
            <span className="min-w-0 text-sm leading-snug text-gray-900">{isLightning ? "Automatic" : "PineTree Wallet"}</span>
          </div>
          {isLightning ? (
            <>
              <div className="grid grid-cols-[92px_1fr] items-center gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Destination</span>
                <span className="min-w-0 text-sm leading-snug text-gray-900">
                  {connected ? "PineTree BTC Wallet" : "Not set"}
                </span>
              </div>
              <div className="grid grid-cols-[92px_1fr] items-center gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Auto-settlement</span>
                <span className="min-w-0 text-sm leading-snug text-gray-900">
                  {enabled ? "Enabled" : "Not available"}
                </span>
              </div>
              <div className="grid grid-cols-[92px_1fr] items-center gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Processor</span>
                <span className="min-w-0 text-sm leading-snug text-gray-900">PineTree Lightning</span>
              </div>
            </>
          ) : null}
          <p className="pt-1 text-sm leading-5 text-gray-600">{description}</p>
          {isLightning ? (
            <p className="text-[11px] font-semibold text-gray-400">Powered by Speed</p>
          ) : null}
        </div>
        <div className="mt-auto flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-blue-700">Manage from PineTree Wallet</p>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Enabled</span>
            <ToggleSwitch
              checked={enabled}
              disabled={!connected}
              onChange={(v) => toggleProvider(provider, v)}
            />
          </div>
        </div>
      </div>
    )
  }

  function getCardProviderMissingUrlMessage(provider: CardOnboardingProvider) {
    return cardProviderSetupContent[provider].missingUrlMessage
  }

  function getCardProviderStatusOverride(provider: CardOnboardingProvider) {
    if (provider === "shift4") return shift4ApplicationStatusOverride
    if (provider === "stripe") return stripeApplicationStatusOverride
    return fluidPayApplicationStatusOverride
  }

  function getCardProviderApplicationStatus(
    providerKey: CardOnboardingProvider,
    provider?: ProviderRecord | null
  ): CardApplicationStatus {
    if (providerKey === "stripe") {
      const creds = provider?.credentials
      if (Boolean(creds?.charges_enabled)) return "Approved"
      if (Boolean(creds?.details_submitted) || Boolean(creds?.stripe_account_id)) return "Pending"
      if (getCardProviderStatusOverride(providerKey) === "Pending") return "Pending"
      return "Not started"
    }

    const applicationStatus = String(provider?.credentials?.application_status || provider?.status || "").trim().toLowerCase()
    if (applicationStatus === "approved" || applicationStatus === "active" || applicationStatus === "connected") return "Approved"
    if (applicationStatus === "denied" || applicationStatus === "declined" || applicationStatus === "rejected") return "Denied"
    if (applicationStatus === "pending" || applicationStatus === "setup_started") return "Pending"

    const displayStatus = getShift4DisplayStatus({
      providerStatus: provider?.status,
      accountReference: String(provider?.credentials?.account_reference || ""),
      merchantApprovalStatus: String(provider?.credentials?.merchant_approval_status || ""),
      apiStatus: String(provider?.credentials?.api_status || "")
    })

    if (displayStatus.label === "Denied") return "Denied"
    if (displayStatus.label === "Connected") return "Approved"
    if (displayStatus.label === "Pending" || getCardProviderStatusOverride(providerKey) === "Pending") return "Pending"
    return "Not started"
  }

  function getStripeConnectCtaLabel(p: ProviderRecord | undefined): string {
    const creds = p?.credentials
    if (!creds?.stripe_account_id) return "Start Stripe Setup"
    if (Boolean(creds.charges_enabled)) return "Start Stripe Setup"
    return "Continue Setup"
  }

  function ProviderCard({
    name,
    provider,
    networks,
    settlement,
    description,
  }: {
    name: string
    provider: string
    networks?: string
    settlement?: string
    description: string
  }) {
    const status = getStatus(provider)
    const connected = status === "Connected"
    const enabled = isEnabled(provider)
    const p = getProvider(provider)
    const isManagedCard = isManagedCardProvider(provider)
    const wallet = getWallet(provider)
    const walletValue = p?.credentials?.wallet || wallet?.wallet_address
    const lightningWalletLabel = String(p?.credentials?.wallet_label || "")
    const walletType = p?.credentials?.wallet_type || wallet?.wallet_type || wallet?.asset
    const walletLabel = formatWalletLabel(provider, walletType, wallet?.asset || null)
    const cardApplicationStatus = isManagedCard ? getCardProviderApplicationStatus(provider, p) : null
    const connectedCredentialLine = walletValue
      ? provider === "solana" || provider === "base"
        ? `${walletLabel} • ${formatCredentialPart(walletValue, 6, 4)}`
        : `${name} • ${formatCredentialPart(walletValue, 6, 4)}`
      : provider === "lightning" && lightningWalletLabel
        ? `Lightning • ${lightningWalletLabel}`
        : ""
    const primaryActionLabel = isManagedCard
      ? provider === "stripe"
        ? getStripeConnectCtaLabel(p)
        : getCardProviderSetupCta(provider)
      : connected
        ? "Disconnect"
        : provider === "lightning"
        ? "Connect"
        : "Connect"
    const lightningCredentialLine =
      provider === "lightning" && lightningWalletLabel
        ? `Lightning • ${lightningWalletLabel}`
        : ""

    return (
      <div className="flex min-h-[226px] flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition hover:border-blue-200 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 text-base font-semibold leading-tight text-gray-950">{name}</h2>
          <ProviderStatusPill
            label={status}
            tone={statusTone(status) as "default" | "blue" | "amber" | "red"}
            className="shrink-0"
          />
        </div>

        <div className="mt-4 space-y-2.5">
          {networks ? (
            <div className="grid grid-cols-[92px_1fr] items-center gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Networks</span>
              <span className="min-w-0 text-sm leading-snug text-gray-900">{networks}</span>
            </div>
          ) : null}

          {settlement ? (
            <div className="grid grid-cols-[92px_1fr] items-center gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Settlement</span>
              <span className="min-w-0 text-sm leading-snug text-gray-900">{settlement}</span>
            </div>
          ) : null}

          <p className="pt-1 text-sm leading-5 text-gray-600">{description}</p>
        </div>

        <div className="mt-4 min-h-[50px]">

          {connectedCredentialLine && !lightningCredentialLine && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Connected
              </span>
              <span className="mt-1 block min-w-0 truncate text-sm font-medium leading-snug text-gray-950">
                {connectedCredentialLine}
              </span>
            </div>
          )}

          {lightningCredentialLine ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Connected
              </span>
              <span
                className="mt-1 block min-w-0 truncate text-sm font-medium leading-snug text-gray-950"
                title={`Lightning • ${lightningWalletLabel}`}
              >
                {lightningCredentialLine}
              </span>
            </div>
          ) : null}

          {isManagedCard ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Provider Status
              </span>
              {provider === "stripe" ? (
                <span className="mt-1 block text-sm font-medium leading-snug text-gray-950">
                  {connected
                    ? "Card processing enabled"
                    : p?.credentials?.stripe_account_id
                      ? "Stripe account needs setup"
                      : "Stripe account not connected"}
                </span>
              ) : (
                <span className="mt-1 block text-sm font-medium leading-snug text-gray-950">
                  Application: {cardApplicationStatus || "Not started"}
                </span>
              )}
              <span className="block text-xs leading-5 text-gray-500">
                Managed by PineTree / {getCardProviderName(provider)}
              </span>
            </div>
          ) : null}
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
          <button
            onClick={() => {
              if (isManagedCard) {
                openProvider(provider)
                return
              }
              if (connected) {
                void disconnect(provider)
              } else {
                openProvider(provider)
              }
            }}
            className={`h-9 rounded-md px-3.5 text-sm font-semibold shadow-sm transition ${
              connected && !isManagedCard
                ? "border border-red-200 bg-white text-red-600 hover:bg-red-50"
              : provider === "lightning" && status === "Provider unavailable"
                  ? "cursor-not-allowed border border-gray-200 bg-gray-100 text-gray-500"
                  : "border border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
            }`}
            disabled={provider === "lightning" && status === "Provider unavailable"}
          >
            {primaryActionLabel}
          </button>

          <div className="flex shrink-0 items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Enabled</span>
            <ToggleSwitch
              checked={enabled}
              disabled={provider === "lightning" ? status !== "Connected" : !connected}
              onChange={(v) => toggleProvider(provider, v)}
            />
          </div>
        </div>
      </div>
    )
  }

  const shift4Connected = getStatus("shift4") === "Connected"
  const connectedAndEnabledProvidersCount = getConnectedAndEnabledProvidersCount(providers)
  const connectedAndEnabledProviders = providers.filter((provider) =>
    provider.enabled && getStatus(provider.provider) === "Connected"
  )

  return (
    <div className="space-y-5 md:space-y-7">
      <div>
        <h1 className={dashboardPageTitleClass}>Providers</h1>
      </div>

      {setupReturnNotice ? (
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
          {setupReturnNotice}
        </div>
      ) : null}

      <DashboardHeroCard
        eyebrow="PAYMENT INFRASTRUCTURE"
        title="View connected payment providers and manage your payment infrastructure."
        value={connectedAndEnabledProvidersCount}
        detail="Connected Providers"
        secondary={
          <div className="grid w-full gap-2 border-t border-blue-200/80 pt-3 text-xs leading-5 text-gray-600 sm:w-auto sm:min-w-[260px] sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
            <div className="min-w-0">
              <span className="font-semibold text-gray-950">Card providers:</span>{" "}
              <span>3 available</span>
            </div>
            <div className="min-w-0">
              <span className="font-semibold text-gray-950">Crypto rails:</span>{" "}
              <span>3 active</span>
            </div>
          </div>
        }
      />

      <DashboardSection title="Engine Settings" titleTone="blue">
      <div className="rounded-2xl border border-gray-200 bg-white p-2.5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        <div className="grid gap-2 md:grid-cols-2">
          <div
            role="button"
            tabIndex={0}
            onClick={() => setEngineSettingsPanel("routing")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                setEngineSettingsPanel("routing")
              }
            }}
            className="group flex min-h-20 cursor-pointer items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5 transition hover:border-blue-200 hover:bg-blue-50/60 focus:outline-none focus:ring-4 focus:ring-blue-100"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-gray-950">Smart Routing</p>
                <span className="text-[11px] font-semibold text-gray-500">{smartRouting ? "On" : "Off"}</span>
              </div>
              <p className="mt-0.5 text-xs text-gray-600">Select the best payment provider</p>
            </div>

            <div
              className="flex shrink-0 items-center gap-2"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <ToggleSwitch
                checked={smartRouting}
                onChange={(v) => {
                  if (v && connectedAndEnabledProvidersCount < 2) {
                    toast.error("Connect and enable at least 2 providers")
                    return
                  }

                  setSmartRouting(v)
                  updateSettings("smart_routing_enabled", v)
                }}
              />
              <ChevronRight className="h-4 w-4 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-blue-600" />
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => setEngineSettingsPanel("conversion")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                setEngineSettingsPanel("conversion")
              }
            }}
            className="group flex min-h-20 cursor-pointer items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5 transition hover:border-blue-200 hover:bg-blue-50/60 focus:outline-none focus:ring-4 focus:ring-blue-100"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-gray-950">Auto Convert to Fiat</p>
                <span className="text-[11px] font-semibold text-gray-500">{autoConversion ? "On" : "Off"}</span>
              </div>
              <p className="mt-0.5 text-xs text-gray-600">Convert eligible payments to fiat</p>
            </div>

            <div
              className="flex shrink-0 items-center gap-2"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <ToggleSwitch
                checked={autoConversion}
                disabled={!shift4Connected}
                onChange={(v) => {
                  setAutoConversion(v)
                  updateSettings("auto_conversion_enabled", v)
                }}
              />
              <ChevronRight className="h-4 w-4 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-blue-600" />
            </div>
          </div>
        </div>
      </div>
      </DashboardSection>

      {engineSettingsPanel && (
        <div
          data-pinetree-overlay="true"
          className="pinetree-modal-backdrop fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center p-3 sm:p-4"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setEngineSettingsPanel(null)
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="engine-settings-title"
            className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/80 bg-white shadow-2xl sm:max-h-[85vh]"
          >
            <header className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-600">Engine Settings</p>
                <h2 id="engine-settings-title" className="mt-1 text-xl font-semibold text-gray-950">
                  {engineSettingsPanel === "routing" ? "Smart Routing" : "Auto Conversion"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setEngineSettingsPanel(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-500 transition hover:bg-gray-50 hover:text-gray-900"
                aria-label="Close engine settings"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="space-y-4 px-5 py-5">
              {engineSettingsPanel === "routing" ? (
                <>
                  <p className="text-sm leading-6 text-gray-600">
                    Smart Routing automatically selects from connected, enabled payment providers when more than one option is available.
                  </p>
                  <EngineSettingStatus label="Current status" value={smartRouting ? "On" : "Off"} active={smartRouting} />
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.13em] text-gray-500">Available providers</p>
                    <p className="mt-2 text-sm font-medium capitalize text-gray-950">
                      {connectedAndEnabledProviders.length
                        ? connectedAndEnabledProviders.map((provider) => provider.provider.replaceAll("_", " ")).join(", ")
                        : "No connected and enabled providers"}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      Routing requires at least two connected and enabled providers. Preferred and fallback provider controls are not currently configurable.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm leading-6 text-gray-600">
                    Auto Conversion applies the merchant&apos;s existing fiat conversion setting to eligible provider payments.
                  </p>
                  <EngineSettingStatus label="Current status" value={autoConversion ? "On" : "Off"} active={autoConversion} />
                  <div className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.13em] text-gray-500">Provider availability</p>
                    <p className="mt-2 text-sm font-medium text-gray-950">
                      {shift4Connected ? "An eligible conversion provider is connected" : "No eligible conversion provider is connected"}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      Provider selection is based on existing connected provider capabilities and is not separately configurable here.
                    </p>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      )}

      <div className="space-y-2">
        <p className={dashboardSectionLabelClass}>Payment Providers</p>
        <div className="flex flex-wrap gap-1.5">
          {(["all", "card", "crypto"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setProviderFilter(f)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                providerFilter === f
                  ? "border-blue-300 bg-blue-50 font-semibold text-blue-700 shadow-sm"
                  : "border-gray-200 bg-white/70 font-medium text-gray-500 hover:border-blue-200 hover:text-blue-600"
              }`}
            >
              {f === "all" ? "All" : f === "card" ? "Card Providers" : "Crypto Rails"}
            </button>
          ))}
        </div>
      </div>

      {(providerFilter === "all" || providerFilter === "card") && (
      <DashboardSection title="Card Providers" titleTone="blue">
      <div className="space-y-3">
        <p className="text-sm leading-6 text-gray-500">
          Connect card processors for in-person and online card acceptance.
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
        <ProviderCard
          name="Shift4"
          provider="shift4"
          networks="Card, crypto"
          settlement="Shift4 merchant account"
          description="Accept card and crypto payments through Shift4 once merchant onboarding is complete."
        />

        <ProviderCard
          name="Stripe"
          provider="stripe"
          networks="Card"
          settlement="Stripe merchant account"
          description="Accept card payments through Stripe once merchant onboarding is approved."
        />

        <ProviderCard
          name="Fluid Pay"
          provider="fluidpay"
          networks="Card"
          settlement="Fluid Pay merchant account"
          description="Accept card payments through Fluid Pay once merchant onboarding is approved."
        />
        </div>
      </div>
      </DashboardSection>
      )}

      {(providerFilter === "all" || providerFilter === "crypto") && (
      <DashboardSection title="Crypto Rails" titleTone="blue">
      <div className="space-y-3">
        <p className="text-sm leading-6 text-gray-500">
          Connect wallets and rails for crypto payment acceptance.
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
        {canonicalWalletMode ? (
          <>
            <ManagedCryptoRailCard
              name="Solana Pay"
              provider="solana"
              networks="Solana"
              description="Solana payments settle to the merchant's PineTree Wallet."
            />
            <ManagedCryptoRailCard
              name="Base Pay"
              provider="base"
              networks="Base"
              description="Base payments settle to the merchant's PineTree Wallet."
            />
            <ManagedCryptoRailCard
              name="PineTree Lightning"
              provider="lightning"
              networks="Bitcoin Lightning"
              description="Lightning payments settle through PineTree to the selected payout destination."
            />
          </>
        ) : (
          <>
            <ProviderCard
              name="Solana Pay"
              provider="solana"
              networks="Solana"
              settlement="Connected wallet"
              description="Accept Solana wallet payments."
            />

            <ProviderCard
              name="Base Pay"
              provider="base"
              networks="Base"
              settlement="Connected wallet"
              description="Accept Base wallet payments."
            />
          </>
        )}

        <ProviderCard
          name="Coinbase Business"
          provider="coinbase"
          networks="Base, Ethereum"
          settlement="Coinbase account"
          description="Connect your Coinbase Business account."
        />

        {/* Bitcoin Lightning legacy fallback; canonical wallet mode renders the managed rail above. */}
        {!canonicalWalletMode && (() => {
          const lightningCard = getLightningCardState()
          return (
            <div className="flex min-h-[226px] flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition hover:border-blue-200 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="min-w-0 text-base font-semibold leading-tight text-gray-950">Bitcoin Lightning</h2>
                <ProviderStatusPill
                  label={lightningCard.status}
                  tone={statusTone(lightningCard.status) as "default" | "blue" | "amber" | "red"}
                  className="shrink-0"
                />
              </div>

              <div className="mt-4 space-y-2.5">
                <div className="grid grid-cols-[92px_1fr] items-center gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Networks</span>
                  <span className="min-w-0 text-sm leading-snug text-gray-900">Bitcoin Lightning</span>
                </div>

                <div className="grid grid-cols-[92px_1fr] items-center gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Settlement</span>
                  <span className="min-w-0 text-sm leading-snug text-gray-900">
                    {lightningCard.connectionType === "speed"
                      ? "Speed account"
                      : lightningCard.connectionType === "nwc"
                        ? "Legacy Lightning wallet"
                        : lightningCard.connectionType === "pinetree"
                          ? "PineTree Wallet"
                          : "PineTree Wallet"}
                  </span>
                </div>

                <p className="pt-1 text-sm leading-5 text-gray-600">
                  Accept Bitcoin Lightning payments through PineTree Wallet.
                </p>
              </div>

              <div className="mt-4 min-h-[50px]">
                {lightningCard.connectionType === "speed" && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-2.5">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Connected</span>
                    <p className="mt-1 truncate text-sm font-semibold text-gray-950" title="Speed - Bitcoin Lightning">
                      Speed &bull; Bitcoin Lightning
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-gray-500">
                      Merchant Speed Account ID connected{lightningCard.detail ? ` - ${lightningCard.detail}` : ""}
                    </p>
                  </div>
                )}
                {lightningCard.connectionType === "nwc" && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-2.5">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Connected</span>
                    <p className="mt-1 truncate text-sm font-semibold text-gray-950" title="Legacy Lightning - Bitcoin Lightning">
                      Legacy Lightning &bull; Bitcoin Lightning
                    </p>
                    <p className="mt-0.5 truncate text-xs leading-5 text-gray-500" title={lightningCard.detail}>
                      {lightningCard.detail}
                    </p>
                  </div>
                )}
                {lightningCard.connectionType === "pinetree" && (
                  <div className="rounded-lg border border-blue-100 bg-blue-50/80 px-3 py-2.5">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-500">Managed</span>
                    <p className="mt-1 truncate text-sm font-semibold text-gray-950" title="PineTree Wallet - Bitcoin Lightning">
                      PineTree Wallet &bull; Bitcoin Lightning
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-gray-600">
                      Bitcoin payouts route to the merchant&apos;s PineTree Bitcoin wallet.
                    </p>
                  </div>
                )}
                {!lightningCard.connectionType && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                    <p className="text-sm leading-5 text-gray-600">{lightningCard.summary}</p>
                  </div>
                )}
              </div>

              <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
                {lightningCard.connectionType === "pinetree" ? (
                  <p className="text-xs font-semibold text-blue-700">Manage from PineTree Wallet</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => {
                          if (lightningCard.status === "Connected") {
                            void disconnect("lightning")
                          } else {
                            openProvider("lightning")
                          }
                        }}
                        className={`h-8 rounded-md px-3 text-xs font-semibold shadow-sm transition ${
                          lightningCard.status === "Connected"
                            ? "border border-red-200 bg-white text-red-600 hover:border-red-300 hover:bg-red-50"
                            : "border border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
                        }`}
                      >
                        {lightningCard.status === "Connected" ? "Disconnect" : "Connect"}
                      </button>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-medium text-gray-700">Enabled</span>
                      <ToggleSwitch
                        checked={isEnabled("lightning")}
                        disabled={lightningCard.status !== "Connected"}
                        onChange={(v) => toggleProvider("lightning", v)}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          )
        })()}

      </div>
      </div>
      </DashboardSection>
      )}

      {activeProvider && (
        <div
          data-pinetree-overlay="true"
          className="pinetree-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3"
          onMouseDown={closeProviderModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Provider setup"
            className={`relative w-full max-w-[520px] max-h-[90vh] overflow-y-auto rounded-lg bg-white shadow-lg ${
              isManagedCardProvider(activeProvider) ? "p-4 sm:p-5" : "p-4 sm:p-6"
            }`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-gray-950">
                  {activeProvider === "solana"
                    ? "Set Up Solana Pay"
                    : activeProvider === "base"
                      ? "Set Up Base Pay"
                      : activeProvider === "lightning"
                        ? "Bitcoin Lightning"
                      : isManagedCardProvider(activeProvider)
                        ? getCardProviderModalTitle(activeProvider)
                      : `Connect ${activeProvider}`}
                </h2>
                {isManagedCardProvider(activeProvider) ? (
                  <>
                    <p className="mt-1 text-sm leading-5 text-gray-500">
                      {getCardProviderModalSubtitle(activeProvider)}
                    </p>
                    <div className="mt-3 rounded-lg bg-blue-50 px-3.5 py-3 text-xs leading-5 text-blue-800">
                      PineTree will keep this provider status updated after approval is completed.
                    </div>
                  </>
                ) : null}
              </div>

              <button
                type="button"
                onClick={closeProviderModal}
                aria-label="Close setup modal"
                className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-sm font-semibold leading-none text-gray-600 shadow-sm transition hover:bg-gray-50 hover:text-gray-900"
              >
                X
              </button>
            </div>

            {activeProvider === "lightning" && (
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-5 text-center">
                <p className="text-sm font-semibold text-blue-900">
                  Bitcoin Lightning is managed through PineTree Wallet
                </p>
                <p className="mt-1.5 text-xs leading-5 text-blue-700">
                  Lightning payments are routed automatically. No manual setup is required.
                </p>
              </div>
            )}

            {activeProvider === "coinbase" && (
              <div className="mb-4 space-y-4">
                <p className="text-sm text-black">
                  Log into Coinbase Business and generate an API key.
                </p>

                <a
                  href="https://www.coinbase.com/business"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block bg-blue-600 text-white text-sm px-4 py-2 rounded hover:bg-blue-700"
                >
                  Open Coinbase Business
                </a>
              </div>
            )}

            {isManagedCardProvider(activeProvider) && (
              <div className="mb-5 space-y-5">
                <section className="rounded-xl border border-gray-200 bg-white px-3.5 py-3.5">
                  <p className="text-sm font-semibold text-gray-950">Application checklist</p>
                  <div className="mt-3 grid gap-2">
                    {[
                      "Business information",
                      "Banking details",
                      "Ownership details",
                      "Processing details"
                    ].map((item) => (
                      <div key={item} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                        <span className="text-sm font-medium text-gray-800">{item}</span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {activeProvider === "coinbase" && (
                <input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Enter Coinbase API Key"
                  className="w-full border border-gray-300 rounded p-2 mb-4 text-black bg-white"
                />
              )}

            {isManagedCardProvider(activeProvider) && (
            <div className="-mx-4 -mb-4 flex flex-col-reverse gap-2 border-t border-gray-100 bg-white p-4 sm:-mx-5 sm:-mb-5 sm:flex-row sm:items-center sm:justify-between sm:p-5 sticky bottom-0">
              <button
                type="button"
                onClick={closeProviderModal}
                className={`${secondaryButtonClass()} w-full sm:w-auto`}
              >
                Cancel
              </button>

              <div className="flex w-full flex-col gap-1 sm:w-auto sm:items-end">
                <button
                  type="button"
                  onClick={() => beginCardProviderSetup(activeProvider)}
                  disabled={
                    setupLoadingProvider === activeProvider ||
                    (activeProvider === "shift4" && !getCardProviderSetupUrl(activeProvider).trim())
                  }
                  className={`${primaryButtonClass()} w-full sm:w-auto`}
                >
                  {setupLoadingProvider === activeProvider ? "Starting..." : getCardProviderPrimaryAction(activeProvider)}
                </button>
                {activeProvider === "shift4" && !getCardProviderSetupUrl(activeProvider).trim() ? (
                  <p className="text-xs font-medium text-amber-700">{getCardProviderMissingUrlMessage(activeProvider)}</p>
                ) : null}
                {setupErrors[activeProvider] ? (
                  <p className="text-xs font-medium text-red-600">{setupErrors[activeProvider]}</p>
                ) : null}
              </div>
            </div>
            )}

            {activeProvider === "coinbase" && (
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <button
                onClick={closeProviderModal}
                className="px-3 py-1.5 text-sm border rounded bg-white text-black w-full sm:w-auto"
              >
                Cancel
              </button>

              <button
                onClick={() => saveProvider(activeProvider)}
                disabled={loading}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded w-full sm:w-auto"
              >
                {loading ? "Saving..." : "Save"}
              </button>
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}


