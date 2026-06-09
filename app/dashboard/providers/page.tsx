"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Image from "next/image"
import { supabase } from "@/lib/supabaseClient"
import { speedLoginUrl, speedSignupUrl, speedAccountSetupUrl } from "@/lib/speedDashboardLinks"
import ToggleSwitch from "@/components/ui/ToggleSwitch"
import { toast } from "sonner"
import QRCode from "qrcode"
import { ChevronRight, X } from "lucide-react"
import {
  CompactMetricTile,
  DashboardSection,
  MetricGrid,
  ProviderStatusPill,
  dashboardPageTitleClass
} from "@/components/dashboard/DashboardPrimitives"

const providerAlbyHubAppsUrl = process.env.NEXT_PUBLIC_ALBY_HUB_APPS_URL || "https://getalby.com/hub/apps"
const providerAlbyNwcDocsUrl = process.env.NEXT_PUBLIC_ALBY_NWC_DOCS_URL || "https://guides.getalby.com/user-guide/alby-account-and-browser-extension/alby-hub/nwc"
const providerZeusIosUrl = process.env.NEXT_PUBLIC_ZEUS_IOS_URL || "https://apps.apple.com/us/app/zeus-ln/id1456038895"
const providerZeusAndroidUrl = process.env.NEXT_PUBLIC_ZEUS_ANDROID_URL || "https://play.google.com/store/apps/details?id=app.zeusln"
const providerZeusDocsUrl = process.env.NEXT_PUBLIC_ZEUS_DOCS_URL || "https://zeusln.app"


