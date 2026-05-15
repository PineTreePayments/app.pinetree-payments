"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Button from "@/components/ui/Button"
import { PaymentStatusVisual } from "@/components/payment/PaymentStatusVisual"
import WalletPickerModal, { type WalletPickerSection } from "@/components/payment/WalletPickerModal"
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
  onCancel?: () => void
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
  /** Wallet's mobile in-app browser does not inject a Solana provider — hide mobile "Open app" flow */
  mobileUnsupported?: true
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
  { id: "coinbase-wallet", name: "Coinbase Wallet", aliases: ["coinbase"], mobileDeepLink: "coinbase", mobileUnsupported: true, iconPath: "/wallet-icons/coinbase-wallet.svg", installUrl: "https://www.coinbase.com/wallet/downloads" },
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
  onCancel,
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
  // Wallet bounce tracking — set on any launch attempt, detected on visibility return
  const walletLaunchedRef = useRef(false)
  const [walletLaunched, setWalletLaunched] = useState(false)
  const [noTxAfterReturn, setNoTxAfterReturn] = useState(false)
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

  // When the customer returns to this page after being sent to a wallet app,
  // detect the return and surface recovery actions if no tx was submitted.
  useEffect(() => {
    function handleReturn() {
      if (!walletLaunchedRef.current) return
      setNoTxAfterReturn(true)
      // Unfreeze any "connecting" stage left over from the mobile redirect
      setExecStage((current) => {
        if (current === "connecting_wallet" || current === "creating_payment") return "idle"
        return current
      })
    }
    function handleVisibility() {
      if (document.visibilityState === "visible") handleReturn()
    }
    document.addEventListener("visibilitychange", handleVisibility)
    window.addEventListener("pageshow", handleReturn)
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility)
      window.removeEventListener("pageshow", handleReturn)
    }
  }, [])

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
          // mobileUnsupported wallets have no Solana provider in their mobile in-app browser.
          // Keep them visible for desktop detection but suppress the "Open app" path on mobile
          // so customers are not routed into an EVM/Base context by mistake.
          mobileOpenable: Boolean(!detectedWallet && isMobile && !item.mobileUnsupported),
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
    walletLaunchedRef.current = true
    setWalletLaunched(true)
    setNoTxAfterReturn(false)
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
    walletLaunchedRef.current = true
    setWalletLaunched(true)
    setNoTxAfterReturn(false)
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

  const walletPickerModalSections: WalletPickerSection[] = useMemo(() => {
    const toCards = (rows: WalletPickerRow[]) => rows.map((row) => {
      const available = row.available && row.detectedWallet
      const action: "connect" | "open" | "install" = available
        ? "connect"
        : row.mobileOpenable
          ? "open"
          : "install"
      const active = row.detectedWallet?.id === selectedWalletId || row.detectedWallet?.id === pendingWalletId
      const statusLabel = action === "connect"
        ? "Detected"
        : action === "open"
          ? "Open app"
          : (row.mobileUnsupported && isMobile)
            ? "Desktop only"
            : "Install"

      return {
        id: row.id,
        name: row.name,
        iconPath: row.iconPath || "/wallet-icons/solana-wallet.svg",
        badgeLabel: pendingWalletId === (row.detectedWallet?.id || row.id) ? "Opening" : statusLabel,
        badgeTone: action === "connect" ? "green" as const : "blue" as const,
        active,
        disabled: Boolean(pendingWalletId),
        onSelect: () => {
          if (action === "connect" && row.detectedWallet) {
            void startPayment(row.detectedWallet)
            return
          }
          if (action === "open") {
            void openMobileWalletBrowser(row)
            return
          }
          openInstallPage(row)
        },
      }
    })

    return [
      { title: "Popular", wallets: toCards(walletPickerSections.popular) },
      { title: "More wallets", wallets: toCards(walletPickerSections.more) },
    ]
  }, [
    openInstallPage,
    openMobileWalletBrowser,
    pendingWalletId,
    selectedWalletId,
    startPayment,
    walletPickerSections.more,
    walletPickerSections.popular,
  ])

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
      <div className="space-y-3" onClick={(event) => event.stopPropagation()}>
        <div className="text-center text-xs font-semibold uppercase tracking-widest text-[#0052FF]">
          Solana Network Payment
        </div>
        <PaymentStatusVisual status={terminalStatus} variant="card" />
      </div>
    )
  }

  const isExecuting = execStage !== "idle" && execStage !== "retryable_error"
  const isPaymentInFlight = String(paymentStatus || "").toUpperCase() === "PROCESSING"
  // Show recovery actions after any wallet launch attempt, as long as no tx is in flight
  const hasAttempted = walletLaunched && (execStage === "retryable_error" || noTxAfterReturn)
  const showRecovery = hasAttempted && !isPaymentInFlight && !terminalStatus
  const walletStatus = getStepStatus(execStage, "wallet_connected", ["creating_payment", "connecting_wallet"])
  const confirmStatus = getStepStatus(execStage, "payment_submitted", ["wallet_connected", "confirm_payment"])
  const networkStatus = getStepStatus(execStage, "confirmed", ["payment_submitted", "detecting"])
  const contextMessage =
    execStage === "creating_payment"
      ? "Preparing payment..."
      : execStage === "connecting_wallet"
        ? `Wallet opened — approve the transaction to continue`
        : execStage === "wallet_connected" || execStage === "confirm_payment"
          ? "Confirm in your wallet"
          : execStage === "payment_submitted" || execStage === "detecting"
            ? "Waiting for payment..."
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
            {renderStep("Wallet opened", walletStatus, walletStatus === "active" ? "Approve the transaction in your wallet to continue" : undefined)}
            {renderStep("Confirm in wallet", confirmStatus, confirmStatus === "active" ? "Review and approve the prepared transaction" : undefined)}
            {renderStep("Waiting for payment", networkStatus)}
          </div>
          {contextMessage ? (
            <div className="mx-4 mb-4 rounded-2xl px-4 py-3.5 bg-[#0052FF]/5 ring-1 ring-[#0052FF]/15">
              <span className="flex items-center gap-2 text-sm font-semibold text-[#0052FF]">
                <span className="inline-block h-2 w-2 rounded-full bg-[#0052FF] animate-pulse flex-shrink-0" />
                {contextMessage}
              </span>
              <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">
                {execStage === "payment_submitted" || execStage === "detecting"
                  ? "Your transaction is being confirmed on the Solana network."
                  : "Return here after approving if your wallet does not switch automatically."}
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

      {showRecovery ? (
        <>
          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </div>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              No transaction detected. Your wallet returned without completing the payment.
            </div>
          )}
          <Button
            fullWidth
            onClick={() => {
              refreshWallets()
              setWalletSearch("")
              setWalletPickerOpen(true)
            }}
          >
            {activeWalletName ? `Try again with ${activeWalletName}` : "Try again"}
          </Button>
          {onCancel ? (
            <button
              type="button"
              onClick={() => {
                setError("")
                setExecStage("idle")
                setWalletLaunched(false)
                setNoTxAfterReturn(false)
                walletLaunchedRef.current = false
                onCancel()
              }}
              className="w-full text-center text-xs text-gray-500 underline underline-offset-2 py-1 hover:text-gray-700 transition-colors"
            >
              Switch payment method
            </button>
          ) : null}
        </>
      ) : (
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
      )}

      <WalletPickerModal
        open={walletPickerOpen}
        eyebrow="Solana Wallets"
        title="All Wallets"
        searchValue={walletSearch}
        sections={walletPickerModalSections}
        notice={wallets.length === 0 ? (
          <div className="rounded-2xl bg-white/5 px-4 py-3 text-xs leading-relaxed text-slate-400 ring-1 ring-white/10">
            No Solana wallet is detected in this browser. Choose Open app on mobile or Install on desktop.
          </div>
        ) : null}
        onSearchChange={setWalletSearch}
        onClose={() => setWalletPickerOpen(false)}
      />
    </div>
  )
}
