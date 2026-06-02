"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { getSpeedDashboardLinks } from "@/lib/speedDashboardLinks"
import ToggleSwitch from "@/components/ui/ToggleSwitch"
import { toast } from "sonner"
import {
  CompactMetricTile,
  DashboardSection,
  MetricGrid,
  ProviderStatusPill
} from "@/components/dashboard/DashboardPrimitives"

const providerAlbyHubAppsUrl = process.env.NEXT_PUBLIC_ALBY_HUB_APPS_URL || "https://getalby.com/hub/apps"
const providerAlbyNwcDocsUrl = process.env.NEXT_PUBLIC_ALBY_NWC_DOCS_URL || "https://guides.getalby.com/user-guide/alby-account-and-browser-extension/alby-hub/nwc"
const providerZeusIosUrl = process.env.NEXT_PUBLIC_ZEUS_IOS_URL || "https://apps.apple.com/us/app/zeus-ln/id1456038895"
const providerZeusAndroidUrl = process.env.NEXT_PUBLIC_ZEUS_ANDROID_URL || "https://play.google.com/store/apps/details?id=app.zeusln"
const providerZeusDocsUrl = process.env.NEXT_PUBLIC_ZEUS_DOCS_URL || "https://zeusln.app"

const providerSpeedSetupLinks = getSpeedDashboardLinks([
  "dashboard",
  "accountId",
  "autoSwap",
  "payouts",
  "docs"
])
const speedLoginUrl = providerSpeedSetupLinks.find((link) => link.key === "dashboard")?.url || ""
const speedDocsUrl = providerSpeedSetupLinks.find((link) => link.key === "docs")?.url || ""
const speedAssociatedAccountsUrl = providerSpeedSetupLinks.find((link) => link.key === "accountId")?.url || ""
const speedAutoSwapUrl = providerSpeedSetupLinks.find((link) => link.key === "autoSwap")?.url || ""
const speedAutoPayoutUrl = providerSpeedSetupLinks.find((link) => link.key === "payouts")?.url || ""

type ProviderCredentials = {
  api_key?: string
  wallet?: string
  wallet_type?: string | null
  wallet_label?: string
  provider_model?: string
  [key: string]: unknown
}

type SolanaProviderLike = {
  isPhantom?: boolean
  isSolflare?: boolean
  connect: () => Promise<{ publicKey: { toString: () => string } }>
}