type ProviderCredentials = {
  api_key?: string
  wallet?: string
  wallet_type?: string | null
  wallet_label?: string
  provider_model?: string
  account_reference?: string
  api_status?: string
  webhook_status?: string
  notes?: string
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
  const [shift4AccountReference, setShift4AccountReference] = useState("")
  const [shift4ApiStatus, setShift4ApiStatus] = useState("Pending approval")
  const [shift4WebhookStatus, setShift4WebhookStatus] = useState("Not configured")
  const [shift4Notes, setShift4Notes] = useState("")
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
  const [nwcWalletReadyOpen, setNwcWalletReadyOpen] = useState(false)
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
  const [engineSettingsPanel, setEngineSettingsPanel] = useState<"routing" | "conversion" | null>(null)

  const [selectedWalletType, setSelectedWalletType] = useState<string | null>(null)
  const [showMobileConnect, setShowMobileConnect] = useState(false)
  const [walletQrCode, setWalletQrCode] = useState<string | null>(null)

  const [walletSessionId, setWalletSessionId] = useState<string | null>(null)
  const [walletSessionStatus, setWalletSessionStatus] = useState<string | null>(null)
  const [walletMobileDeeplink, setWalletMobileDeeplink] = useState<string | null>(null)
  const [connectedWalletAddress, setConnectedWalletAddress] = useState<string | null>(null)

  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const didToastSyncRef = useRef(false)
  const pollStopAtRef = useRef<number | null>(null)
  const walletSetupRequestRef = useRef<{
    provider: "solana" | "base"
    walletType: string
  } | null>(null)

  const closeProviderModal = useCallback(() => {
    setActiveProvider(null)
    setInputValue("")
    setShift4AccountReference("")
    setShift4ApiStatus("Pending approval")
    setShift4WebhookStatus("Not configured")
    setShift4Notes("")
    setNwcUri("")
    setNwcWalletLabel("")
    setNwcTestResult(null)
    setNwcTesting(false)
    setShowMobileConnect(false)
    setWalletQrCode(null)
    setSelectedWalletType(null)
    setWalletSessionId(null)
    setWalletSessionStatus(null)
    setWalletMobileDeeplink(null)
    setConnectedWalletAddress(null)
    didToastSyncRef.current = false
    setSpeedAccountId("")
    setLightningSetupTab("speed")
    setSpeedTestResult(null)
    setSpeedTesting(false)
    setSpeedSetupStep(1)
    setNwcWalletReadyOpen(false)

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

  async function startWalletSetupSession(
    provider: "solana" | "base",
    walletType: string
  ) {
    if (!walletType) return null

    const existingRequest = walletSetupRequestRef.current
    if (
      existingRequest?.provider === provider &&
      existingRequest.walletType === walletType &&
      walletSessionId &&
      walletMobileDeeplink &&
      walletQrCode
    ) {
      return {
        sessionId: walletSessionId,
        deeplink: walletMobileDeeplink,
      }
    }

    walletSetupRequestRef.current = { provider, walletType }
    setWalletQrCode(null)
    setShowMobileConnect(false)

    const sessionId = await createWalletConnectSession(provider, walletType)
    const returnUrl = buildMobileBridgeUrl(provider, walletType, sessionId)
    const deeplink = buildWalletDeepLink(provider, walletType, returnUrl)
    const qr = await QRCode.toDataURL(deeplink, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
    })

    const latestRequest = walletSetupRequestRef.current
    if (
      latestRequest?.provider !== provider ||
      latestRequest.walletType !== walletType
    ) {
      return null
    }

    setWalletMobileDeeplink(deeplink)
    setWalletQrCode(qr)

    return {
      sessionId,
      deeplink,
    }
  }

  useEffect(() => {
    if (!activeProvider) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeProviderModal()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [activeProvider, closeProviderModal])

  useEffect(() => {
    if (
      !walletSessionId ||
      !activeProvider ||
      (activeProvider !== "solana" && activeProvider !== "base")
    ) return

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
          setConnectedWalletAddress(session.wallet_address)

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
          setWalletQrCode(null)
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
  }, [walletSessionId, activeProvider, loadAll])

  useEffect(() => {
    if (activeProvider !== "solana" && activeProvider !== "base") {
      walletSetupRequestRef.current = null
      return
    }

    if (!selectedWalletType) {
      walletSetupRequestRef.current = null
      setWalletQrCode(null)
      setWalletSessionId(null)
      setWalletSessionStatus(null)
      setWalletMobileDeeplink(null)
      return
    }

    startWalletSetupSession(activeProvider, selectedWalletType).catch((err) => {
      console.error("Wallet setup QR error:", err)
      toast.error(err instanceof Error ? err.message : "Failed to generate wallet QR")
    })
    // startWalletSetupSession reads the latest setup state and is intentionally
    // keyed by modal provider plus selected wallet to avoid duplicate sessions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProvider, selectedWalletType])

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
    if (provider === "shift4" && p.status === "pending") return "Setup pending"

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
  // Each callback page handles its own wallet protocol:
  //   /solana-return       — Solana (window.solana.connect())
  //   /base-wallet-setup   — EVM / Base (window.ethereum eth_requestAccounts)
  // Both pages POST the resolved wallet address back to /api/wallet-connect-session
  // and redirect to return_to so the Providers dashboard polling picks it up.
  const path =
    provider === "solana"
      ? "/solana-return"
      : "/base-wallet-setup"

  const url = new URL(`${getOrigin()}${path}`)

  url.searchParams.set("provider", provider)
  url.searchParams.set("wallet_type", walletType)
  url.searchParams.set("session_id", sessionId)
  url.searchParams.set("return_to", getDesktopProvidersUrl())

  return url.toString()
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

  function buildWalletDeepLink(
    provider: "solana" | "base",
    walletType: string,
    returnUrl: string
  ) {
    if (provider === "solana") {
      if (walletType === "PHANTOM") {
        return `https://phantom.app/ul/browse/${encodeURIComponent(returnUrl)}`
      }

      if (walletType === "SOLFLARE") {
        return `https://solflare.com/ul/v1/browse/${encodeURIComponent(returnUrl)}`
      }

      throw new Error("Select Phantom or Solflare first")
    }

    if (walletType === "METAMASK") {
      return `metamask://dapp?url=${encodeURIComponent(returnUrl)}`
    }

    if (walletType === "TRUST") {
      return `trust://dapp?url=${encodeURIComponent(returnUrl)}`
    }

    if (walletType === "BASEAPP") {
      return `cbwallet://dapp?url=${encodeURIComponent(returnUrl)}`
    }

    throw new Error("Select Base Wallet, MetaMask, or Trust Wallet first")
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
    setConnectedWalletAddress(null)
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
      if (!walletType) {
        toast.error("Select Phantom or Solflare first")
        return
      }

      const setup = await startWalletSetupSession("solana", walletType)
      const deeplink = setup?.deeplink || walletMobileDeeplink

      if (!deeplink) {
        throw new Error("Failed to create Solana wallet link")
      }

      setShowMobileConnect(true)
      window.location.href = deeplink
    } catch (err) {
      console.error("Solana mobile wallet error:", err)
      toast.error("Failed to open Solana wallet")
    }
  }

  async function openBaseMobileWallet() {
    try {
      if (!selectedWalletType) {
        toast.error("Select a wallet first")
        return
      }

      const setup = await startWalletSetupSession("base", selectedWalletType)
      const deeplink = setup?.deeplink || walletMobileDeeplink

      if (!deeplink) {
        throw new Error("Failed to create wallet link")
      }

      setShowMobileConnect(true)
      window.location.href = deeplink
    } catch (err) {
      console.error("Base mobile wallet error:", err)
      toast.error("Failed to open wallet. Make sure the wallet app is installed.")
    }
  }

  async function connectWalletOnThisDevice() {
    if (activeProvider !== "solana" && activeProvider !== "base") return

    if (!selectedWalletType) {
      toast.error(
        activeProvider === "solana"
          ? "Select Phantom or Solflare first"
          : "Select Base Wallet, MetaMask, or Trust Wallet first"
      )
      return
    }

    setLoading(true)

    try {
      const result =
        activeProvider === "solana"
          ? await connectSolanaWallet(selectedWalletType)
          : await connectBaseWallet(selectedWalletType)

      if (!result?.walletAddress) {
        toast.error(
          activeProvider === "solana"
            ? "No wallet detected - install Phantom or Solflare, or paste address"
            : "No wallet detected - install the selected wallet or paste address"
        )
        return
      }

      setInputValue(result.walletAddress)
      setConnectedWalletAddress(result.walletAddress)
      setSelectedWalletType(result.walletType)
      setWalletSessionStatus("connected")
      toast.success("Wallet connected. Review and save.")
    } finally {
      setLoading(false)
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
    } else if (provider === "shift4") {
      const savedApiStatus = String(p?.credentials?.api_status || "Pending approval")
      const savedWebhookStatus = String(p?.credentials?.webhook_status || "Not configured")
      setInputValue("")
      setShift4AccountReference(String(p?.credentials?.account_reference || ""))
      setShift4ApiStatus(
        savedApiStatus === "Active"
          ? "Live ready"
          : savedApiStatus === "Not issued"
            ? "Pending approval"
            : savedApiStatus
      )
      setShift4WebhookStatus(savedWebhookStatus === "Active" ? "Verified" : savedWebhookStatus)
      setShift4Notes(String(p?.credentials?.notes || ""))
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
    setWalletQrCode(null)
    setSelectedWalletType(null)
    setWalletSessionId(null)
    setWalletSessionStatus(null)
    setWalletMobileDeeplink(null)
    setConnectedWalletAddress(null)
    walletSetupRequestRef.current = null
    didToastSyncRef.current = false

    if (pollerRef.current) {
      clearInterval(pollerRef.current)
      pollerRef.current = null
    }

    setActiveProvider(modalProvider)
  }

  function selectWalletType(walletType: string) {
    if (selectedWalletType === walletType) return

    walletSetupRequestRef.current = null
    setSelectedWalletType(walletType)
    setShowMobileConnect(false)
    setWalletQrCode(null)
    setWalletSessionId(null)
    setWalletSessionStatus(null)
    setWalletMobileDeeplink(null)

    if (connectedWalletAddress) {
      setConnectedWalletAddress(null)
    }
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
      if (provider === "shift4") {
        const accountReference = shift4AccountReference.trim()
        if (!accountReference) {
          toast.error("Shift4 Account Reference is required")
          return
        }

        const payload = await callProvidersApi("POST", {
          action: "saveProvider",
          provider,
          providerSetup: {
            account_reference: accountReference,
            api_status: shift4ApiStatus.trim(),
            webhook_status: shift4WebhookStatus.trim(),
            notes: shift4Notes.trim()
          }
        })

        applyProvidersPayload(payload)
        closeProviderModal()
        toast.success("Shift4 provider setup saved")
        return
      }

      let walletAddress = (inputValue || "").trim()
      let walletType: string | null = selectedWalletType

      if (!walletAddress && walletSessionStatus === "connected") {
        toast.error("Wallet detected but not yet loaded. Try again.")
        return
      }

      if (provider === "solana" || provider === "base") {
        walletType = provider === "solana"
          ? selectedWalletType || "MANUAL"
          : selectedWalletType || "BASEAPP"

        if (!walletAddress) {
          toast.error(
            provider === "solana"
              ? "Connect a wallet or paste a Solana address"
              : "Connect a wallet or paste a Base address"
          )
          return
        }

        const payload = await callProvidersApi("POST", {
          action: "saveProvider",
          provider,
          walletAddress,
          walletType,
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

        closeProviderModal()
        toast.success(provider === "solana" ? "Solana wallet connected" : "Base wallet connected")
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
      } else if (provider === "coinbase") {
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
        apiKey: provider === "coinbase" ? walletAddress : undefined
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
      setWalletQrCode(null)
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
    if (status === "Connected" || status === "Ready") return "blue"
    if (status === "Setup needed" || status === "Setup pending" || status === "Needs verification" || status === "Needs permissions" || status === "Setup only") return "amber"
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
        detail: formatCredentialPart(String(speedCredentials.account_id), 10, 4)
      }
    }

    if (nwcConnected) {
      const walletLabel = String(getProvider("lightning")?.credentials?.wallet_label || "Lightning Wallet")
      return {
        status: "Connected" as const,
        connectionType: "nwc" as const,
        summary: "Bitcoin Lightning payments route through the connected NWC wallet.",
        detail: walletLabel
      }
    }

    return {
      status: "Not Connected" as const,
      connectionType: null,
      summary: "Setup needed: connect Speed Lightning or Advanced NWC.",
      detail: ""
    }
  }

  function shift4StatusBadgeClass(ready: boolean) {
    return ready
      ? "border-blue-200 bg-blue-50 text-blue-700"
      : "border-amber-200 bg-amber-50 text-amber-700"
  }

  function Shift4ChecklistRow({
    label,
    ready,
    readyLabel = "Ready"
  }: {
    label: string
    ready: boolean
    readyLabel?: string
  }) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2.5">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${shift4StatusBadgeClass(ready)}`}>
          {ready ? readyLabel : "Pending"}
        </span>
      </div>
    )
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
    const shift4AccountReference = String(p?.credentials?.account_reference || "").trim()
    const savedShift4ApiStatus = String(p?.credentials?.api_status || "").trim()
    const savedShift4WebhookStatus = String(p?.credentials?.webhook_status || "").trim()
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

          {provider === "shift4" && shift4AccountReference ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                {connected ? "Connected" : "Setup saved"}
              </span>
              <span className="mt-1 block text-sm font-medium leading-snug text-gray-950">
                Shift4 &bull; Merchant account
              </span>
              <span
                className="mt-0.5 block truncate text-xs leading-5 text-gray-500"
                title={shift4AccountReference}
              >
                Account reference: {formatCredentialPart(shift4AccountReference, 8, 4)}
              </span>
              <span className="block text-xs leading-5 text-gray-500">
                Approval return: Automatic
              </span>
              <span className="block text-xs leading-5 text-gray-500">
                Webhook: {savedShift4WebhookStatus || "Not configured"}
              </span>
              {savedShift4ApiStatus ? (
                <span className="block text-xs leading-5 text-gray-500">API: {savedShift4ApiStatus}</span>
              ) : null}
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
  const connectedAndEnabledProviders = providers.filter((provider) =>
    provider.enabled && getStatus(provider.provider) === "Connected"
  )

  return (
    <div className="space-y-5 md:space-y-7">
      <div>
        <h1 className={dashboardPageTitleClass}>Providers</h1>
      </div>

      <MetricGrid columns="four">
        <CompactMetricTile label="Connected" value={connectedAndEnabledProvidersCount} tone="blue" />
        <CompactMetricTile label="Payment Options" value="5" />
        <CompactMetricTile
          label="Smart Routing"
          value={smartRouting ? "On" : "Off"}
          tone={smartRouting ? "green" : "slate"}
        />
        <CompactMetricTile
          label="Auto Conversion"
          value={autoConversion ? "On" : "Off"}
          tone={autoConversion ? "green" : "slate"}
        />
      </MetricGrid>

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
          className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center bg-slate-950/40 p-3 backdrop-blur-sm sm:p-4"
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
          settlement="Shift4 merchant account"
          description="Accept card and crypto payments through Shift4 once merchant onboarding and API access are enabled."
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
                    <p className="mt-1 truncate text-sm font-semibold text-gray-950" title="NWC - Bitcoin Lightning">
                      NWC &bull; Bitcoin Lightning
                    </p>
                    <p className="mt-0.5 truncate text-xs leading-5 text-gray-500" title={lightningCard.detail}>
                      {lightningCard.detail}
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
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => {
                      if (lightningCard.status === "Connected") {
                        if (lightningCard.connectionType === "speed") {
                          void disconnectSpeed()
                        } else {
                          void disconnect("lightning")
                        }
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
              </div>
            </div>
          )
        })()}

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
                    : activeProvider === "shift4"
                      ? "Connect Shift4"
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

                          {/* Login + Signup buttons */}
                          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                            {speedLoginUrl ? (
                              <a
                                href={speedLoginUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`${primaryButtonClass()} w-full text-center sm:w-auto`}
                              >
                                Open Speed Login
                              </a>
                            ) : (
                              <div className="flex flex-col gap-1">
                                <button
                                  type="button"
                                  disabled
                                  className={`${primaryButtonClass()} w-full cursor-not-allowed sm:w-auto`}
                                >
                                  Open Speed Login
                                </button>
                                <p className="text-xs text-gray-500">Speed login link is not configured yet.</p>
                              </div>
                            )}
                            {speedSignupUrl ? (
                              <a
                                href={speedSignupUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`${secondaryButtonClass()} w-full text-center sm:w-auto`}
                              >
                                Create Speed Account
                              </a>
                            ) : null}
                          </div>

                          {/* Navigation */}
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <button
                              type="button"
                              onClick={closeProviderModal}
                              className="py-1.5 text-sm font-medium text-gray-400 transition hover:text-gray-600 sm:px-1"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => setSpeedSetupStep(2)}
                              className={`${secondaryButtonClass()} w-full sm:w-auto`}
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

                          <p className="text-xs text-gray-500">
                            Find this under Settings &rarr; Associated Accounts in your Speed dashboard.
                          </p>

                          <div className="hidden sm:flex sm:items-center sm:justify-between sm:gap-3">
                            <button
                              type="button"
                              onClick={() => setSpeedSetupStep(1)}
                              className={quietButtonClass()}
                            >
                              Back
                            </button>
                            <div className="flex items-center gap-2">
                              {speedAccountSetupUrl ? (
                                <a
                                  href={speedAccountSetupUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={compactSecondaryButtonClass()}
                                  aria-label="Open Speed Associated Accounts"
                                  title="Open Speed Associated Accounts"
                                >
                                  Open Speed Associated Accounts
                                </a>
                              ) : (
                                <div className="flex flex-col gap-0.5">
                                  <button
                                    type="button"
                                    disabled
                                    className="inline-flex h-10 cursor-not-allowed items-center justify-center rounded-lg border border-gray-200 bg-white px-3.5 text-sm font-semibold text-gray-400"
                                    aria-label="Open Speed Associated Accounts"
                                    title="Open Speed Associated Accounts"
                                  >
                                    Open Speed Associated Accounts
                                  </button>
                                  <p className="text-xs text-gray-400">Speed account ID link is not configured yet.</p>
                                </div>
                              )}
                              <button
                                type="button"
                                onClick={saveSpeedSetup}
                                disabled={loading || !speedAccountId.trim()}
                                className={compactPrimaryButtonClass()}
                              >
                                {loading ? "Saving..." : "Save Setup"}
                              </button>
                            </div>
                          </div>

                          {/* Mobile footer: Associated Accounts / Save Setup / Back */}
                          <div className="flex flex-col gap-2 sm:hidden">
                            {speedAccountSetupUrl ? (
                              <a
                                href={speedAccountSetupUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`${compactSecondaryButtonClass()} w-full text-center`}
                                aria-label="Open Speed Associated Accounts"
                                title="Open Speed Associated Accounts"
                              >
                                Open Speed Associated Accounts
                              </a>
                            ) : (
                              <div className="flex flex-col gap-0.5">
                                <button
                                  type="button"
                                  disabled
                                  className="inline-flex h-10 w-full cursor-not-allowed items-center justify-center rounded-lg border border-gray-200 bg-white px-3.5 text-sm font-semibold text-gray-400"
                                  aria-label="Open Speed Associated Accounts"
                                  title="Open Speed Associated Accounts"
                                >
                                  Open Speed Associated Accounts
                                </button>
                                <p className="text-center text-xs text-gray-400">Speed account ID link is not configured yet.</p>
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={saveSpeedSetup}
                              disabled={loading || !speedAccountId.trim()}
                              className={`${compactPrimaryButtonClass()} w-full`}
                            >
                              {loading ? "Saving..." : "Save Setup"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setSpeedSetupStep(1)}
                              className={`${quietButtonClass()} w-full`}
                            >
                              Back
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

                {/* Get your wallet ready — collapsed accordion */}
                <div className="rounded-xl border border-gray-200 bg-white">
                  <button
                    type="button"
                    onClick={() => setNwcWalletReadyOpen((v) => !v)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left"
                  >
                    <div>
                      <span className="block text-sm font-semibold text-gray-900">Get your wallet ready</span>
                      {!nwcWalletReadyOpen && (
                        <span className="block text-xs text-gray-500">Open setup links for Alby Hub and Zeus.</span>
                      )}
                    </div>
                    <svg
                      className={`ml-2 h-4 w-4 shrink-0 text-gray-400 transition-transform ${nwcWalletReadyOpen ? "rotate-180" : ""}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                      aria-hidden="true"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {nwcWalletReadyOpen && (
                    <div className="border-t border-gray-100 px-4 pb-4 pt-3">
                      <div className="flex flex-wrap gap-2">
                        <a href={providerAlbyHubAppsUrl} target="_blank" rel="noopener noreferrer" className={actionButtonClass()}>
                          Open Alby Hub Apps
                        </a>
                        <a href={providerZeusIosUrl} target="_blank" rel="noopener noreferrer" className={secondaryButtonClass()}>
                          Zeus iOS
                        </a>
                        <a href={providerZeusAndroidUrl} target="_blank" rel="noopener noreferrer" className={secondaryButtonClass()}>
                          Zeus Android
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
                  )}
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
              <div className="mb-5 space-y-4">
                <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">
                    Shift4 provider connection
                  </p>
                  <p className="mt-2 text-sm leading-6 text-gray-700">
                    Connect this merchant&apos;s Shift4 processing account to PineTree. Shift4 onboarding,
                    merchant approval, and live API credentials are completed through Shift4. Once access
                    is issued, PineTree can enable payment routing, settlement status, and reporting for
                    this provider.
                  </p>
                  <p className="mt-3 text-xs leading-5 text-blue-800">
                    When Shift4 approval or denial is returned to PineTree, this provider card will update
                    automatically. PineTree will use the backend return/webhook flow to sync account status,
                    API readiness, and routing availability.
                  </p>
                </div>

                {(() => {
                  const apiReady = shift4ApiStatus === "Sandbox ready" || shift4ApiStatus === "Live ready"
                  const merchantApproved = apiReady
                  const webhookConfigured = shift4WebhookStatus === "Configured" || shift4WebhookStatus === "Verified"
                  const webhookVerified = shift4WebhookStatus === "Verified"
                  const liveRoutingEnabled = shift4ApiStatus === "Live ready"

                  const statusRows = [
                    {
                      label: "Merchant approval",
                      value: merchantApproved ? "Approved" : shift4ApiStatus === "Disabled" ? "Disabled" : "Pending",
                      ready: merchantApproved
                    },
                    { label: "API access", value: shift4ApiStatus, ready: apiReady },
                    {
                      label: "Webhook return",
                      value: shift4WebhookStatus,
                      ready: webhookConfigured
                    }
                  ]

                  return (
                    <>
                      <section className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-950">Provider setup status</p>
                            <p className="mt-0.5 text-xs text-gray-500">Current onboarding and return-path readiness.</p>
                          </div>
                          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                            liveRoutingEnabled
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : "border-amber-200 bg-amber-50 text-amber-700"
                          }`}>
                            {liveRoutingEnabled ? "Live ready" : "Setup pending"}
                          </span>
                        </div>

                        <div className="mt-3 grid gap-2 sm:grid-cols-3">
                          {statusRows.map((row) => (
                            <div key={row.label} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{row.label}</p>
                              <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${shift4StatusBadgeClass(row.ready)}`}>
                                {row.value}
                              </span>
                            </div>
                          ))}
                        </div>
                      </section>

                      <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4">
                        <label className="block">
                          <span className="text-sm font-semibold text-gray-900">Shift4 Account Reference</span>
                          <span className="mt-0.5 block text-xs leading-5 text-gray-500">
                            Use the merchant or application reference issued by Shift4.
                          </span>
                          <input
                            value={shift4AccountReference}
                            onChange={(event) => setShift4AccountReference(event.target.value)}
                            placeholder="Shift4 merchant/account reference"
                            className={lightningInputClass()}
                            autoComplete="off"
                          />
                        </label>

                        <label className="block">
                          <span className="text-sm font-semibold text-gray-900">API Status</span>
                          <span className="mt-0.5 block text-xs leading-5 text-gray-500">
                            Tracks whether Shift4 has issued sandbox or live processing access.
                          </span>
                          <select
                            value={shift4ApiStatus}
                            onChange={(event) => setShift4ApiStatus(event.target.value)}
                            className={lightningInputClass()}
                          >
                            <option>Pending approval</option>
                            <option>Sandbox ready</option>
                            <option>Live ready</option>
                            <option>Disabled</option>
                          </select>
                        </label>

                        <label className="block">
                          <span className="text-sm font-semibold text-gray-900">Webhook Status</span>
                          <span className="mt-0.5 block text-xs leading-5 text-gray-500">
                            Used to receive Shift4 approval, denial, payment, and settlement updates.
                          </span>
                          <select
                            value={shift4WebhookStatus}
                            onChange={(event) => setShift4WebhookStatus(event.target.value)}
                            className={lightningInputClass()}
                          >
                            <option>Not configured</option>
                            <option>Pending</option>
                            <option>Configured</option>
                            <option>Verified</option>
                          </select>
                        </label>

                        <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold text-gray-900">Approval return</span>
                            <span className="rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                              Automatic
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-gray-600">
                            Approval and denial updates will return to PineTree through the configured backend flow.
                          </p>
                        </div>

                        <label className="block">
                          <span className="text-sm font-semibold text-gray-900">Notes</span>
                          <textarea
                            value={shift4Notes}
                            onChange={(event) => setShift4Notes(event.target.value)}
                            placeholder="Non-sensitive setup notes"
                            rows={3}
                            className={lightningInputClass()}
                          />
                        </label>
                      </section>

                      <section className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4">
                        <p className="text-sm font-semibold text-gray-950">Setup checklist</p>
                        <div className="mt-3 space-y-2">
                          <Shift4ChecklistRow label="PineTree provider card ready" ready readyLabel="Ready" />
                          <Shift4ChecklistRow label="Backend return path prepared" ready readyLabel="Prepared" />
                          <Shift4ChecklistRow label="Shift4 merchant approval" ready={merchantApproved} />
                          <Shift4ChecklistRow label="API credentials issued" ready={apiReady} />
                          <Shift4ChecklistRow label="Webhook verified" ready={webhookVerified} />
                          <Shift4ChecklistRow label="Live routing enabled" ready={liveRoutingEnabled} />
                        </div>
                      </section>
                    </>
                  )
                })()}
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
                          onClick={() => selectWalletType(wt)}
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
                          onClick={() => selectWalletType(wt)}
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

                {/* Wallet address review */}
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <label className="block">
                    <span className="text-sm font-semibold text-gray-950">Wallet address</span>
                    <span className="mt-1 block text-xs leading-5 text-gray-500">
                      Review the connected wallet address, or paste an address manually before saving.
                    </span>
                    <input
                      value={inputValue}
                      onChange={(e) => {
                        const nextValue = e.target.value
                        setInputValue(nextValue)
                        if (connectedWalletAddress && nextValue.trim() !== connectedWalletAddress.trim()) {
                          setConnectedWalletAddress(null)
                          setWalletSessionStatus(null)
                        }
                      }}
                      placeholder={activeProvider === "solana" ? "Solana wallet address" : "Base wallet address (0x...)"}
                      className="mt-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 outline-none focus:border-[#0052FF] focus:ring-4 focus:ring-blue-50"
                    />
                  </label>

                  {connectedWalletAddress && (
                    <p className="mt-2 text-xs font-semibold text-[#0052FF]">
                      Wallet connected: {formatCredentialPart(connectedWalletAddress, 6, 4)}
                    </p>
                  )}
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Setup options
                  </p>
                  {!selectedWalletType && (
                    <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                      Choose a wallet to generate the setup QR.
                    </p>
                  )}
                  {selectedWalletType && (!walletSessionId || !walletQrCode) && (
                    <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
                      Preparing setup QR...
                    </p>
                  )}
                </div>

                {/* Primary — scan QR with mobile wallet */}
                {selectedWalletType && walletSessionId && walletQrCode && (
                  <div className="rounded-xl border border-[#0052FF]/15 bg-[#0052FF]/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-950">Scan QR with mobile wallet</p>
                        <p className="mt-1 text-sm leading-5 text-gray-600">
                          Scan this QR from your selected wallet to connect and approve.
                        </p>
                      </div>
                      {walletSessionStatus === "pending" && (
                        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0052FF] shadow-sm ring-1 ring-blue-100">
                          Waiting
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex flex-col items-center gap-3 rounded-lg bg-white/80 p-3">
                        <Image
                          src={walletQrCode}
                          alt="Wallet setup QR code"
                          width={208}
                          height={208}
                          className="h-52 w-52 rounded-lg bg-white p-2 shadow-sm"
                          unoptimized
                        />
                        {walletSessionStatus === "pending" && (
                          <p className="text-center text-xs text-gray-600">
                            Waiting for mobile wallet approval...
                          </p>
                        )}
                        {walletSessionStatus === "connected" && (
                          <p className="text-center text-xs font-semibold text-[#0052FF]">
                            Mobile wallet connected. Review and save below.
                          </p>
                        )}
                        {walletMobileDeeplink && (
                          <a
                            href={walletMobileDeeplink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-semibold text-blue-600 underline"
                          >
                            Open wallet manually
                          </a>
                        )}
                      </div>
                  </div>
                )}

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

                  {(showMobileConnect || walletSessionStatus === "connected") && (
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
                    onClick={connectWalletOnThisDevice}
                    className="mt-3 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={loading || !selectedWalletType}
                  >
                    {loading ? "Connecting..." : "Connect on This Device"}
                  </button>
                </div>

              </div>
            )}

            {activeProvider !== "solana" &&
              activeProvider !== "base" &&
              activeProvider !== "shift4" &&
              activeProvider !== "lightning" && (
                <input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={
                    activeProvider === "coinbase"
                      ? "Enter Coinbase API Key"
                      : "Enter Wallet Address"
                  }
                  className="w-full border border-gray-300 rounded p-2 mb-4 text-black bg-white"
                />
              )}

            {activeProvider !== "lightning" && (
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <button
                onClick={closeProviderModal}
                className={`${activeProvider === "shift4" ? secondaryButtonClass() : "px-3 py-1.5 text-sm border rounded bg-white text-black"} w-full sm:w-auto`}
              >
                Cancel
              </button>

              <button
                onClick={() => saveProvider(activeProvider)}
                disabled={loading}
                className={`${activeProvider === "shift4" ? primaryButtonClass() : "px-3 py-1.5 text-sm bg-blue-600 text-white rounded"} w-full sm:w-auto`}
              >
                {loading
                  ? "Saving..."
                  : activeProvider === "shift4"
                    ? "Save Setup"
                    : "Save Wallet"}
              </button>
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}


