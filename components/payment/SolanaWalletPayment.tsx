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
  mobileDeepLink?: "phantom" | "trust" | "coinbase" | "okx"
}

type WalletPickerRow = WalletCatalogItem & {
  detectedWallet?: DetectedSolanaWallet
  available: boolean
  mobileOpenable: boolean
}

const TERMINAL_PAYMENT_STATUSES = new Set(["CONFIRMED", "FAILED", "INCOMPLETE", "EXPIRED", "CANCELED"])

const POPULAR_WALLETS: WalletCatalogItem[] = [
  { id: "phantom", name: "Phantom", mobileDeepLink: "phantom" },
  { id: "solflare", name: "Solflare" },
  { id: "backpack", name: "Backpack" },
  { id: "glow", name: "Glow" },
  { id: "trust-wallet", name: "Trust Wallet", aliases: ["trust"], mobileDeepLink: "trust" },
  { id: "coinbase-wallet", name: "Coinbase Wallet", aliases: ["coinbase"], mobileDeepLink: "coinbase" },
  { id: "okx-wallet", name: "OKX Wallet", aliases: ["okx"], mobileDeepLink: "okx" },
]

const MORE_WALLETS: WalletCatalogItem[] = [
  { id: "exodus", name: "Exodus" },
  { id: "ledger", name: "Ledger" },
  { id: "mathwallet", name: "MathWallet", aliases: ["math wallet"] },
  { id: "tokenpocket", name: "TokenPocket", aliases: ["token pocket"] },
  { id: "torus", name: "Torus" },
  { id: "clover", name: "Clover" },
  { id: "coin98", name: "Coin98" },
  { id: "safepal", name: "SafePal", aliases: ["safe pal"] },
  { id: "bitget-wallet", name: "Bitget Wallet", aliases: ["bitget"] },
  { id: "brave-wallet", name: "Brave Wallet", aliases: ["brave"] },
  { id: "nightly", name: "Nightly" },
  { id: "ultimate", name: "Ultimate" },
  { id: "salmon", name: "Salmon" },
  { id: "slope", name: "Slope" },
  { id: "sollet", name: "Sollet" },
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

function walletInitial(name: string): string {
  return String(name || "S").trim().slice(0, 1).toUpperCase() || "S"
}

function buildMobileWalletBrowserUrl(kind: WalletCatalogItem["mobileDeepLink"], targetUrl: string): string {
  const encodedTarget = encodeURIComponent(targetUrl)
  if (kind === "trust") return `https://link.trustwallet.com/open_url?coin_id=501&url=${encodedTarget}`
  if (kind === "coinbase") return `https://go.cb-w.com/dapp?cb_url=${encodedTarget}`
  if (kind === "okx") return `okx://wallet/dapp/url?dappUrl=${encodedTarget}`
  return targetUrl
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

  const walletCatalog = useMemo(() => {
    const catalogIds = new Set([...POPULAR_WALLETS, ...MORE_WALLETS].map((wallet) => wallet.id))
    const extraDetectedWallets = wallets
      .filter((wallet) => ![...POPULAR_WALLETS, ...MORE_WALLETS].some((item) => walletMatchesCatalog(wallet, item)))
      .map((wallet): WalletCatalogItem => ({
        id: `detected-${wallet.id}`,
        name: wallet.name,
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
          mobileOpenable: Boolean(!detectedWallet && isMobile && item.mobileDeepLink),
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
    if (!wallet.mobileDeepLink) return

    setError("")
    setSelectedWalletId(wallet.id)
    setActiveWalletName(wallet.name)
    setPendingWalletId(wallet.id)
    setWalletPickerOpen(false)
    onExecutionStarted?.()

    try {
      const preparedPayment = await getPaymentData()
      setExecStage("connecting_wallet")

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
        : buildMobileWalletBrowserUrl(wallet.mobileDeepLink, targetUrl)

      window.location.href = walletUrl
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open Solana wallet"
      setError(message)
      setExecStage("retryable_error")
      onError?.(message)
      setPendingWalletId("")
    }
  }, [getPaymentData, intentId, onError, onExecutionStarted, selectedAsset])

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
      <div className="space-y-2">
        <p className="px-1 text-[11px] font-semibold uppercase tracking-widest text-gray-400">
          {title}
        </p>
        <div className="space-y-2">
          {rows.map((row) => {
            const available = row.available && row.detectedWallet
            const clickable = Boolean(available || row.mobileOpenable)
            const active = row.detectedWallet?.id === selectedWalletId || row.detectedWallet?.id === pendingWalletId
            return (
              <button
                key={row.id}
                type="button"
                disabled={!clickable || Boolean(pendingWalletId)}
                onClick={() => {
                  if (row.detectedWallet) {
                    void startPayment(row.detectedWallet)
                    return
                  }
                  if (row.mobileOpenable) {
                    void openMobileWalletBrowser(row)
                  }
                }}
                className={`w-full rounded-2xl border px-3.5 py-3 text-left transition-all ${
                  clickable
                    ? active
                      ? "border-[#0052FF]/35 bg-[#0052FF]/5 shadow-sm shadow-[#0052FF]/10"
                      : "border-gray-200 bg-white hover:border-[#0052FF]/25 hover:bg-[#0052FF]/5"
                    : "border-gray-100 bg-gray-50/80 opacity-70"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl text-sm font-bold ${
                    clickable
                      ? "bg-gradient-to-br from-[#0052FF] to-[#0039B8] text-white shadow-sm shadow-[#0052FF]/20"
                      : "bg-gray-200 text-gray-400"
                  }`}>
                    {walletInitial(row.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm font-semibold ${clickable ? "text-gray-900" : "text-gray-400"}`}>
                      {row.name}
                    </span>
                    <span className={`mt-0.5 block text-xs ${available ? "text-green-600" : row.mobileOpenable ? "text-[#0052FF]" : "text-gray-400"}`}>
                      {available ? "Available" : row.mobileOpenable ? "Open in wallet browser" : "Not detected"}
                    </span>
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    clickable
                      ? "bg-[#0052FF]/10 text-[#0052FF]"
                      : "bg-gray-100 text-gray-400"
                  }`}>
                    {pendingWalletId === (row.detectedWallet?.id || row.id) ? "Opening" : available ? "Connect" : row.mobileOpenable ? "Open wallet" : "Unavailable"}
                  </span>
                </div>
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
          className="fixed inset-0 z-50 flex items-end justify-center bg-gray-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          onClick={() => setWalletPickerOpen(false)}
        >
          <div
            className="max-h-[88vh] w-full overflow-hidden rounded-t-3xl bg-white shadow-2xl shadow-gray-950/20 ring-1 ring-gray-200 sm:max-w-md sm:rounded-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-gray-100 bg-gradient-to-br from-[#F4F8FF] via-white to-[#E8F1FF] px-5 pb-4 pt-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">
                    Solana Wallets
                  </p>
                  <h2 className="mt-1 text-lg font-bold text-gray-900">
                    Choose a wallet
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setWalletPickerOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-gray-500 shadow-sm ring-1 ring-gray-200 transition hover:bg-gray-50 hover:text-gray-900"
                  aria-label="Close wallet picker"
                >
                  x
                </button>
              </div>
              <div className="mt-4">
                <input
                  value={walletSearch}
                  onChange={(event) => setWalletSearch(event.target.value)}
                  placeholder="Search wallets"
                  className="h-11 w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[#0052FF]/40 focus:ring-4 focus:ring-[#0052FF]/10"
                  autoFocus
                />
              </div>
            </div>

            <div className="max-h-[62vh] space-y-5 overflow-y-auto px-5 py-4">
              {wallets.length === 0 ? (
                <div className="rounded-2xl bg-gray-50 px-4 py-3 text-xs leading-relaxed text-gray-600 ring-1 ring-gray-100">
                  No Solana wallet detected. Open this checkout on a device with Phantom, Solflare, Backpack, or another Solana wallet installed.
                </div>
              ) : null}
              {renderWalletPickerSection("Popular", walletPickerSections.popular)}
              {renderWalletPickerSection("More wallets", walletPickerSections.more)}
              {walletPickerSections.popular.length === 0 && walletPickerSections.more.length === 0 ? (
                <div className="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-500 ring-1 ring-gray-100">
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
