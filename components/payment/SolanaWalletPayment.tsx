"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Button from "@/components/ui/Button"
import { PaymentStatusVisual } from "@/components/payment/PaymentStatusVisual"
import {
  buildPhantomWalletBrowserUrl,
  getDetectedSolanaWallets,
  getSolanaProviderPublicKey,
  getSolanaTransactionSignature,
  isMobileBrowser,
  type DetectedSolanaWallet,
  type SolanaBrowserProvider,
} from "@/lib/wallets/solana"

type SolanaAsset = "SOL" | "USDC"
type StepStatus = "done" | "active" | "upcoming"
type SolanaExecutionStage =
  | "idle"
  | "creating_payment"
  | "connecting_wallet"
  | "wallet_connected"
  | "confirm_payment"
  | "payment_submitted"
  | "detecting"
  | "confirmed"
  | "retryable_error"

type Props = {
  intentId?: string
  selectedAsset?: SolanaAsset
  paymentUrl?: string
  nativeAmount?: number
  usdAmount: number
  paymentId?: string
  paymentStatus?: string
  walletOptions?: Array<{ id: string; label: string; url?: string; href?: string }>
  onPaymentCreated?: (paymentId: string) => void
  onError?: (error: string) => void
  onExecutionStarted?: () => void
  initialError?: string
}

type PaymentData = {
  paymentId: string
  paymentUrl: string
}

type SolanaPayTransactionResponse = {
  transaction?: string
  error?: string
}

type WalletCatalogItem = {
  id: string
  name: string
  aliases?: string[]
  mobileDeepLink?: "phantom" | "solflare" | "trust" | "coinbase" | "okx"
  iconPath?: string
  installName?: string
  installUrl: string
}

type WalletPickerRow = WalletCatalogItem & {
  detectedWallet?: DetectedSolanaWallet
  available: boolean
  mobileOpenable: boolean
}

const TERMINAL_PAYMENT_STATUSES = new Set(["CONFIRMED", "FAILED", "INCOMPLETE", "EXPIRED", "CANCELED"])

const POPULAR_WALLETS: WalletCatalogItem[] = [
  { id: "phantom", name: "Phantom", mobileDeepLink: "phantom", iconPath: "/wallet-icons/phantom.svg", installUrl: "https://phantom.com/download" },
  { id: "solflare", name: "Solflare", mobileDeepLink: "solflare", iconPath: "/wallet-icons/solflare.svg", installUrl: "https://solflare.com/download" },
  { id: "backpack", name: "Backpack", iconPath: "/wallet-icons/backpack.png", installUrl: "https://backpack.app/download" },
  { id: "glow", name: "Glow", iconPath: "/wallet-icons/glow.png", installUrl: "https://glow.app" },
  { id: "trust-wallet", name: "Trust Wallet", aliases: ["trust"], mobileDeepLink: "trust", iconPath: "/wallet-icons/trust-wallet.svg", installUrl: "https://trustwallet.com/download" },
  { id: "coinbase-wallet", name: "Coinbase Wallet", aliases: ["coinbase"], mobileDeepLink: "coinbase", iconPath: "/wallet-icons/coinbase-wallet.svg", installUrl: "https://www.coinbase.com/wallet/downloads" },
  { id: "okx-wallet", name: "OKX Wallet", aliases: ["okx"], mobileDeepLink: "okx", iconPath: "/wallet-icons/okx-wallet.png", installUrl: "https://www.okx.com/web3" },
]

