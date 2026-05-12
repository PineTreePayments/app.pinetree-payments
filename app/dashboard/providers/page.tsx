"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import ToggleSwitch from "@/components/ui/ToggleSwitch"
import { toast } from "sonner"

type ProviderCredentials = {
  api_key?: string
  wallet?: string
  wallet_type?: string | null
  speed_account_id?: string
  lightning_address?: string
  payment_address_id?: string
  lightning_address_verified?: boolean
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

const SPEED_LINKS = {
  signup: "https://app.tryspeed.com/signup",
  dashboard: "https://app.tryspeed.com",
  apiKeys: "https://app.tryspeed.com/developer/api-keys",
  associatedAccounts: "https://app.tryspeed.com/settings/associated-accounts",
  paymentAddresses: "https://app.tryspeed.com/payment-addresses"
} as const

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

function lightningCapabilitiesPass(provider?: ProviderRecord) {
  const capabilities = provider?.capabilities
  return Boolean(
    capabilities?.supportsLightningInvoice &&
    capabilities?.supportsFeeAtPaymentTime &&
    capabilities?.supportsSplitSettlement &&
    capabilities?.supportsWebhookConfirmation
  )
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
  const [lightningSpeedAccountId, setLightningSpeedAccountId] = useState("")
  const [lightningAddress, setLightningAddress] = useState("")
  const [lightningPaymentAddressId, setLightningPaymentAddressId] = useState("")
  const [lightningSetupStep, setLightningSetupStep] = useState<1 | 2 | 3>(1)
  const [loading, setLoading] = useState(false)

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
    setLightningSpeedAccountId("")
    setLightningAddress("")
    setLightningPaymentAddressId("")
    setLightningSetupStep(1)
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
        const res = await fetch(
          `/api/wallet-connect-session?session_id=${encodeURIComponent(walletSessionId)}`,
          { cache: "no-store" }
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
      if (p.dashboard_status === "connected") return "Connected"
      return "Not configured"
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

    if ((provider === "solana" || provider === "base") && existingWallet) {
      toast.success("Wallet already connected")
      return
    }

    if (provider === "lightning") {
      setInputValue("")
      setLightningSpeedAccountId(String(p?.credentials?.speed_account_id || ""))
      setLightningAddress(String(p?.credentials?.lightning_address || ""))
      setLightningPaymentAddressId(String(p?.credentials?.payment_address_id || ""))
      setLightningSetupStep(1)
    } else if (p?.credentials?.api_key) {
      setInputValue(p.credentials.api_key)
      setLightningSpeedAccountId("")
      setLightningAddress("")
      setLightningPaymentAddressId("")
    } else if (p?.credentials?.wallet) {
      setInputValue(p.credentials.wallet)
      setLightningSpeedAccountId("")
      setLightningAddress("")
      setLightningPaymentAddressId("")
    } else if (existingWallet?.wallet_address) {
      setInputValue(existingWallet.wallet_address)
      setLightningSpeedAccountId("")
      setLightningAddress("")
      setLightningPaymentAddressId("")
    } else {
      setInputValue("")
      setLightningSpeedAccountId("")
      setLightningAddress("")
      setLightningPaymentAddressId("")
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

    setActiveProvider(provider)
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
        walletAddress = lightningSpeedAccountId.trim()
        if (!walletAddress) {
          toast.error("Speed Account ID is required")
          return
        }

        if (!lightningAddress.trim()) {
          toast.error("BTC Lightning Address is required (e.g. username@tryspeed.com)")
          return
        }

        if (!lightningPaymentAddressId.trim()) {
          toast.error("Payment Address ID is required (e.g. pa_...)")
          return
        }
      }

      const payload = await callProvidersApi("POST", {
        action: "saveProvider",
        provider,
        walletAddress: provider === "solana" || provider === "base" ? walletAddress : undefined,
        walletType:
          provider === "solana" || provider === "base"
            ? walletType
            : provider === "lightning"
              ? lightningPaymentAddressId.trim()
              : undefined,
        apiKey: provider === "coinbase" || provider === "shift4" ? walletAddress : undefined,
        lightningAddress: provider === "lightning" ? lightningAddress.trim() : undefined,
        ...(provider === "lightning" ? { walletAddress } : {})
      })

      applyProvidersPayload(payload)

      if (walletSessionId) {
        await fetch("/api/wallet-connect-session", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ session_id: walletSessionId }),
        })
      }

      setActiveProvider(null)
      setInputValue("")
      setLightningSpeedAccountId("")
      setLightningAddress("")
      setLightningPaymentAddressId("")
      setLightningSetupStep(1)
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

    if (value && provider === "lightning" && getStatus(provider) !== "Connected") {
      toast.error("Connect Speed before enabling Bitcoin Lightning.")
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

  function statusClass(status: string) {
    if (status === "Connected") return "border-blue-200 bg-blue-50 text-blue-700"
    if (status === "Needs verification") return "border-amber-200 bg-amber-50 text-amber-800"
    if (status === "Provider unavailable") return "border-red-200 bg-red-50 text-red-700"
    return "border-gray-200 bg-gray-50 text-gray-600"
  }

  function formatCredentialPart(value: string, leading = 8, trailing = 4) {
    const trimmed = value.trim()
    if (trimmed.length <= leading + trailing + 3) return trimmed
    return `${trimmed.slice(0, leading)}...${trimmed.slice(-trailing)}`
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
    const lightningAccountId = String(p?.credentials?.speed_account_id || "")
    const walletType = p?.credentials?.wallet_type || wallet?.wallet_type || wallet?.asset
    const walletLabel = formatWalletLabel(provider, walletType, wallet?.asset || null)
    const connectedCredentialLine = walletValue
      ? provider === "solana" || provider === "base"
        ? `${walletLabel} • ${formatCredentialPart(walletValue, 6, 4)}`
        : `${name} • ${formatCredentialPart(walletValue, 6, 4)}`
      : provider === "lightning" && lightningAccountId
        ? `Speed • ${formatCredentialPart(lightningAccountId)}`
        : ""
    const primaryActionLabel = connected
      ? "Disconnect"
      : provider === "lightning"
        ? "Set Up"
        : "Connect"
    const lightningCredentialLine =
      provider === "lightning" && lightningAccountId
        ? `Speed • ${formatCredentialPart(lightningAccountId)}`
        : ""

    return (
      <div className="flex min-h-[248px] flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 text-base font-semibold leading-tight text-gray-950">{name}</h2>
          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none sm:text-xs ${statusClass(status)}`}>
            {status}
          </span>
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
                title={`Speed • ${lightningAccountId}`}
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
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-black mb-8">Providers</h1>

      <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm mb-8">
        <h2 className="text-lg font-semibold mb-4 text-black">PineTree Engine Settings</h2>

        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="font-medium text-black">Smart Routing</p>
              <p className="text-sm text-black">Automatically select the best payment provider</p>
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

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="font-medium text-black">Auto Convert to Fiat</p>
              <p className="text-sm text-black">Convert payments routed through Shift4 to fiat</p>
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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

        <ProviderCard
          name="Bitcoin Lightning"
          provider="lightning"
          networks="Bitcoin Lightning"
          settlement="Lightning account"
          description="Accept Lightning wallet payments."
        />
      </div>

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
              <h2 className="text-lg font-semibold text-black">
                {activeProvider === "solana"
                  ? "Connect Wallet to Solana Pay"
                  : activeProvider === "base"
                    ? "Connect Wallet to Base Pay"
                    : activeProvider === "lightning"
                      ? "Set Up Bitcoin Lightning"
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
              <div className="mb-2">
                <div className="mb-5 grid grid-cols-3 gap-2">
                  {[1, 2, 3].map((step) => (
                    <div
                      key={step}
                      className={`h-1.5 rounded-full ${
                        lightningSetupStep >= step ? "bg-blue-600" : "bg-gray-200"
                      }`}
                    />
                  ))}
                </div>

                <div className="rounded-2xl border border-gray-200 bg-gray-50/80 p-4 shadow-inner sm:p-5">
                  {lightningSetupStep === 1 && (
                    <div className="space-y-5">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                          Step 1 of 3
                        </p>
                        <h3 className="mt-2 text-xl font-semibold leading-tight text-gray-950">
                          Open Speed
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-gray-600">
                          Create or open your Speed account. Speed handles your Lightning account and verification.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <a href={SPEED_LINKS.signup} target="_blank" rel="noopener noreferrer" className={actionButtonClass()}>
                          Create Speed Account
                        </a>
                        <a href={SPEED_LINKS.dashboard} target="_blank" rel="noopener noreferrer" className={actionButtonClass()}>
                          Open Speed Dashboard
                        </a>
                      </div>

                      <button
                        onClick={() => setLightningSetupStep(2)}
                        className={`${primaryButtonClass()} w-full`}
                      >
                        I have a Speed account
                      </button>

                      <button
                        type="button"
                        onClick={closeProviderModal}
                        className={`${secondaryButtonClass()} w-full`}
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {lightningSetupStep === 2 && (
                    <div className="space-y-5">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                          Step 2 of 3
                        </p>
                        <h3 className="mt-2 text-xl font-semibold leading-tight text-gray-950">
                          Copy Account ID
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-gray-600">
                          Open Associated Accounts and copy your Account ID.
                        </p>
                      </div>

                      <label className="block">
                        <span className="text-sm font-semibold text-gray-900">Speed Account ID</span>
                        <input
                          value={lightningSpeedAccountId}
                          onChange={(e) => setLightningSpeedAccountId(e.target.value)}
                          placeholder="Speed Account ID"
                          className={lightningInputClass()}
                        />
                      </label>

                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-gray-500">Copy the Account ID from your Associated Accounts page.</p>
                        <a href={SPEED_LINKS.associatedAccounts} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
                          Open Associated Accounts
                        </a>
                      </div>

                      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                        <button
                          onClick={() => setLightningSetupStep(1)}
                          className={`${secondaryButtonClass()} w-full sm:w-auto`}
                        >
                          Back
                        </button>
                        <button
                          onClick={() => setLightningSetupStep(3)}
                          className={`${primaryButtonClass()} w-full sm:w-auto`}
                        >
                          Continue
                        </button>
                      </div>
                    </div>
                  )}

                  {lightningSetupStep === 3 && (
                    <div className="space-y-5">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                          Step 3 of 3
                        </p>
                        <h3 className="mt-2 text-xl font-semibold leading-tight text-gray-950">
                          Create BTC Payment Address
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-gray-600">
                          Create a BTC Payment Address in Speed, then paste the username@tryspeed.com address and Payment Address ID here.
                        </p>
                      </div>

                      <div className="space-y-4">
                        <label className="block">
                          <span className="text-sm font-semibold text-gray-900">BTC Payment Address</span>
                          <input
                            value={lightningAddress}
                            onChange={(e) => setLightningAddress(e.target.value)}
                            placeholder="username@tryspeed.com"
                            className={lightningInputClass()}
                          />
                        </label>

                        <label className="block">
                          <span className="text-sm font-semibold text-gray-900">Payment Address ID</span>
                          <input
                            value={lightningPaymentAddressId}
                            onChange={(e) => setLightningPaymentAddressId(e.target.value)}
                            placeholder="pa_..."
                            className={lightningInputClass()}
                          />
                        </label>
                      </div>

                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-gray-500">Choose BTC, keep tryspeed.com as the domain, enter a username, then create the address. Speed shows both on the Payment Address details page.</p>
                        <a href={SPEED_LINKS.paymentAddresses} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
                          Open Payment Addresses
                        </a>
                      </div>

                      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                        <div className="flex flex-col-reverse gap-2 sm:flex-row">
                          <button
                            onClick={closeProviderModal}
                            className={`${secondaryButtonClass()} w-full sm:w-auto`}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => setLightningSetupStep(2)}
                            className={`${secondaryButtonClass()} w-full sm:w-auto`}
                          >
                            Back
                          </button>
                        </div>
                        <button
                          onClick={() => saveProvider("lightning")}
                          disabled={loading}
                          className={`${primaryButtonClass()} w-full sm:w-auto`}
                        >
                          {loading ? "Verifying..." : "Verify and Enable Bitcoin Lightning"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {(activeProvider === "solana" || activeProvider === "base") && (
              <p className="text-sm text-black mb-4">
                Choose a wallet, open it on mobile, or paste your address
              </p>
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
                {activeProvider === "solana" && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        setSelectedWalletType("PHANTOM")
                        setShowMobileConnect(false)
                      }}
                      className={optionButtonClass(selectedWalletType === "PHANTOM")}
                    >
                      Phantom
                    </button>

                    <button
                      onClick={() => {
                        setSelectedWalletType("SOLFLARE")
                        setShowMobileConnect(false)
                      }}
                      className={optionButtonClass(selectedWalletType === "SOLFLARE")}
                    >
                      Solflare
                    </button>
                  </div>
                )}

                {activeProvider === "base" && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      onClick={() => {
                        setSelectedWalletType("BASEAPP")
                        setShowMobileConnect(false)
                      }}
                      className={optionButtonClass(selectedWalletType === "BASEAPP")}
                    >
                      Base Wallet
                    </button>

                    <button
                      onClick={() => {
                        setSelectedWalletType("METAMASK")
                        setShowMobileConnect(false)
                      }}
                      className={optionButtonClass(selectedWalletType === "METAMASK")}
                    >
                      MetaMask
                    </button>

                    <button
                      onClick={() => {
                        setSelectedWalletType("TRUST")
                        setShowMobileConnect(false)
                      }}
                      className={optionButtonClass(selectedWalletType === "TRUST")}
                    >
                      Trust Wallet
                    </button>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => saveProvider(activeProvider)}
                    className={actionButtonClass() + " flex-1"}
                  >
                    Connect on This Device
                  </button>

                  <button
                    onClick={async () => {
                      if (activeProvider === "solana") {
                        await openSolanaMobileWallet(selectedWalletType)
                      } else {
                        await openBaseMobileWallet()
                      }
                    }}
                    className={actionButtonClass()}
                  >
                    Open Mobile Wallet
                  </button>
                </div>

                {showMobileConnect && (
                  <div className="border rounded-lg p-4 bg-white flex flex-col items-center gap-3">
                    {walletSessionStatus === "pending" && (
                      <p className="text-xs text-black">
                        Waiting for mobile wallet approval...
                      </p>
                    )}
                    {walletSessionStatus === "connected" && (
                      <p className="text-xs text-blue-600">
                        Mobile wallet connected. Review and save.
                      </p>
                    )}
        {activeProvider === "base" && walletMobileDeeplink ? (
          <a
            href={walletMobileDeeplink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 underline"
          >
            Open wallet manually
          </a>
        ) : null}
                  </div>
                )}

                <input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={
                    activeProvider === "solana"
                      ? "Paste Solana wallet"
                      : "Paste Base wallet"
                  }
                  className="w-full border border-gray-300 rounded p-2 text-black bg-white"
                />
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
