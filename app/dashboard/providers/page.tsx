"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Image from "next/image"
import { supabase } from "@/lib/supabaseClient"
import ToggleSwitch from "@/components/ui/ToggleSwitch"
import { toast } from "sonner"
import QRCode from "qrcode"

type ProviderCredentials = {
  api_key?: string
  wallet?: string
  wallet_type?: string | null
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

declare global {
  interface Window {
    solana?: SolanaProviderLike
    ethereum?: Eip1193ProviderLike
  }
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
  const eth = window.ethereum
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
  const [loading, setLoading] = useState(false)

  const [smartRouting, setSmartRouting] = useState(false)
  const [autoConversion, setAutoConversion] = useState(false)

  const [selectedWalletType, setSelectedWalletType] = useState<string | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)

  const [walletSessionId, setWalletSessionId] = useState<string | null>(null)
  const [walletSessionStatus, setWalletSessionStatus] = useState<string | null>(null)

  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const didToastSyncRef = useRef(false)

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
    if (!walletSessionId || !activeProvider || !showQr) return

    if (pollerRef.current) clearInterval(pollerRef.current)

    pollerRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/wallet-connect-session?session_id=${encodeURIComponent(walletSessionId)}`,
          { cache: "no-store" }
        )

        if (!res.ok) return

        const session: WalletConnectSession | null = await res.json()
        if (!session) return

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

          setShowQr(false)

          await loadAll()

          if (pollerRef.current) {
            clearInterval(pollerRef.current)
            pollerRef.current = null
          }
        }
      } catch (err) {
        console.error("Polling session failed:", err)
      }
    }, 1200)

    return () => {
      if (pollerRef.current) clearInterval(pollerRef.current)
    }
  }, [walletSessionId, activeProvider, showQr, loadAll])

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
    const wallet = getWallet(provider)

    if ((provider === "solana" || provider === "base") && wallet) return "Connected"

    const p = getProvider(provider)
    if (!p) return "Not Connected"

    if (p.status === "connected" || p.status === "active") return "Connected"

    return "Not Connected"
  }

  function isEnabled(provider: string) {
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
    let provider = window.solana

    if (!provider) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      provider = window.solana
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

  async function generateSolanaQR(walletType?: string | null) {
    try {
      console.log("SOLANA QR START", walletType)

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

      const qr = await QRCode.toDataURL(deeplink)

      console.log("QR GENERATED")

      setQrCode(qr)
      setShowQr(true)
    } catch (err) {
      console.error("🔥 SOLANA QR ERROR:", err)
      toast.error("Failed to generate Solana QR")
    }
  }

  async function generateBaseQR() {
    try {
      console.log("BASE QR START", selectedWalletType)

      if (!selectedWalletType) {
        toast.error("Select wallet first")
        return
      }

      const sessionId = await createWalletConnectSession("base", selectedWalletType)
      console.log("SESSION CREATED:", sessionId)

      const returnUrl = buildMobileBridgeUrl("base", selectedWalletType, sessionId)

      let deeplink = ""

      if (selectedWalletType === "METAMASK") {
        const dapp = returnUrl.replace(/^https?:\/\//, "")
        deeplink = `https://link.metamask.io/dapp/${dapp}`
      } else if (selectedWalletType === "TRUST") {
        deeplink = `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(returnUrl)}`
      } else if (selectedWalletType === "BASEAPP") {
        deeplink = `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(returnUrl)}`
      }

      console.log("DEEPLINK:", deeplink)

      const qr = await QRCode.toDataURL(deeplink)

      console.log("QR GENERATED")

      setQrCode(qr)
      setShowQr(true)
    } catch (err) {
      console.error("🔥 BASE QR ERROR:", err)
      toast.error("Failed to generate Base QR")
    }
  }

  function openProvider(provider: string) {
    const existingWallet = getWallet(provider)
    const p = getProvider(provider)

    if ((provider === "solana" || provider === "base") && existingWallet) {
      toast.success("Wallet already connected")
      return
    }

    if (p?.credentials?.api_key) {
      setInputValue(p.credentials.api_key)
    } else if (p?.credentials?.wallet) {
      setInputValue(p.credentials.wallet)
    } else if (existingWallet?.wallet_address) {
      setInputValue(existingWallet.wallet_address)
    } else {
      setInputValue("")
    }

    setQrCode(null)
    setShowQr(false)
    setSelectedWalletType(null)
    setWalletSessionId(null)
    setWalletSessionStatus(null)
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
      setQrCode(null)
      setShowQr(false)
      setSelectedWalletType(null)
      setWalletSessionId(null)
      setWalletSessionStatus(null)
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
    return "px-3 py-2 rounded text-sm border border-blue-600 text-blue-600 bg-white hover:bg-blue-50 transition"
  }

  function statusClass(status: string) {
    return status === "Connected" ? "text-blue-600" : "text-black"
  }

  function ProviderCard({
    name,
    provider,
    description,
  }: {
    name: string
    provider: string
    description: string[]
  }) {
    const status = getStatus(provider)
    const connected = status === "Connected"
    const enabled = isEnabled(provider)
    const p = getProvider(provider)
    const wallet = getWallet(provider)
    const walletValue = p?.credentials?.wallet || wallet?.wallet_address
    const walletType = p?.credentials?.wallet_type || wallet?.wallet_type || wallet?.asset
    const walletLabel = formatWalletLabel(provider, walletType, wallet?.asset || null)

    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm min-h-[240px]">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-black">{name}</h2>
          <span className={`text-sm ${statusClass(status)}`}>{status}</span>
        </div>

        <div className="text-black space-y-1 mb-6">
          {description.map((d, i) => (
            <p key={i}>{d}</p>
          ))}

          {walletValue && (
            <p className="text-sm text-black mt-3 font-medium">
              {provider === "solana" || provider === "base"
                ? `${walletLabel} • ${walletValue.slice(0, 6)}...${walletValue.slice(-4)}`
                : `${walletValue.slice(0, 6)}...${walletValue.slice(-4)}`}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between mt-auto">
          <div className="flex gap-2">
            {connected ? (
              <button
                onClick={() => disconnect(provider)}
                className="text-sm bg-red-500 text-white px-3 py-1.5 rounded"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={() => openProvider(provider)}
                className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded"
              >
                Connect
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-black">Enabled</span>
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

  const shift4Connected = getStatus("shift4") === "Connected"
  const connectedAndEnabledProvidersCount = getConnectedAndEnabledProvidersCount(providers)

  return (
    <div>
      <h1 className="text-2xl font-semibold text-black mb-8">Providers</h1>

      <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm mb-8">
        <h2 className="text-lg font-semibold mb-4 text-black">PineTree Engine Settings</h2>

        <div className="space-y-4">
          <div className="flex justify-between items-center">
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

          <div className="flex justify-between items-center">
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
          description={[
            "Networks: Base, Ethereum",
            "Settlement: Coinbase account",
            "Connect your Coinbase Business account",
          ]}
        />

        <ProviderCard
          name="Solana Pay"
          provider="solana"
          description={[
            "Network: Solana",
            "Settlement: Direct wallet",
            "Use Phantom or Solflare",
          ]}
        />

        <ProviderCard
          name="Shift4"
          provider="shift4"
          description={[
            "Crypto payments via PineTree",
            "Settlement: Crypto or Fiat",
            "Optional auto conversion",
          ]}
        />

        <ProviderCard
          name="Base Pay"
          provider="base"
          description={[
            "Network: Base",
            "Settlement: Direct wallet",
            "Use Base Wallet, MetaMask, or Trust Wallet",
          ]}
        />
      </div>

      {activeProvider && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w-[90vw] max-w-[520px] shadow-lg">
            <h2 className="text-lg font-semibold mb-2 text-black">
              {activeProvider === "solana"
                ? "Connect Wallet to Solana Pay"
                : activeProvider === "base"
                  ? "Connect Wallet to Base Pay"
                  : `Connect ${activeProvider}`}
            </h2>

            {(activeProvider === "solana" || activeProvider === "base") && (
              <p className="text-sm text-black mb-4">
                Choose a wallet, scan with mobile, or paste your address
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
                        setQrCode(null)
                        setShowQr(false)
                      }}
                      className={optionButtonClass(selectedWalletType === "PHANTOM")}
                    >
                      Phantom
                    </button>

                    <button
                      onClick={() => {
                        setSelectedWalletType("SOLFLARE")
                        setQrCode(null)
                        setShowQr(false)
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
                        setQrCode(null)
                        setShowQr(false)
                      }}
                      className={optionButtonClass(selectedWalletType === "BASEAPP")}
                    >
                      Base Wallet
                    </button>

                    <button
                      onClick={() => {
                        setSelectedWalletType("METAMASK")
                        setQrCode(null)
                        setShowQr(false)
                      }}
                      className={optionButtonClass(selectedWalletType === "METAMASK")}
                    >
                      MetaMask
                    </button>

                    <button
                      onClick={() => {
                        setSelectedWalletType("TRUST")
                        setQrCode(null)
                        setShowQr(false)
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
                        await generateSolanaQR(selectedWalletType)
                      } else {
                        await generateBaseQR()
                      }
                    }}
                    className={actionButtonClass()}
                  >
                    Scan with Mobile
                  </button>
                </div>

                {showQr && qrCode && (
                  <div className="border rounded-lg p-4 bg-white flex flex-col items-center gap-3">
                    <Image src={qrCode} alt="Wallet QR" width={208} height={208} className="w-52 h-52" />
                    {walletSessionStatus === "pending" && (
                      <p className="text-xs text-black">
                        Waiting for mobile wallet connection...
                      </p>
                    )}
                    {walletSessionStatus === "connected" && (
                      <p className="text-xs text-blue-600">
                        Mobile wallet connected. Review and save.
                      </p>
                    )}
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
              activeProvider !== "base" && (
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

            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setActiveProvider(null)
                  setInputValue("")
                  setQrCode(null)
                  setShowQr(false)
                  setSelectedWalletType(null)
                  setWalletSessionId(null)
                  setWalletSessionStatus(null)
                  didToastSyncRef.current = false

                  if (pollerRef.current) {
                    clearInterval(pollerRef.current)
                    pollerRef.current = null
                  }
                }}
                className="px-3 py-1.5 text-sm border rounded bg-white text-black"
              >
                Cancel
              </button>

              <button
                onClick={() => saveProvider(activeProvider)}
                disabled={loading}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded"
              >
                {loading ? "Saving..." : "Save Wallet"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}