const MORE_WALLETS: WalletCatalogItem[] = [
  { id: "exodus", name: "Exodus", iconPath: "/wallet-icons/exodus.svg", installUrl: "https://www.exodus.com/download" },
  { id: "ledger", name: "Ledger", iconPath: "/wallet-icons/ledger.svg", installUrl: "https://www.ledger.com/ledger-live" },
  { id: "mathwallet", name: "MathWallet", aliases: ["math wallet"], iconPath: "/wallet-icons/mathwallet.svg", installUrl: "https://mathwallet.org" },
  { id: "tokenpocket", name: "TokenPocket", aliases: ["token pocket"], iconPath: "/wallet-icons/tokenpocket.svg", installUrl: "https://www.tokenpocket.pro" },
  { id: "torus", name: "Torus", iconPath: "/wallet-icons/torus.svg", installUrl: "https://tor.us" },
  { id: "clover", name: "Clover", iconPath: "/wallet-icons/clover.svg", installUrl: "https://clv.org" },
  { id: "coin98", name: "Coin98", iconPath: "/wallet-icons/coin98.svg", installUrl: "https://coin98.com/wallet" },
  { id: "safepal", name: "SafePal", aliases: ["safe pal"], iconPath: "/wallet-icons/safepal.png", installUrl: "https://www.safepal.com/download" },
  { id: "bitget-wallet", name: "Bitget Wallet", aliases: ["bitget"], iconPath: "/wallet-icons/bitget-wallet.svg", installUrl: "https://web3.bitget.com" },
  { id: "brave-wallet", name: "Brave Wallet", aliases: ["brave"], iconPath: "/wallet-icons/brave-wallet.svg", installUrl: "https://brave.com/wallet" },
  { id: "nightly", name: "Nightly", iconPath: "/wallet-icons/nightly.svg", installUrl: "https://nightly.app/download" },
  { id: "ultimate", name: "Ultimate", iconPath: "/wallet-icons/ultimate.png", installUrl: "https://ultimate.app" },
  { id: "salmon", name: "Salmon", iconPath: "/wallet-icons/salmon.svg", installUrl: "https://www.salmonwallet.io" },
  { id: "slope", name: "Slope", iconPath: "/wallet-icons/slope.svg", installUrl: "https://slope.finance" },
  { id: "sollet", name: "Sollet", iconPath: "/wallet-icons/sollet.svg", installUrl: "https://www.sollet.io" },
]

const STAGE_NUM: Record<SolanaExecutionStage, number> = {
  idle: 0,
  creating_payment: 1,
  connecting_wallet: 2,
  wallet_connected: 3,
  confirm_payment: 4,
  payment_submitted: 5,
  detecting: 6,
  confirmed: 7,
  retryable_error: -1,
}

function parsePaymentIdFromUrl(paymentUrl?: string): string {
  const raw = String(paymentUrl || "").trim()
  if (!raw) return ""
  try {
    const url = new URL(raw)
    return String(url.searchParams.get("paymentId") || "").trim()
  } catch {
    return ""
  }
}

function normalizeTerminalStatus(status?: string): string {
  const normalized = String(status || "").trim().toUpperCase()
  if (normalized === "CANCELLED") return "CANCELED"
  return TERMINAL_PAYMENT_STATUSES.has(normalized) ? normalized : ""
}

function getStepStatus(currentStage: SolanaExecutionStage, doneAt: SolanaExecutionStage, activeAt: SolanaExecutionStage[]): StepStatus {
  const current = STAGE_NUM[currentStage]
  if (current >= STAGE_NUM[doneAt]) return "done"
  if (activeAt.some((stage) => STAGE_NUM[stage] === current)) return "active"
  return "upcoming"
}