type Eip1193ProviderLike = {
  isCoinbaseWallet?: boolean
  isBaseWallet?: boolean
  isMetaMask?: boolean
  isTrust?: boolean
  isTrustWallet?: boolean
  providers?: Eip1193ProviderLike[]
  request: (args: { method: string }) => Promise<unknown>
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

type WalletConnectSession = {
  session_id: string
  merchant_id?: string | null
  provider: string
  wallet_type?: string | null
  wallet_address?: string | null
  status: "pending" | "connected" | "cancelled" | "expired" | string
  created_at?: string
  updated_at?: string
}

type ProvidersApiResponse = {
  success?: boolean
  providers?: ProviderRecord[]
  wallets?: WalletRecord[]
  settings?: {
    smart_routing_enabled: boolean
    auto_conversion_enabled: boolean
  }
  error?: string
}

function getInjectedSolanaProvider() {
  return window.solana as SolanaProviderLike | undefined
}

function getInjectedEthereumProvider() {
  return window.ethereum as Eip1193ProviderLike | undefined
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

function getInjectedBaseProvider(preferredType?: string | null) {
  const eth = getInjectedEthereumProvider()
  if (!eth) return null

  const providers =
    Array.isArray(eth.providers) && eth.providers.length > 0
      ? eth.providers
      : [eth]

  if (preferredType === "BASEAPP") {
    return (
      providers.find((p) => p?.isCoinbaseWallet) ||
      providers.find((p) => p?.isBaseWallet) ||
      null
    )
  }

  if (preferredType === "METAMASK") {
    return (
      providers.find((p) => p?.isMetaMask && !p?.isCoinbaseWallet) || null
    )
  }

  if (preferredType === "TRUST") {
    return providers.find((p) => p?.isTrust || p?.isTrustWallet) || null
  }

  return providers[0] || null
}

function getDetectedBaseWalletType(provider: Eip1193ProviderLike, fallback?: string | null) {
  if (provider?.isCoinbaseWallet || provider?.isBaseWallet) return "BASEAPP"
  if (provider?.isMetaMask && !provider?.isCoinbaseWallet) return "METAMASK"
  if (provider?.isTrust || provider?.isTrustWallet) return "TRUST"
  return fallback || "BASEAPP"
}

export default function ProvidersPage() {
  const [providers, setProviders] = useState<ProviderRecord[]>([])
  const [wallets, setWallets] = useState<WalletRecord[]>([])
  const [activeProvider, setActiveProvider] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState("")
  const [nwcUri, setNwcUri] = useState("")
  const [nwcWalletLabel, setNwcWalletLabel] = useState("")
  const [nwcTestResult, setNwcTestResult] = useState<{
    success: boolean
    connected?: boolean
    ready?: boolean
    missingPermissions?: string[]
    readinessReason?: string
    canMakeInvoice?: boolean
    canPayInvoice?: boolean
    canLookupInvoice?: boolean
    canCollectFee?: boolean
    walletAlias?: string
    error?: string
  } | null>(null)
  const [nwcTesting, setNwcTesting] = useState(false)
  const [loading, setLoading] = useState(false)

  // Speed Lightning setup state
  const [speedAccountId, setSpeedAccountId] = useState("")
  const [lightningSetupTab, setLightningSetupTab] = useState<"speed" | "nwc">("speed")
  const [speedSetupStep, setSpeedSetupStep] = useState<1 | 2>(1)
  const [speedTestResult, setSpeedTestResult] = useState<{
    success: boolean
    connected?: boolean
    mode?: string
    notes?: string[]
    error?: string
  } | null>(null)
  const [speedTesting, setSpeedTesting] = useState(false)

  const [smartRouting, setSmartRouting] = useState(false)
  const [autoConversion, setAutoConversion] = useState(false)

  const [selectedWalletType, setSelectedWalletType] = useState<string | null>(null)
  const [showMobileConnect, setShowMobileConnect] = useState(false)

  const [walletSessionId, setWalletSessionId] = useState<string | null>(null)
  const [walletSessionStatus, setWalletSessionStatus] = useState<string | null>(null)
  const [walletMobileDeeplink, setWalletMobileDeeplink] = useState<string | null>(null)

  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const didToastSyncRef = useRef(false)
  const pollStopAtRef = useRef<number | null>(null)

  const closeProviderModal = useCallback(() => {
    setActiveProvider(null)
    setInputValue("")
    setNwcUri("")
    setNwcWalletLabel("")
    setNwcTestResult(null)
    setNwcTesting(false)
    setShowMobileConnect(false)
    setSelectedWalletType(null)
    setWalletSessionId(null)
    setWalletSessionStatus(null)
    setWalletMobileDeeplink(null)
    didToastSyncRef.current = false
    setSpeedAccountId("")
    setLightningSetupTab("speed")
    setSpeedTestResult(null)
    setSpeedTesting(false)
    setSpeedSetupStep(1)

    if (pollerRef.current) {
      clearInterval(pollerRef.current)
      pollerRef.current = null
    }
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
    return () => {
      if (pollerRef.current) clearInterval(pollerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!activeProvider) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeProviderModal()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [activeProvider, closeProviderModal])

  useEffect(() => {
    if (!walletSessionId || !activeProvider || !showMobileConnect) return

    pollStopAtRef.current = Date.now() + 15 * 60 * 1000
    let lastPollAt = 0
    let animationFrameId: number | null = null

    const poll = async () => {
      if (!walletSessionId || pollStopAtRef.current === null) return
      if (Date.now() > pollStopAtRef.current) return

      const now = Date.now()
      if (now - lastPollAt < 1200) {
        animationFrameId = requestAnimationFrame(poll)
        return
      }

      lastPollAt = now

      try {
        const { data: { session: authSession } } = await supabase.auth.getSession()
        const authToken = authSession?.access_token

        const res = await fetch(
          `/api/wallet-connect-session?session_id=${encodeURIComponent(walletSessionId)}`,
          {
            cache: "no-store",
            ...(authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : {}),
          }
        )

        if (!res.ok) {
          animationFrameId = requestAnimationFrame(poll)
          return
        }

        const session: WalletConnectSession | null = await res.json()
        if (!session) {
          animationFrameId = requestAnimationFrame(poll)
          return
        }

        setWalletSessionStatus(session.status)

        if (session.status === "connected" && session.wallet_address) {
          setInputValue(session.wallet_address)

          if (session.wallet_type) {
            setSelectedWalletType(session.wallet_type)
          } else {
            if (activeProvider === "solana") {
              setSelectedWalletType("PHANTOM")
            }

            if (activeProvider === "base") {
              setSelectedWalletType("BASEAPP")
            }
          }

          if (!didToastSyncRef.current) {
            toast.success("Mobile wallet connected. Review and save.")
            didToastSyncRef.current = true
          }

          setShowMobileConnect(false)
          pollStopAtRef.current = null
          await loadAll()
          return
        }

        animationFrameId = requestAnimationFrame(poll)
      } catch (err) {
        console.error("Polling session failed:", err)
        animationFrameId = requestAnimationFrame(poll)
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && walletSessionId && pollStopAtRef.current) {
        lastPollAt = 0
        if (animationFrameId === null) {
          animationFrameId = requestAnimationFrame(poll)
        }
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange)
    animationFrameId = requestAnimationFrame(poll)

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
      pollStopAtRef.current = null
    }
  }, [walletSessionId, activeProvider, showMobileConnect, loadAll])

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
      if (!p || p.dashboard_status === "not_configured") return "Not configured"
      if (p.dashboard_status === "address_needs_verification") return "Needs verification"
      if (p.dashboard_status === "provider_unavailable") return "Provider unavailable"
      if (p.dashboard_status === "connected" && p.readiness && !p.readiness.ready) return "Needs permissions"
      if (p.dashboard_status === "connected") return "Connected"
      return "Not configured"
    }

    if (provider === "lightning_speed") {
      const p = getProvider(provider)
      if (!p || p.dashboard_status === "not_configured") return "Not configured"
      if (p.dashboard_status === "provider_unavailable") return "Missing env"
      if (p.readiness?.ready) return "Ready"
      if (p.dashboard_status === "connected") return "Needs account ID"
      return "Needs setup"
    }

    const wallet = getWallet(provider)

    if ((provider === "solana" || provider === "base") && wallet) return "Connected"

    const p = getProvider(provider)
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

  function getOrigin() {
    if (typeof window !== "undefined") return window.location.origin
    return "https://pinetree-payments.com"
  }

  function getDesktopProvidersUrl() {
    return `${getOrigin()}/dashboard/providers`
  }

 function buildMobileBridgeUrl(
  provider: "solana" | "base",
  walletType: string,
  sessionId: string
) {
  const path =
    provider === "solana"
      ? "/solana-return"
      : "/base-return"

  const url = new URL(`${getOrigin()}${path}`)

  url.searchParams.set("provider", provider)
  url.searchParams.set("wallet_type", walletType)
  url.searchParams.set("session_id", sessionId)
  url.searchParams.set("return_to", getDesktopProvidersUrl())

  return url.toString()
}

  async function createWalletConnectSession(
    provider: "solana" | "base",
    walletType?: string | null
  ) {
    const sessionId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `session_${Date.now()}_${Math.random().toString(36).slice(2)}`

    const res = await fetch("/api/wallet-connect-session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId,
        provider,
        wallet_type: walletType || null,
        status: "pending",
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error("Failed creating wallet session:", text)
      throw new Error("Failed to create wallet connect session")
    }

    setWalletSessionId(sessionId)
    setWalletSessionStatus("pending")
    didToastSyncRef.current = false

    return sessionId
  }

  async function connectSolanaWallet(preferredType?: string | null) {
    let provider = getInjectedSolanaProvider()

    if (!provider) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      provider = getInjectedSolanaProvider()
    }

    if (!provider) return null

    const detectedType = provider?.isPhantom
      ? "PHANTOM"
      : provider?.isSolflare
        ? "SOLFLARE"
        : null

    if (preferredType && detectedType && preferredType !== detectedType) {
      toast.error(
        preferredType === "PHANTOM"
          ? "Phantom was selected, but a different Solana wallet is injected on this device"
          : "Solflare was selected, but a different Solana wallet is injected on this device"
      )
      return null
    }

    try {
      const response = await provider.connect()

      let walletType = "MANUAL"
      if (provider.isPhantom) walletType = "PHANTOM"
      else if (provider.isSolflare) walletType = "SOLFLARE"
      else if (preferredType) walletType = preferredType

      return {
        walletAddress: response.publicKey.toString(),
        walletType,
      }
    } catch (err) {
      console.error("Solana wallet connect error:", err)
      return null
    }
  }

  async function connectBaseWallet(preferredType?: string | null) {
    const provider = getInjectedBaseProvider(preferredType)

    if (!provider) return null

    try {
      const accountsResponse = await provider.request({
        method: "eth_requestAccounts",
      })

      const accounts = Array.isArray(accountsResponse)
        ? accountsResponse.map((value) => String(value))
        : []

      if (!accounts?.[0]) return null

      return {
        walletAddress: accounts[0],
        walletType: getDetectedBaseWalletType(provider, preferredType),
      }
    } catch (err) {
      console.error("Base wallet connect error:", err)
      return null
    }
  }

  async function openSolanaMobileWallet(walletType?: string | null) {
    try {
      console.log("SOLANA MOBILE START", walletType)

      if (!walletType) {
        toast.error("Select Phantom or Solflare first")
        return
      }

      const sessionId = await createWalletConnectSession("solana", walletType)
      console.log("SESSION CREATED:", sessionId)

      const returnUrl = buildMobileBridgeUrl("solana", walletType, sessionId)

      let deeplink = ""

      if (walletType === "PHANTOM") {
        deeplink = `https://phantom.app/ul/browse/${encodeURIComponent(returnUrl)}`
      } else {
        deeplink = `https://solflare.com/ul/v1/browse/${encodeURIComponent(returnUrl)}`
      }

      console.log("DEEPLINK:", deeplink)

      setWalletMobileDeeplink(deeplink)
      setShowMobileConnect(true)
      window.location.href = deeplink
    } catch (err) {
      console.error("🔥 SOLANA MOBILE ERROR:", err)
      toast.error("Failed to open Solana wallet")
    }
  }

  async function openBaseMobileWallet() {
    try {
      console.log("BASE MOBILE START", selectedWalletType)

      if (!selectedWalletType) {
        toast.error("Select wallet first")
        return
      }

      const sessionId = await createWalletConnectSession("base", selectedWalletType)
      console.log("SESSION CREATED:", sessionId)

      const returnUrl = buildMobileBridgeUrl("base", selectedWalletType, sessionId)

      let deeplink = ""

      if (selectedWalletType === "METAMASK") {
        deeplink = `metamask://dapp?url=${encodeURIComponent(returnUrl)}`
      } else if (selectedWalletType === "TRUST") {
        deeplink = `trust://dapp?url=${encodeURIComponent(returnUrl)}`
      } else if (selectedWalletType === "BASEAPP") {
        deeplink = `cbwallet://dapp?url=${encodeURIComponent(returnUrl)}`
      }

      console.log("DEEPLINK:", deeplink)

      setWalletMobileDeeplink(deeplink)
      setShowMobileConnect(true)
      window.location.href = deeplink
    } catch (err) {
      console.error("🔥 BASE MOBILE ERROR:", err)
      toast.error("Failed to open Base wallet")
    }
  }

  function openProvider(provider: string) {
    const existingWallet = getWallet(provider)
    const p = getProvider(provider)
    const modalProvider = provider === "speed" ? "lightning" : provider

    if ((provider === "solana" || provider === "base") && existingWallet) {
      toast.success("Wallet already connected")
      return
    }

    if (provider === "lightning" || provider === "speed") {
      setInputValue("")
      setNwcUri("")
      setNwcWalletLabel("")
      setNwcTestResult(null)
      setLightningSetupTab("speed")
      setSpeedTestResult(null)
      setSpeedAccountId(String(getProvider("lightning_speed")?.credentials?.account_id || ""))
      // Start at step 1 if no account ID saved, step 2 if already configured
      setSpeedSetupStep(getProvider("lightning_speed")?.credentials?.account_id ? 2 : 1)
    } else if (p?.credentials?.api_key) {
      setInputValue(p.credentials.api_key)
    } else if (p?.credentials?.wallet) {
      setInputValue(p.credentials.wallet)
    } else if (existingWallet?.wallet_address) {
      setInputValue(existingWallet.wallet_address)
    } else {
      setInputValue("")
    }

    setShowMobileConnect(false)
    setSelectedWalletType(null)
    setWalletSessionId(null)
    setWalletSessionStatus(null)
    setWalletMobileDeeplink(null)
    didToastSyncRef.current = false

    if (pollerRef.current) {
      clearInterval(pollerRef.current)
      pollerRef.current = null
    }

    setActiveProvider(modalProvider)
  }

  async function testNwcConnection() {
    const uri = nwcUri.trim()
    if (!uri) {
      toast.error("Paste your NWC connection string first")
      return
    }

    setNwcTesting(true)
    setNwcTestResult(null)

    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const authToken = authSession?.access_token
      if (!authToken) {
        toast.error("Please sign in again")
        return
      }

      const res = await fetch("/api/wallets/lightning/test", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ nwcUri: uri })
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setNwcTestResult({ success: false, connected: false, error: data?.error || "Connection test failed" })
        return
      }

      setNwcTestResult({
        success: Boolean(data?.success),
        connected: Boolean(data?.connected),
        ready: Boolean(data?.ready),
        missingPermissions: Array.isArray(data?.missingPermissions) ? data.missingPermissions : [],
        readinessReason: data?.readinessReason || undefined,
        canMakeInvoice: Boolean(data?.canMakeInvoice),
        canLookupInvoice: Boolean(data?.canLookupInvoice),
        canPayInvoice: Boolean(data?.canPayInvoice),
        canCollectFee: Boolean(data?.canCollectFee),
        walletAlias: data?.walletAlias || ""
      })
    } catch (err) {
      setNwcTestResult({ success: false, connected: false, error: err instanceof Error ? err.message : "Test failed" })
    } finally {
      setNwcTesting(false)
    }
  }

  async function testPineTreeSpeedPlatform() {
    setSpeedTesting(true)
    setSpeedTestResult(null)

    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const authToken = authSession?.access_token
      if (!authToken) { toast.error("Please sign in again"); return }

      const res = await fetch("/api/wallets/lightning/speed/test", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" }
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setSpeedTestResult({ success: false, connected: false, error: data?.error || "Test request failed" })
        return
      }

      setSpeedTestResult({
        success: Boolean(data?.success),
        connected: Boolean(data?.connected),
        mode: data?.mode || "unknown",
        notes: Array.isArray(data?.notes) ? data.notes : [],
        error: data?.error || undefined
      })
    } catch (err) {
      setSpeedTestResult({
        success: false,
        connected: false,
        error: err instanceof Error ? err.message : "Test failed"
      })
    } finally {
      setSpeedTesting(false)
    }
  }

  async function saveSpeedSetup() {
    setLoading(true)

    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const authToken = authSession?.access_token
      if (!authToken) { toast.error("Please sign in again"); return }

      const res = await fetch("/api/wallets/lightning/speed/connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "connect",
          speedAccountId: speedAccountId.trim()
        })
      })

      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.success) {
        toast.error(data?.error || "Failed to connect Speed")
        return
      }

      toast.success(data?.message || "Speed platform setup saved")
      closeProviderModal()
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unexpected error")
    } finally {
      setLoading(false)
    }
  }

  async function disconnectSpeed() {
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const authToken = authSession?.access_token
      if (!authToken) { toast.error("Please sign in again"); return }

      const res = await fetch("/api/wallets/lightning/speed/connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect" })
      })

      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.success) {
        toast.error(data?.error || "Failed to disconnect Speed")
        return
      }

      toast.success("Speed Lightning disconnected")
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unexpected error")
    }
  }

  async function saveProvider(provider: string) {
    setLoading(true)

    try {
      let walletAddress = (inputValue || "").trim()
      let walletType: string | null = selectedWalletType

      if (!walletAddress && walletSessionStatus === "connected") {
        toast.error("Wallet detected but not yet loaded. Try again.")
        return
      }

      if (provider === "solana") {
        walletType = selectedWalletType || "MANUAL"

        if (selectedWalletType === "PHANTOM" || selectedWalletType === "SOLFLARE") {
          const result = await connectSolanaWallet(selectedWalletType)

          if (result?.walletAddress) {
            walletAddress = result.walletAddress
            walletType = result.walletType
          } else if (!walletAddress) {
            toast.error("No wallet detected — install Phantom or Solflare, or paste address")
            return
          }
        } else if (!walletAddress) {
          toast.error("Choose a wallet or paste a Solana address")
          return
        }
      } else if (provider === "base") {
        walletType = selectedWalletType || "BASEAPP"

        if (
          selectedWalletType === "BASEAPP" ||
          selectedWalletType === "METAMASK" ||
          selectedWalletType === "TRUST"
        ) {
          const result = await connectBaseWallet(walletType)

          if (result?.walletAddress) {
            walletAddress = result.walletAddress
            walletType = result.walletType
          } else if (!walletAddress) {
            toast.error("No wallet detected — install the selected wallet or paste address")
            return
          }
        } else if (!walletAddress) {
          toast.error("Choose a wallet or paste a Base address")
          return
        }

        walletAddress = walletAddress.trim()
      } else if (provider === "coinbase" || provider === "shift4") {
        if (!walletAddress) {
          toast.error("Required field missing")
          return
        }
      } else if (provider === "lightning") {
        const uri = nwcUri.trim()
        if (!uri) {
          toast.error("NWC connection string is required")
          return
        }

        const { data: { session: authSession } } = await supabase.auth.getSession()
        const authToken = authSession?.access_token
        if (!authToken) {
          toast.error("Please sign in again")
          return
        }

        const res = await fetch("/api/wallets/lightning/connect", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ nwcUri: uri, walletLabel: nwcWalletLabel.trim() || "Lightning Wallet" })
        })

        const data = await res.json().catch(() => null)
        if (!res.ok) {
          toast.error(data?.error || "Failed to connect Lightning wallet")
          return
        }

        toast.success(data?.message || "Lightning wallet connected")
        closeProviderModal()
        await loadAll()
        return
      }

      const payload = await callProvidersApi("POST", {
        action: "saveProvider",
        provider,
        walletAddress: provider === "solana" || provider === "base" ? walletAddress : undefined,
        walletType: provider === "solana" || provider === "base" ? walletType : undefined,
        apiKey: provider === "coinbase" || provider === "shift4" ? walletAddress : undefined
      })

      applyProvidersPayload(payload)

      if (walletSessionId) {
        const { data: { session: wcsSession } } = await supabase.auth.getSession()
        const wcsToken = wcsSession?.access_token
        await fetch("/api/wallet-connect-session", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            ...(wcsToken ? { Authorization: `Bearer ${wcsToken}` } : {}),
          },
          body: JSON.stringify({ session_id: walletSessionId }),
        })
      }

      setActiveProvider(null)
      setInputValue("")
      setNwcUri("")
      setNwcWalletLabel("")
      setNwcTestResult(null)
      setNwcTesting(false)
      setShowMobileConnect(false)
      setSelectedWalletType(null)
      setWalletSessionId(null)
      setWalletSessionStatus(null)
      setWalletMobileDeeplink(null)
      didToastSyncRef.current = false

      if (pollerRef.current) {
        clearInterval(pollerRef.current)
        pollerRef.current = null
      }

      toast.success(
        provider === "solana"
          ? "Solana wallet connected"
          : provider === "base"
            ? "Base wallet connected"
            : provider === "lightning"
              ? "Bitcoin Lightning setup verified"
              : "Provider connected"
      )
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
    if (value && (provider === "solana" || provider === "base") && !getWallet(provider)) {
      toast.error("Connect wallet first")
      return
    }

    if (value && provider === "lightning" && getLightningCardState().status !== "Connected") {
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

  function lightningInputClass() {
    return "mt-2 w-full rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-sm text-gray-950 shadow-sm outline-none transition placeholder:text-gray-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
  }

  function statusTone(status: string) {
    if (status === "Connected" || status === "Ready") return "blue"
    if (status === "Setup needed" || status === "Needs verification" || status === "Needs permissions" || status === "Setup only") return "amber"
    if (status === "Provider unavailable" || status === "Missing env") return "red"
    return "default"
  }

  function formatCredentialPart(value: string, leading = 8, trailing = 4) {
    const trimmed = value.trim()
    if (trimmed.length <= leading + trailing + 3) return trimmed
    return `${trimmed.slice(0, leading)}...${trimmed.slice(-trailing)}`
  }

  function getLightningCardState() {
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
        detail: `Speed account • ${formatCredentialPart(String(speedCredentials.account_id), 10, 4)}`,
        actionLabel: "Manage",
        showClearSpeed: true
      }
    }

    if (nwcConnected) {
      const walletLabel = String(getProvider("lightning")?.credentials?.wallet_label || "Lightning Wallet")
      return {
        status: "Connected" as const,
        connectionType: "nwc" as const,
        summary: "Bitcoin Lightning payments route through the connected NWC wallet.",
        detail: walletLabel,
        actionLabel: "Manage",
        showClearSpeed: false
      }
    }

    return {
      status: "Not Connected" as const,
      connectionType: null,
      summary: "Setup needed: connect Speed Lightning or Advanced NWC.",
      detail: "",
      actionLabel: "Connect",
      showClearSpeed: false
    }
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
    const wallet = getWallet(provider)
    const walletValue = p?.credentials?.wallet || wallet?.wallet_address
    const lightningWalletLabel = String(p?.credentials?.wallet_label || "")
    const walletType = p?.credentials?.wallet_type || wallet?.wallet_type || wallet?.asset
    const walletLabel = formatWalletLabel(provider, walletType, wallet?.asset || null)
    const connectedCredentialLine = walletValue
      ? provider === "solana" || provider === "base"
        ? `${walletLabel} • ${formatCredentialPart(walletValue, 6, 4)}`
        : `${name} • ${formatCredentialPart(walletValue, 6, 4)}`
      : provider === "lightning" && lightningWalletLabel
        ? `Lightning • ${lightningWalletLabel}`
        : ""
    const primaryActionLabel = connected
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
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
          <button
            onClick={() => connected ? disconnect(provider) : openProvider(provider)}
            className={`h-9 rounded-md px-3.5 text-sm font-semibold shadow-sm transition ${
              connected
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

  return (
    <div className="space-y-5 md:space-y-7">
      <div>
        <h1 className="text-2xl font-semibold text-gray-950 md:text-3xl">Providers</h1>
      </div>

      <MetricGrid columns="three">
        <CompactMetricTile label="Connected" value={connectedAndEnabledProvidersCount} tone="blue" />
        <CompactMetricTile label="Payment Options" value="5" />
        <CompactMetricTile
          label="Smart Routing"
          value={smartRouting ? "On" : "Off"}
          tone={smartRouting ? "green" : "slate"}
        />
      </MetricGrid>

      <DashboardSection title="Engine Settings" titleTone="blue">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">

        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-gray-950">Smart Routing</p>
              <p className="text-sm text-gray-600">Automatically select the best payment provider</p>
            </div>

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
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-gray-950">Auto Convert to Fiat</p>
              <p className="text-sm text-gray-600">Convert payments routed through Shift4 to fiat</p>
            </div>

            <ToggleSwitch
              checked={autoConversion}
              disabled={!shift4Connected}
              onChange={(v) => {
                setAutoConversion(v)
                updateSettings("auto_conversion_enabled", v)
              }}
            />
          </div>
        </div>
      </div>
      </DashboardSection>

      <DashboardSection title="Payment Providers" titleTone="blue">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
        <ProviderCard
          name="Coinbase Business"
          provider="coinbase"
          networks="Base, Ethereum"
          settlement="Coinbase account"
          description="Connect your Coinbase Business account."
        />

        <ProviderCard
          name="Solana Pay"
          provider="solana"
          networks="Solana"
          settlement="Connected wallet"
          description="Accept Solana wallet payments."
        />

        <ProviderCard
          name="Shift4"
          provider="shift4"
          networks="Card, crypto"
          settlement="Shift4 account"
          description="Accept card and crypto payments."
        />

        <ProviderCard
          name="Base Pay"
          provider="base"
          networks="Base"
          settlement="Connected wallet"
          description="Accept Base wallet payments."
        />

        {/* Bitcoin Lightning — full-width, two-option: Speed recommended + NWC advanced */}
        {(() => {
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
                        ? "NWC wallet"
                        : "Speed account (recommended)"}
                  </span>
                </div>

                <p className="pt-1 text-sm leading-5 text-gray-600">
                  Accept Bitcoin Lightning payments through PineTree&apos;s Speed setup.
                </p>
              </div>

              <div className="mt-4 min-h-[50px]">
                {lightningCard.connectionType === "speed" && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Connected</span>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">Speed</span>
                      <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">Bitcoin Lightning</span>
                    </div>
                    <p className="mt-1.5 text-sm leading-5 text-gray-600">{lightningCard.summary}</p>
                  </div>
                )}
                {lightningCard.connectionType === "nwc" && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Connected</span>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-700">NWC</span>
                      <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">Bitcoin Lightning</span>
                    </div>
                    <p className="mt-1.5 text-sm leading-5 text-gray-600">{lightningCard.summary}</p>
                  </div>
                )}
                {!lightningCard.connectionType && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
                    <p className="text-sm leading-5 text-gray-600">{lightningCard.summary}</p>
                  </div>
                )}
              </div>

              <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => openProvider("lightning")}
                    className={`h-9 rounded-md px-3.5 text-sm font-semibold shadow-sm transition ${
                      lightningCard.status === "Connected"
                        ? "border border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50"
                        : "border border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
                    }`}
                  >
                    {lightningCard.actionLabel}
                  </button>
                  {lightningCard.showClearSpeed ? (
                    <button
                      onClick={disconnectSpeed}
                      className="h-9 rounded-md border border-red-200 bg-white px-3.5 text-sm font-semibold text-red-600 shadow-sm transition hover:bg-red-50"
                    >
                      Clear Setup
                    </button>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">Enabled</span>
                  <ToggleSwitch
                    checked={isEnabled("lightning")}
                    disabled={lightningCard.status !== "Connected"}
                    onChange={(v) => toggleProvider("lightning", v)}
                  />
                </div>
              </div>
            </div>
          )
        })()}

        {false ? (
        <div className="hidden">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 className="text-base font-semibold leading-tight text-gray-950">Bitcoin Lightning</h2>
            <ProviderStatusPill
              label={getStatus("lightning")}
              tone={statusTone(getStatus("lightning")) as "default" | "blue" | "amber" | "red"}
              className="shrink-0"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Recommended: Speed Lightning */}
            {(() => {
              const speedProvider = getProvider("lightning_speed")
              const speedCredentials = speedProvider?.credentials || {}
              const platformConfigured = Boolean(speedCredentials.platform_configured)
              const dashboardUrl = String(speedCredentials.dashboard_url || "")
              const speedMode = String(speedCredentials.mode || "")
              const setupStatus = String(speedCredentials.setup_status || "pending_speed_connect_confirmation")
              const platformMissing = Array.isArray(speedCredentials.platform_missing)
                ? (speedCredentials.platform_missing as unknown[]).map(String).join(", ")
                : ""
              return (
                <div className="flex flex-col rounded-xl border border-blue-100 bg-blue-50/40 p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-blue-600 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                      Recommended
                    </span>
                    <ProviderStatusPill
                      label={platformConfigured ? "Platform configured" : "Missing env"}
                      tone={platformConfigured ? "blue" : "amber"}
                      className="shrink-0"
                    />
                  </div>

                  <p className="text-sm font-semibold text-gray-950">Recommended: Speed Lightning</p>
                  <p className="mt-1.5 text-sm leading-5 text-gray-600">
                    PineTree processes Lightning payments through Speed. PineTree keeps its $0.15 service fee and sends the remaining merchant amount to your configured Speed account.
                  </p>

                  <div className="mt-3 rounded-lg border border-blue-100 bg-white px-3 py-2.5">
                      <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Platform status</span>
                      <span className="mt-1 block text-sm font-medium text-gray-950">
                        {platformConfigured ? "PineTree Speed env configured" : `PineTree Speed env missing${platformMissing ? `: ${platformMissing}` : ""}`}
                      </span>
                      <span className="mt-0.5 block text-xs text-gray-500">
                        {speedMode === "test" ? "Test mode" : speedMode === "live" || speedMode === "production" ? "Production mode" : "Mode unknown"}
                      </span>
                      <span className="mt-1 block text-xs text-amber-600">
                        {Boolean(speedCredentials.payment_processing_live) ? "Speed payments ready" : "Speed payments need setup"}
                      </span>
                      <span className="mt-0.5 block text-xs text-amber-600">
                        {String(speedCredentials.account_id || "") ? "Merchant Speed Account ID configured" : "Merchant Speed Account ID missing"}
                      </span>
                      <span className="mt-0.5 block text-xs text-gray-500">
                        Setup status: {setupStatus.replace(/_/g, " ")}
                      </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <a href={speedAssociatedAccountsUrl} target="_blank" rel="noopener noreferrer" className={secondaryButtonClass()}>
                      Open Associated Accounts
                    </a>
                    <a href={speedAutoSwapUrl} target="_blank" rel="noopener noreferrer" className={secondaryButtonClass()}>
                      Auto-Swap Settings
                    </a>
                    <a href={speedAutoPayoutUrl} target="_blank" rel="noopener noreferrer" className={secondaryButtonClass()}>
                      Payout Settings
                    </a>
                    <a href={speedDocsUrl} target="_blank" rel="noopener noreferrer" className={secondaryButtonClass()}>
                      Learn about Speed
                    </a>
                    <a href={dashboardUrl || speedLoginUrl} target="_blank" rel="noopener noreferrer" className={secondaryButtonClass()}>
                      Open Speed Dashboard
                    </a>
                  </div>

                  <div className="mt-auto flex items-center gap-2 pt-4">
                    <button
                      onClick={() => openProvider("speed")}
                      className="h-9 rounded-md border border-blue-600 bg-blue-600 px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
                    >
                      View Setup
                    </button>
                    <button
                      onClick={disconnectSpeed}
                      className="h-9 rounded-md border border-red-200 bg-white px-3.5 text-sm font-semibold text-red-600 shadow-sm transition hover:bg-red-50"
                    >
                      Clear Setup
                    </button>
                  </div>
                </div>
              )
            })()}

            {/* Advanced/Beta: Direct Lightning Wallet (NWC) */}
            <div className="flex flex-col rounded-xl border border-gray-200 bg-gray-50/60 p-4">
              <div className="mb-2">
                <span className="rounded-full border border-gray-300 bg-white px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  Advanced/Beta
                </span>
              </div>
              <p className="text-sm font-semibold text-gray-950">Direct Lightning Wallet</p>
              <p className="mt-1.5 text-sm leading-5 text-gray-600">
                For technical merchants using Zeus, Alby Hub, or another NWC-compatible wallet. Requires a wallet connection string and the permissions make_invoice, lookup_invoice, and pay_invoice.
              </p>

              {getStatus("lightning") === "Connected" && (
                <div className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Connected</span>
                  <span className="mt-1 block min-w-0 truncate text-sm font-medium leading-snug text-gray-950">
                    {String(getProvider("lightning")?.credentials?.wallet_label || "")
                      ? `Lightning • ${String(getProvider("lightning")?.credentials?.wallet_label || "")}`
                      : "Lightning Wallet"}
                  </span>
                </div>
              )}

              <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                <button
                  onClick={() =>
                    getStatus("lightning") === "Connected"
                      ? disconnect("lightning")
                      : openProvider("lightning")
                  }
                  className={`h-9 rounded-md px-3.5 text-sm font-semibold shadow-sm transition ${
                    getStatus("lightning") === "Connected"
                      ? "border border-red-200 bg-white text-red-600 hover:bg-red-50"
                      : "border border-gray-300 bg-white text-gray-700 hover:border-gray-400 hover:bg-gray-50"
                  }`}
                >
                  {getStatus("lightning") === "Connected" ? "Disconnect" : "Set up advanced wallet"}
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">Enabled</span>
                  <ToggleSwitch
                    checked={isEnabled("lightning")}
                    disabled={getStatus("lightning") !== "Connected"}
                    onChange={(v) => toggleProvider("lightning", v)}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        ) : null}
      </div>
      </DashboardSection>

      {activeProvider && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3"
          onMouseDown={closeProviderModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Provider setup"
            className="relative bg-white p-4 sm:p-6 rounded-lg w-full max-w-[520px] max-h-[90vh] overflow-y-auto shadow-lg"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2 className="text-lg font-semibold text-gray-950">
                {activeProvider === "solana"
                  ? "Set Up Solana Pay"
                  : activeProvider === "base"
                    ? "Set Up Base Pay"
                    : activeProvider === "lightning"
                      ? "Bitcoin Lightning"
                    : `Connect ${activeProvider}`}
              </h2>

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
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setLightningSetupTab("speed")}
                    className={`rounded-xl border px-3 py-3 text-left transition ${
                      lightningSetupTab === "speed"
                        ? "border-blue-500 bg-blue-50 text-blue-900"
                        : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <span className="block text-sm font-semibold">Recommended: Speed Lightning</span>
                    <span className="mt-1 block text-xs leading-5 text-gray-600">Merchant Speed Account ID setup</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setLightningSetupTab("nwc")}
                    className={`rounded-xl border px-3 py-3 text-left transition ${
                      lightningSetupTab === "nwc"
                        ? "border-blue-500 bg-blue-50 text-blue-900"
                        : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <span className="block text-sm font-semibold">Advanced NWC Wallet</span>
                    <span className="mt-1 block text-xs leading-5 text-gray-600">NWC wallet connection</span>
                  </button>
                </div>

                {lightningSetupTab === "speed" ? (
                  <div className="mb-2">
                    {/* Step progress bars */}
                    <div className="mb-5 grid grid-cols-2 gap-2">
                      {[1, 2].map((step) => (
                        <div
                          key={step}
                          className={`h-1.5 rounded-full transition-colors ${
                            speedSetupStep >= step ? "bg-blue-600" : "bg-gray-200"
                          }`}
                        />
                      ))}
                    </div>

                    <div className="rounded-2xl border border-gray-200 bg-gray-50/80 p-4 shadow-inner sm:p-5">
                      {/* ── Step 1: Open Speed ── */}
                      {speedSetupStep === 1 && (
                        <div className="space-y-5">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                              Step 1 of 2
                            </p>
                            <h3 className="mt-2 text-xl font-semibold leading-tight text-gray-950">
                              Open Speed
                            </h3>
                            <p className="mt-2 text-sm leading-6 text-gray-600">
                              Create or open your TrySpeed account. Speed handles Lightning invoices, auto-swap, and merchant settlement.
                            </p>
                          </div>

                          {(() => {
                            const dashboardLink = providerSpeedSetupLinks.find((l) => l.key === "dashboard")
                            if (dashboardLink) {
                              return (
                                <a
                                  href={dashboardLink.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`${primaryButtonClass()} block text-center`}
                                >
                                  Open Speed Signup / Login
                                </a>
                              )
                            }
                            return (
                              <div className="space-y-1.5">
                                <button
                                  type="button"
                                  disabled
                                  className={`${primaryButtonClass()} w-full cursor-not-allowed opacity-60`}
                                >
                                  Open Speed Signup / Login
                                </button>
                                <p className="text-center text-xs text-gray-500">
                                  Speed dashboard URL is not configured.
                                </p>
                              </div>
                            )
                          })()}

                          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                            <button
                              type="button"
                              onClick={closeProviderModal}
                              className={`${secondaryButtonClass()} w-full sm:w-auto`}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => setSpeedSetupStep(2)}
                              className={`${primaryButtonClass()} w-full sm:w-auto`}
                            >
                              I have a Speed account →
                            </button>
                          </div>
                        </div>
                      )}

                      {/* ── Step 2: Enter Account ID ── */}
                      {speedSetupStep === 2 && (
                        <div className="space-y-5">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                              Step 2 of 2
                            </p>
                            <h3 className="mt-2 text-xl font-semibold leading-tight text-gray-950">
                              Enter Account ID
                            </h3>
                            <p className="mt-2 text-sm leading-6 text-gray-600">
                              Add your Merchant Speed Account ID. PineTree uses it to route Lightning payments to your Speed account.
                            </p>
                          </div>

                          <label className="block">
                            <span className="text-sm font-semibold text-gray-900">Merchant Speed Account ID</span>
                            <input
                              value={speedAccountId}
                              onChange={(e) => setSpeedAccountId(e.target.value)}
                              placeholder="Merchant Speed Account ID"
                              className={lightningInputClass()}
                              autoComplete="off"
                            />
                          </label>

                          {(() => {
                            const accountIdLink = providerSpeedSetupLinks.find((l) => l.key === "accountId")
                            return accountIdLink ? (
                              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                <p className="text-xs text-gray-500">Find this under Settings → Associated Accounts in your Speed dashboard.</p>
                                <a
                                  href={accountIdLink.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm font-semibold text-blue-600 hover:text-blue-700"
                                >
                                  Find Account ID →
                                </a>
                              </div>
                            ) : (
                              <p className="text-xs text-gray-500">Find this under Settings → Associated Accounts in your Speed dashboard.</p>
                            )
                          })()}

                          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                            <button
                              type="button"
                              onClick={() => setSpeedSetupStep(1)}
                              className={`${secondaryButtonClass()} w-full sm:w-auto`}
                            >
                              ← Back
                            </button>
                            <button
                              type="button"
                              onClick={saveSpeedSetup}
                              disabled={loading || !speedAccountId.trim()}
                              className={`${primaryButtonClass()} w-full sm:w-auto`}
                            >
                              {loading ? "Saving..." : "Save Setup"}
                            </button>
                          </div>

                          {getLightningCardState().status === "Connected" && (
                            <div className="border-t border-gray-100 pt-3">
                              <button
                                type="button"
                                onClick={async () => { await disconnectSpeed(); closeProviderModal() }}
                                className="text-sm text-red-600 hover:text-red-700"
                              >
                                Disconnect Speed setup
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                <div className={lightningSetupTab === "nwc" ? "space-y-4" : "hidden"}>
                <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3">
                  <p className="text-sm font-semibold text-gray-900">Advanced NWC Wallet</p>
                  <p className="mt-1 text-sm leading-5 text-gray-600">
                    Connect a direct Lightning wallet only if you manage your own NWC connection.
                  </p>
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Get your wallet ready</p>
                  <div className="flex flex-wrap gap-2">
                    <a href={providerAlbyHubAppsUrl} target="_blank" rel="noopener noreferrer" className={actionButtonClass()}>
                      Open Alby Hub Apps
                    </a>
                    <a href={providerZeusIosUrl} target="_blank" rel="noopener noreferrer" className={secondaryButtonClass()}>
                      Zeus (iOS)
                    </a>
                    <a href={providerZeusAndroidUrl} target="_blank" rel="noopener noreferrer" className={secondaryButtonClass()}>
                      Zeus (Android)
                    </a>
                    <a href={providerAlbyNwcDocsUrl} target="_blank" rel="noopener noreferrer" className={secondaryButtonClass()}>
                      Alby Setup Guide
                    </a>
                    <a href={providerZeusDocsUrl} target="_blank" rel="noopener noreferrer" className={secondaryButtonClass()}>
                      Zeus Guide
                    </a>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-gray-500">
                    Enable three permissions: create invoices, check payment status, and pay out. For step-by-step instructions, open the <strong>Wallets</strong> page and use the Manage Wallet tab.
                  </p>
                </div>

                <label className="block">
                  <span className="text-sm font-semibold text-gray-900">NWC connection string</span>
                  <span className="mt-0.5 block text-xs text-gray-500">
                    Found in your wallet under &ldquo;Nostr Wallet Connect&rdquo; or &ldquo;NWC&rdquo;. Starts with <span className="font-mono">nostr+walletconnect://</span>
                  </span>
                  <input
                    type="password"
                    value={nwcUri}
                    onChange={(e) => { setNwcUri(e.target.value); setNwcTestResult(null) }}
                    placeholder="NWC connection string"
                    className={lightningInputClass()}
                    autoComplete="off"
                  />
                  <span className="mt-1 block text-xs text-gray-400">
                    Stored securely on PineTree servers. Never shown again after saving.
                  </span>
                </label>

                <label className="block">
                  <span className="text-sm font-semibold text-gray-900">
                    Wallet label
                  </span>
                  <input
                    value={nwcWalletLabel}
                    onChange={(e) => setNwcWalletLabel(e.target.value)}
                    placeholder="Wallet label"
                    className={lightningInputClass()}
                  />
                </label>

                {nwcTestResult && (
                  <div className={`rounded-xl border px-4 py-3 ${nwcTestResult.ready ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}>
                    <p className={`text-sm font-semibold ${nwcTestResult.ready ? "text-green-800" : "text-amber-900"}`}>
                      {nwcTestResult.ready
                        ? `Ready for live Lightning payments${nwcTestResult.walletAlias ? ` — ${nwcTestResult.walletAlias}` : ""}`
                        : nwcTestResult.connected
                          ? "Connected, but not ready for live payments"
                          : "Could not connect to wallet"}
                    </p>
                    {nwcTestResult.connected && !nwcTestResult.ready && (
                      <div className="mt-2 space-y-1">
                        {(nwcTestResult.missingPermissions || []).map((perm) => (
                          <p key={perm} className="text-xs text-amber-800">
                            Missing:{" "}
                            {perm === "make_invoice"
                              ? "Create invoices"
                              : perm === "lookup_invoice"
                                ? "Check payment status"
                                : perm === "pay_invoice"
                                  ? "Pay invoice (pay_invoice)"
                                  : perm}
                          </p>
                        ))}
                      </div>
                    )}
                    {!nwcTestResult.connected && nwcTestResult.error && (
                      <p className="mt-1 text-xs text-amber-800">{nwcTestResult.error}</p>
                    )}
                  </div>
                )}

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                  <button
                    type="button"
                    onClick={closeProviderModal}
                    className={`${secondaryButtonClass()} w-full sm:w-auto`}
                  >
                    Cancel
                  </button>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={testNwcConnection}
                      disabled={nwcTesting || !nwcUri.trim()}
                      className={`hidden ${secondaryButtonClass()} w-full sm:w-auto`}
                    >
                      {nwcTesting ? "Testing..." : "Test Connection"}
                    </button>

                    <button
                      onClick={() => saveProvider("lightning")}
                      disabled={loading || !nwcUri.trim()}
                      className={`${primaryButtonClass()} w-full sm:w-auto`}
                    >
                      {loading ? "Connecting..." : "Connect NWC Wallet"}
                    </button>
                  </div>
                </div>
                </div>
              </div>
            )}


            {(activeProvider === "solana" || activeProvider === "base") && (
              <div className="mb-5 space-y-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
                  <span className="font-semibold text-gray-950">
                    {activeProvider === "solana" ? "Solana Pay" : "Base Pay"}
                  </span>
                  <span className="text-gray-400">·</span>
                  <span>Settlement: <span className="font-semibold text-gray-950">Connected wallet</span></span>
                </div>
                <p className="text-sm leading-5 text-gray-500">
                  Connect the wallet that will receive payments. Funds go directly to this address when customers pay.
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

            {activeProvider === "shift4" && (
              <div className="mb-4">
                <div className="w-full h-40 border rounded flex items-center justify-center text-black text-sm">
                  Shift4 onboarding form will appear here
                </div>

                <p className="text-sm text-black mt-2">
                  Complete your Shift4 merchant application and enter your API key below.
                </p>
              </div>
            )}

            {(activeProvider === "solana" || activeProvider === "base") && (
              <div className="mb-4 space-y-4">

                {/* Step 1 — wallet selection */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {activeProvider === "solana" ? "Choose wallet" : "Choose wallet"}
                  </p>
                  {activeProvider === "solana" && (
                    <div className="grid grid-cols-2 gap-2">
                      {(["PHANTOM", "SOLFLARE"] as const).map((wt) => (
                        <button
                          key={wt}
                          type="button"
                          onClick={() => { setSelectedWalletType(wt); setShowMobileConnect(false) }}
                          className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                            selectedWalletType === wt
                              ? "border-[#0052FF] bg-[#0052FF]/5 text-[#0052FF]"
                              : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          {wt === "PHANTOM" ? "Phantom" : "Solflare"}
                        </button>
                      ))}
                    </div>
                  )}
                  {activeProvider === "base" && (
                    <div className="grid grid-cols-3 gap-2">
                      {(["BASEAPP", "METAMASK", "TRUST"] as const).map((wt) => (
                        <button
                          key={wt}
                          type="button"
                          onClick={() => { setSelectedWalletType(wt); setShowMobileConnect(false) }}
                          className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                            selectedWalletType === wt
                              ? "border-[#0052FF] bg-[#0052FF]/5 text-[#0052FF]"
                              : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          {wt === "BASEAPP" ? "Base Wallet" : wt === "METAMASK" ? "MetaMask" : "Trust Wallet"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Primary — scan QR with mobile wallet (placeholder) */}
                <div className="rounded-xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-950">Scan with mobile wallet</p>
                      <p className="mt-1 text-sm leading-5 text-gray-600">
                        Open your wallet app and scan the QR code to connect and approve.
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-500 shadow-sm ring-1 ring-gray-200/80">
                      Coming soon
                    </span>
                  </div>
                  <div className="mt-3 flex h-24 items-center justify-center rounded-lg border border-dashed border-[#0052FF]/20 bg-white/70">
                    <p className="text-xs text-gray-400">QR code will appear here</p>
                  </div>
                </div>

                {/* Secondary — open mobile wallet (works now via deep-link) */}
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-sm font-semibold text-gray-950">Open in mobile wallet</p>
                  <p className="mt-1 text-sm leading-5 text-gray-600">
                    Tap to open your selected wallet app and approve the connection from your phone.
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      if (activeProvider === "solana") {
                        await openSolanaMobileWallet(selectedWalletType)
                      } else {
                        await openBaseMobileWallet()
                      }
                    }}
                    className="mt-3 rounded-lg border border-[#0052FF] bg-[#0052FF] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!selectedWalletType}
                  >
                    Open Mobile Wallet
                  </button>

                  {showMobileConnect && (
                    <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50/80 p-3 text-center">
                      {walletSessionStatus === "pending" && (
                        <p className="text-xs text-gray-600">Waiting for mobile wallet approval…</p>
                      )}
                      {walletSessionStatus === "connected" && (
                        <p className="text-xs font-semibold text-[#0052FF]">Mobile wallet connected — review and save below.</p>
                      )}
                      {activeProvider === "base" && walletMobileDeeplink && (
                        <a
                          href={walletMobileDeeplink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-block text-xs text-blue-600 underline"
                        >
                          Open wallet manually
                        </a>
                      )}
                    </div>
                  )}
                </div>

                {/* Tertiary — connect on this device */}
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-sm font-semibold text-gray-950">Connect on this device</p>
                  <p className="mt-1 text-sm leading-5 text-gray-600">
                    If your wallet browser extension is installed, connect directly from this page.
                  </p>
                  <button
                    type="button"
                    onClick={() => saveProvider(activeProvider)}
                    className="mt-3 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!selectedWalletType}
                  >
                    Connect on This Device
                  </button>
                </div>

                {/* Fallback — paste address */}
                <details className="rounded-xl border border-gray-200 bg-white">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-gray-600 hover:text-gray-800">
                    Or paste wallet address manually
                  </summary>
                  <div className="border-t border-gray-100 px-4 py-3 space-y-2">
                    <p className="text-xs leading-5 text-gray-500">
                      Only use this if wallet connection is not available. Verify the address is on the correct network before saving.
                    </p>
                    <input
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      placeholder={activeProvider === "solana" ? "Solana wallet address" : "Base wallet address (0x…)"}
                      className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-50"
                    />
                  </div>
                </details>

              </div>
            )}

            {activeProvider !== "solana" &&
              activeProvider !== "base" &&
              activeProvider !== "lightning" && (
                <input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={
                    activeProvider === "coinbase"
                      ? "Enter Coinbase API Key"
                      : activeProvider === "shift4"
                        ? "Enter Shift4 API Key"
                        : "Enter Wallet Address"
                  }
                  className="w-full border border-gray-300 rounded p-2 mb-4 text-black bg-white"
                />
              )}

            {activeProvider !== "lightning" && (
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <button
                onClick={closeProviderModal}
                className="w-full sm:w-auto px-3 py-1.5 text-sm border rounded bg-white text-black"
              >
                Cancel
              </button>

              <button
                onClick={() => saveProvider(activeProvider)}
                disabled={loading}
                className="w-full sm:w-auto px-3 py-1.5 text-sm bg-blue-600 text-white rounded"
              >
                {loading ? "Saving..." : activeProvider === "lightning" ? "Verify Bitcoin Lightning" : "Save Wallet"}
              </button>
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}