function normalizeWalletName(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function walletMatchesCatalog(wallet: DetectedSolanaWallet, item: WalletCatalogItem): boolean {
  const detected = normalizeWalletName(wallet.name)
  const names = [item.name, ...(item.aliases || [])].map(normalizeWalletName)
  return names.some((name) => detected === name || detected.includes(name) || name.includes(detected))
}

function buildMobileWalletBrowserUrl(wallet: WalletCatalogItem, targetUrl: string): string {
  const encodedTarget = encodeURIComponent(targetUrl)
  if (wallet.mobileDeepLink === "phantom") return targetUrl
  if (wallet.mobileDeepLink === "trust") return `https://link.trustwallet.com/open_url?coin_id=501&url=${encodedTarget}`
  if (wallet.mobileDeepLink === "coinbase") return `https://go.cb-w.com/dapp?cb_url=${encodedTarget}`
  if (wallet.mobileDeepLink === "okx") return `okx://wallet/dapp/url?dappUrl=${encodedTarget}`

  const scheme = wallet.id
    .replace(/-wallet$/, "")
    .replace(/[^a-z0-9-]/gi, "")
    .toLowerCase()

  const schemeMap: Record<string, string> = {
    backpack: `backpack://browse?url=${encodedTarget}`,
    glow: `glow://browse/${encodedTarget}`,
    exodus: `exodus://dapp?url=${encodedTarget}`,
    ledger: `ledgerlive://discover?url=${encodedTarget}`,
    mathwallet: `mathwallet://dapp?url=${encodedTarget}`,
    tokenpocket: `tpoutside://open?url=${encodedTarget}`,
    torus: `torus://open?url=${encodedTarget}`,
    clover: `clover://dapp?url=${encodedTarget}`,
    coin98: `coin98://browser?url=${encodedTarget}`,
    safepal: `safepalwallet://browser?url=${encodedTarget}`,
    bitget: `bitget://wallet/dapp?url=${encodedTarget}`,
    brave: targetUrl,
    nightly: `nightly://browse?url=${encodedTarget}`,
    ultimate: `ultimate://dapp?url=${encodedTarget}`,
    salmon: `salmon://browse?url=${encodedTarget}`,
    slope: `slope://browse?url=${encodedTarget}`,
    sollet: `sollet://browse?url=${encodedTarget}`,
  }

  return schemeMap[scheme] || `${scheme}://open?url=${encodedTarget}`
}

function getMobilePlatform(): "ios" | "android" | "desktop" {
  if (typeof navigator === "undefined") return "desktop"
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios"
  if (/Android/i.test(ua)) return "android"
  return "desktop"
}

function buildInstallUrl(wallet: WalletCatalogItem): string {
  const query = encodeURIComponent(wallet.installName || wallet.name)
  const platform = getMobilePlatform()
  if (platform === "ios") return `https://apps.apple.com/us/search?term=${query}`
  if (platform === "android") return `https://play.google.com/store/search?q=${query}&c=apps`
  return wallet.installUrl
}

export default function SolanaWalletPayment({
  intentId,
  selectedAsset = "SOL",
  paymentUrl: directPaymentUrl,
  usdAmount,
  nativeAmount,
  paymentId: directPaymentId,
  paymentStatus,
  onPaymentCreated,
  onError,
  onExecutionStarted,
  initialError = "",
}: Props) {
  const [wallets, setWallets] = useState<DetectedSolanaWallet[]>([])
  const [selectedWalletId, setSelectedWalletId] = useState("")
  const [activeWalletName, setActiveWalletName] = useState("")
  const [walletPickerOpen, setWalletPickerOpen] = useState(false)
  const [walletSearch, setWalletSearch] = useState("")
  const [pendingWalletId, setPendingWalletId] = useState("")
  const [execStage, setExecStage] = useState<SolanaExecutionStage>("idle")
  const [error, setError] = useState(initialError)
  const [paymentData, setPaymentData] = useState<PaymentData | null>(() => {
    const paymentId = String(directPaymentId || parsePaymentIdFromUrl(directPaymentUrl)).trim()
    const paymentUrl = String(directPaymentUrl || "").trim()
    return paymentId || paymentUrl ? { paymentId, paymentUrl } : null
  })

  const terminalStatus = normalizeTerminalStatus(paymentStatus)
  const isMobile = useMemo(() => isMobileBrowser(), [])
  const refreshWallets = useCallback(() => {
    const detected = getDetectedSolanaWallets()
    setWallets(detected)
    setSelectedWalletId((current) => {
      if (current && detected.some((wallet) => wallet.id === current)) return current
      return ""
    })
  }, [])

  useEffect(() => {
    refreshWallets()
    window.setTimeout(refreshWallets, 400)
    window.addEventListener("focus", refreshWallets)
    return () => window.removeEventListener("focus", refreshWallets)
  }, [refreshWallets])

  useEffect(() => {
    setError(initialError)
  }, [initialError])

  useEffect(() => {
    if (terminalStatus === "CONFIRMED") setExecStage("confirmed")
  }, [terminalStatus])

  useEffect(() => {
    const normalized = String(paymentStatus || "").toUpperCase()
    if (normalized === "PROCESSING" && execStage === "idle") {
      setExecStage("detecting")
    }
  }, [execStage, paymentStatus])

  const walletCatalog = useMemo(() => {
    const catalogIds = new Set([...POPULAR_WALLETS, ...MORE_WALLETS].map((wallet) => wallet.id))
    const extraDetectedWallets = wallets
      .filter((wallet) => ![...POPULAR_WALLETS, ...MORE_WALLETS].some((item) => walletMatchesCatalog(wallet, item)))
      .map((wallet): WalletCatalogItem => ({
        id: `detected-${wallet.id}`,
        name: wallet.name,
        iconPath: "/wallet-icons/solana-wallet.svg",
        installUrl: "https://solana.com/ecosystem/explore?categories=wallet",
      }))

    return {
      popular: POPULAR_WALLETS,
      more: [
        ...MORE_WALLETS,
        ...extraDetectedWallets.filter((wallet) => !catalogIds.has(wallet.id)),
      ],
    }
  }, [wallets])

  const walletPickerSections = useMemo(() => {
    const query = normalizeWalletName(walletSearch)
    const toRows = (items: WalletCatalogItem[]): WalletPickerRow[] => items
      .map((item) => {
        const detectedWallet = wallets.find((wallet) => walletMatchesCatalog(wallet, item))
        return {
          ...item,
          detectedWallet,
          available: Boolean(detectedWallet),
          mobileOpenable: Boolean(!detectedWallet && isMobile),
        }
      })
      .filter((item) => {
        if (!query) return true
        return [item.name, ...(item.aliases || [])]
          .map(normalizeWalletName)
          .some((name) => name.includes(query) || query.includes(name))
      })

    return {
      popular: toRows(walletCatalog.popular),
      more: toRows(walletCatalog.more),
    }
  }, [isMobile, walletCatalog, wallets, walletSearch])

  const getPaymentData = useCallback(async (): Promise<PaymentData> => {
    if (paymentData?.paymentId) return paymentData

    const existingPaymentId = String(directPaymentId || parsePaymentIdFromUrl(directPaymentUrl)).trim()
    const existingPaymentUrl = String(directPaymentUrl || "").trim()
    if (existingPaymentId) {
      const next = { paymentId: existingPaymentId, paymentUrl: existingPaymentUrl }
      setPaymentData(next)
      return next
    }

    if (!intentId) {
      throw new Error("Missing payment ID")
    }

    setExecStage("creating_payment")
    const res = await fetch(
      `/api/payment-intents/${encodeURIComponent(intentId)}/select-network`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network: "solana", asset: selectedAsset }),
      }
    )

    if (!res.ok) {
      const err = (await res.json()) as { error?: string }
      throw new Error(err.error || "Failed to prepare Solana payment")
    }

    const data = (await res.json()) as { paymentId?: string; paymentUrl?: string; walletUrl?: string }
    const paymentId = String(data.paymentId || "").trim()
    const paymentUrl = String(data.paymentUrl || data.walletUrl || "").trim()
    if (!paymentId) throw new Error("No payment ID returned")

    const next = { paymentId, paymentUrl }
    setPaymentData(next)
    onPaymentCreated?.(paymentId)
    return next
  }, [directPaymentId, directPaymentUrl, intentId, onPaymentCreated, paymentData, selectedAsset])

  async function sendWalletTransaction(provider: SolanaBrowserProvider, paymentId: string): Promise<string> {
    const connectResult = await provider.connect()
    const walletPublicKey = getSolanaProviderPublicKey(provider, connectResult)
    if (!walletPublicKey) {
      throw new Error("Unable to read Solana wallet public key")
    }

    setExecStage("wallet_connected")
    const res = await fetch(`/api/solana-pay/transaction?paymentId=${encodeURIComponent(paymentId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: walletPublicKey }),
    })

    const data = (await res.json()) as SolanaPayTransactionResponse
    if (!res.ok || !data?.transaction) {
      throw new Error(data?.error || "Failed to build Solana transaction")
    }

    const { Transaction } = await import("@solana/web3.js")
    const tx = Transaction.from(Buffer.from(data.transaction, "base64"))

    setExecStage("confirm_payment")
    const result = await provider.signAndSendTransaction(tx)
    const signature = getSolanaTransactionSignature(result)
    if (!signature) {
      throw new Error("Wallet did not return a transaction signature")
    }

    return signature
  }

  const startPayment = useCallback(async (wallet: DetectedSolanaWallet) => {
    setError("")
    setSelectedWalletId(wallet.id)
    setActiveWalletName(wallet.name)
    setPendingWalletId(wallet.id)
    setWalletPickerOpen(false)
    onExecutionStarted?.()

    try {
      const preparedPayment = await getPaymentData()
      setExecStage("connecting_wallet")
      const signature = await sendWalletTransaction(wallet.provider, preparedPayment.paymentId)

      setExecStage("payment_submitted")
      await fetch(`/api/payments/${encodeURIComponent(preparedPayment.paymentId)}/detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: signature }),
      }).catch(() => null)

      setExecStage("detecting")
      onPaymentCreated?.(preparedPayment.paymentId)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send Solana transaction"
      setError(message)
      setExecStage("retryable_error")
      onError?.(message)
    } finally {
      setPendingWalletId("")
    }
  }, [getPaymentData, onError, onExecutionStarted, onPaymentCreated])

  const openMobileWalletBrowser = useCallback(async (wallet: WalletCatalogItem) => {
    setError("")
    setSelectedWalletId(wallet.id)
    setActiveWalletName(wallet.name)
    setPendingWalletId(wallet.id)
    setWalletPickerOpen(false)
    onExecutionStarted?.()

    try {
      const preparedPayment = await getPaymentData()
      setExecStage("connecting_wallet")

      if (wallet.mobileDeepLink === "solflare") {
        if (!intentId) throw new Error("Missing Solflare checkout intent")
        const res = await fetch("/api/solflare/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paymentId: preparedPayment.paymentId,
            intentId,
            selectedAsset
          })
        })
        const data = (await res.json()) as { connectUrl?: string; error?: string }
        if (!res.ok || !data.connectUrl) {
          throw new Error(data.error || "Failed to open Solflare")
        }
        const fallbackTimer = window.setTimeout(() => {
          if (document.visibilityState === "visible") {
            window.location.href = buildInstallUrl(wallet)
          }
        }, 1400)

        window.addEventListener("pagehide", () => window.clearTimeout(fallbackTimer), { once: true })
        window.location.href = data.connectUrl
        return
      }

      const currentUrl = new URL(window.location.href)
      currentUrl.searchParams.delete("status")
      currentUrl.searchParams.delete("phantom_error")
      currentUrl.searchParams.delete("solflare_error")

      const targetUrl = currentUrl.toString()
      const walletUrl = wallet.mobileDeepLink === "phantom"
        ? buildPhantomWalletBrowserUrl({
            currentHref: targetUrl,
            paymentId: preparedPayment.paymentId,
            intentId,
            selectedAsset,
            selectedNetwork: "solana",
          })
        : buildMobileWalletBrowserUrl(wallet, targetUrl)

      const fallbackTimer = window.setTimeout(() => {
        if (document.visibilityState === "visible") {
          window.location.href = buildInstallUrl(wallet)
        }
      }, 1400)

      window.addEventListener("pagehide", () => window.clearTimeout(fallbackTimer), { once: true })
      window.location.href = walletUrl
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open Solana wallet"
      setError(message)
      setExecStage("retryable_error")
      onError?.(message)
      setPendingWalletId("")
    }
  }, [getPaymentData, intentId, onError, onExecutionStarted, selectedAsset])

  const openInstallPage = useCallback((wallet: WalletCatalogItem) => {
    setError("")
    setSelectedWalletId(wallet.id)
    setActiveWalletName(wallet.name)
    window.location.href = buildInstallUrl(wallet)
  }, [])

  function renderStepIcon(status: StepStatus) {
    if (status === "done") {
      return (
        <span className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-green-500 shadow-sm shadow-green-500/20">
          <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l2.5 2.5 5.5-5" />
          </svg>
        </span>
      )
    }

    if (status === "active") {
      return (
        <span className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-[#0052FF] shadow-sm shadow-[#0052FF]/30">
          <span className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
        </span>
      )
    }

    return (
      <span className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 ring-1 ring-gray-200">
        <span className="h-2 w-2 rounded-full bg-gray-300" />
      </span>
    )
  }

  function renderStep(label: string, status: StepStatus, subtext?: string) {
    const rowClasses = status === "done"
      ? "bg-green-50/80 ring-1 ring-green-100"
      : status === "active"
        ? "bg-[#0052FF]/5 ring-1 ring-[#0052FF]/20 shadow-sm shadow-[#0052FF]/10"
        : "bg-gray-50/80 ring-1 ring-gray-100"

    return (
      <div className={`flex items-start gap-3 rounded-2xl px-3.5 py-3 transition-all ${rowClasses}`}>
        <div className="mt-0.5">{renderStepIcon(status)}</div>
        <div className="min-w-0 flex-1">
          <span className={`text-sm leading-tight ${
            status === "done"
              ? "text-green-700 font-medium"
              : status === "active"
                ? "text-[#0052FF] font-semibold"
                : "text-gray-400 font-medium"
          }`}>
            {label}
          </span>
          {subtext && status === "active" ? (
            <p className="text-xs text-gray-600 mt-1 leading-snug">{subtext}</p>
          ) : null}
        </div>
      </div>
    )
  }

  function renderWalletPickerSection(title: string, rows: WalletPickerRow[]) {
    if (rows.length === 0) return null

    return (
      <div className="space-y-3">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          {title}
        </p>
        <div className="grid grid-cols-2 gap-3 min-[360px]:grid-cols-3 sm:grid-cols-4">
          {rows.map((row) => {
            const available = row.available && row.detectedWallet
            const action: "connect" | "open" | "install" = available
              ? "connect"
              : row.mobileOpenable
                ? "open"
                : "install"
            const active = row.detectedWallet?.id === selectedWalletId || row.detectedWallet?.id === pendingWalletId
            const statusLabel = action === "connect" ? "Detected" : action === "open" ? "Open app" : "Install"
            const iconPath = row.iconPath || "/wallet-icons/solana-wallet.svg"
            return (
              <button
                key={row.id}
                type="button"
                disabled={Boolean(pendingWalletId)}
                onClick={() => {
                  if (action === "connect" && row.detectedWallet) {
                    void startPayment(row.detectedWallet)
                    return
                  }
                  if (action === "open") {
                    void openMobileWalletBrowser(row)
                    return
                  }
                  openInstallPage(row)
                }}
                className={`group flex min-h-[136px] flex-col items-center justify-between rounded-[22px] border px-2.5 py-3 text-center transition-all disabled:cursor-wait ${
                  active
                    ? "border-[#3b82f6]/70 bg-[#10284d] shadow-[0_18px_44px_rgba(0,82,255,0.22)]"
                    : "border-white/10 bg-[#151922] shadow-[0_14px_34px_rgba(0,0,0,0.22)] hover:-translate-y-0.5 hover:border-[#3b82f6]/55 hover:bg-[#1b2330] hover:shadow-[0_18px_44px_rgba(0,82,255,0.18)]"
                }`}
              >
                <span className="flex flex-col items-center gap-2">
                  <span className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#0f172a] shadow-[0_12px_28px_rgba(0,0,0,0.28)] ring-1 ring-white/15 transition group-hover:scale-[1.03]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={iconPath} alt="" className="h-full w-full rounded-[18px] object-contain p-1.5" />
                  </span>
                  <span className="line-clamp-2 min-h-[34px] text-sm font-semibold leading-tight text-white">
                    {row.name}
                  </span>
                </span>
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                  action === "connect"
                    ? "bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-300/20"
                    : "bg-[#0052FF]/18 text-blue-200 ring-1 ring-blue-300/15"
                }`}>
                  {pendingWalletId === (row.detectedWallet?.id || row.id) ? "Opening" : statusLabel}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const amountDisplay = (
    <div className="bg-gray-50 rounded-xl px-4 py-3 text-center space-y-1">
      {intentId ? (
        <>
          <p className="text-lg font-bold text-gray-900">${usdAmount.toFixed(2)} USD</p>
          <p className="text-xs text-gray-500">via Solana Network - exact {selectedAsset} determined at payment</p>
        </>
      ) : (
        <>
          <p className="text-lg font-bold text-gray-900">{nativeAmount} {selectedAsset}</p>
          <p className="text-xs text-gray-500">approx. ${usdAmount.toFixed(2)} USD</p>
        </>
      )}
    </div>
  )

  if (terminalStatus) {
    return (
      <div className="space-y-4" onClick={(event) => event.stopPropagation()}>
        <div className="text-xs uppercase tracking-widest text-gray-500 text-center font-semibold">
          Solana Network Payment
        </div>
        <PaymentStatusVisual status={terminalStatus} className="py-2" />
      </div>
    )
  }

  const isExecuting = execStage !== "idle" && execStage !== "retryable_error"
  const walletStatus = getStepStatus(execStage, "wallet_connected", ["creating_payment", "connecting_wallet"])
  const confirmStatus = getStepStatus(execStage, "payment_submitted", ["wallet_connected", "confirm_payment"])
  const networkStatus = getStepStatus(execStage, "confirmed", ["payment_submitted", "detecting"])
  const contextMessage =
    execStage === "creating_payment"
      ? "Preparing payment..."
      : execStage === "connecting_wallet"
        ? `Connecting ${activeWalletName || "wallet"}...`
        : execStage === "wallet_connected" || execStage === "confirm_payment"
          ? "Confirm payment in your wallet"
          : execStage === "payment_submitted" || execStage === "detecting"
            ? "Waiting for network confirmation..."
            : ""

  if (isExecuting) {
    return (
      <div className="w-full space-y-3" onClick={(event) => event.stopPropagation()}>
        <div className="text-xs uppercase tracking-widest text-gray-500 text-center font-semibold">
          Solana Network Payment
        </div>
        {amountDisplay}
        <div className="bg-white rounded-3xl mt-1 overflow-hidden shadow-sm ring-1 ring-gray-100">
          <div className="px-4 pt-4 pb-3 space-y-2.5">
            {renderStep("Wallet connected", walletStatus, walletStatus === "active" ? "Choose and approve your Solana wallet" : undefined)}
            {renderStep("Confirm payment", confirmStatus, confirmStatus === "active" ? "Approve the prepared transaction in your wallet" : undefined)}
            {renderStep("Network confirmation", networkStatus)}
          </div>
          {contextMessage ? (
            <div className="mx-4 mb-4 rounded-2xl px-4 py-3.5 bg-[#0052FF]/5 ring-1 ring-[#0052FF]/15">
              <span className="flex items-center gap-2 text-sm font-semibold text-[#0052FF]">
                <span className="inline-block h-2 w-2 rounded-full bg-[#0052FF] animate-pulse flex-shrink-0" />
                {contextMessage}
              </span>
              <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">
                Return here after approving if your wallet does not switch automatically.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3" onClick={(event) => event.stopPropagation()}>
      <div className="text-xs uppercase tracking-widest text-gray-500 text-center font-semibold">
        Solana Network Payment
      </div>
      {amountDisplay}

      {error ? (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {error}
        </div>
      ) : null}

      <Button
        fullWidth
        onClick={() => {
          refreshWallets()
          setWalletSearch("")
          setWalletPickerOpen(true)
        }}
      >
        Pay with {selectedAsset} on Solana
      </Button>

      {walletPickerOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-md sm:items-center sm:p-6"
          onClick={() => setWalletPickerOpen(false)}
        >
          <div
            className="flex max-h-[88svh] w-full flex-col overflow-hidden rounded-t-[30px] border border-white/10 bg-[#0b0f17] shadow-2xl shadow-black/60 sm:max-w-[520px] sm:rounded-[30px]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-white/10 bg-[#0f1420] px-5 pb-4 pt-5 sm:px-6">
              <div className="relative flex items-center justify-center">
                <div className="text-center">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                    Solana Wallets
                  </p>
                  <h2 className="mt-1 text-xl font-bold text-white">
                    All Wallets
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setWalletPickerOpen(false)}
                  className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center rounded-full bg-white/8 text-slate-300 ring-1 ring-white/10 transition hover:bg-white/12 hover:text-white"
                  aria-label="Close wallet picker"
                >
                  x
                </button>
              </div>
              <div className="relative mt-5">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                  Search
                </span>
                <input
                  value={walletSearch}
                  onChange={(event) => setWalletSearch(event.target.value)}
                  placeholder="Search wallet"
                  className="h-12 w-full rounded-2xl border border-white/10 bg-[#171d28] px-4 pl-[72px] text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#3b82f6]/70 focus:ring-4 focus:ring-[#0052FF]/20"
                  autoFocus
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 pb-[calc(env(safe-area-inset-bottom)+24px)] sm:px-6">
              {wallets.length === 0 ? (
                <div className="rounded-2xl bg-white/5 px-4 py-3 text-xs leading-relaxed text-slate-400 ring-1 ring-white/10">
                  No Solana wallet is detected in this browser. Choose Open app on mobile or Install on desktop.
                </div>
              ) : null}
              {renderWalletPickerSection("Popular", walletPickerSections.popular)}
              {renderWalletPickerSection("More wallets", walletPickerSections.more)}
              {walletPickerSections.popular.length === 0 && walletPickerSections.more.length === 0 ? (
                <div className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-400 ring-1 ring-white/10">
                  No wallets match your search.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
