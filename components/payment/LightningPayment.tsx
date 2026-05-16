"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Button from "@/components/ui/Button"
import { PaymentStatusVisual } from "@/components/payment/PaymentStatusVisual"
import WalletPickerModal, { type WalletPickerSection } from "@/components/payment/WalletPickerModal"

type LightningWallet = {
  id: string
  name: string
  iconPath: string
  iosStoreUrl?: string
  androidStoreUrl?: string
  universalUrl?: string
  invoiceUrlBuilder?: (invoiceBolt11: string) => string
}

const LIGHTNING_WALLETS: LightningWallet[] = [
  {
    id: "cash-app",
    name: "Cash App",
    iconPath: "/wallets/lightning/cash-app.png",
    iosStoreUrl: "https://apps.apple.com/us/app/cash-app/id711923939",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.squareup.cash",
    universalUrl: "https://cash.app/download",
    // Cash App handles the standard lightning: URI scheme on iOS and Android.
    // Using the universal scheme (not a cashapp:// proprietary deeplink) ensures
    // this works even when multiple Lightning wallets are installed.
    invoiceUrlBuilder: (invoiceBolt11) => `lightning:${invoiceBolt11}`,
  },
  {
    id: "strike",
    name: "Strike",
    iconPath: "/wallets/lightning/strike.png",
    iosStoreUrl: "https://apps.apple.com/us/app/strike-btc-global-money/id1488724463",
    androidStoreUrl: "https://play.google.com/store/search?q=Strike%20Bitcoin&c=apps",
    universalUrl: "https://strike.me/download",
    // Strike handles the standard lightning: URI scheme on iOS and Android.
    invoiceUrlBuilder: (invoiceBolt11) => `lightning:${invoiceBolt11}`,
  },
  {
    id: "wallet-of-satoshi",
    name: "Wallet of Satoshi",
    iconPath: "/wallets/lightning/wallet-of-satoshi.png",
    iosStoreUrl: "https://apps.apple.com/us/search?term=Wallet%20of%20Satoshi",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.livingroomofsatoshi.wallet",
    universalUrl: "https://www.walletofsatoshi.com",
    invoiceUrlBuilder: (invoiceBolt11) => `lightning:${invoiceBolt11}`,
  },
  {
    id: "muun",
    name: "Muun",
    iconPath: "/wallets/lightning/muun.png",
    iosStoreUrl: "https://apps.apple.com/us/search?term=Muun%20Bitcoin%20Lightning",
    androidStoreUrl: "https://play.google.com/store/search?q=Muun%20Bitcoin%20Lightning&c=apps",
    universalUrl: "https://muun.com",
    invoiceUrlBuilder: (invoiceBolt11) => `lightning:${invoiceBolt11}`,
  },
  {
    id: "phoenix",
    name: "Phoenix",
    iconPath: "/wallets/lightning/phoenix.png",
    iosStoreUrl: "https://apps.apple.com/us/search?term=Phoenix%20Wallet%20Bitcoin",
    androidStoreUrl: "https://play.google.com/store/search?q=Phoenix%20Wallet%20Bitcoin&c=apps",
    universalUrl: "https://phoenix.acinq.co",
    invoiceUrlBuilder: (invoiceBolt11) => `phoenix:lightning:${invoiceBolt11}`,
  },
  {
    id: "zeus",
    name: "Zeus",
    iconPath: "/wallets/lightning/zeus.png",
    iosStoreUrl: "https://apps.apple.com/us/app/zeus-wallet/id1456038895",
    androidStoreUrl: "https://play.google.com/store/search?q=ZEUS%20Wallet&c=apps",
    universalUrl: "https://zeusln.app",
    invoiceUrlBuilder: (invoiceBolt11) => `zeusln:${invoiceBolt11}`,
  },
  {
    id: "breez",
    name: "Breez",
    iconPath: "/wallets/lightning/breez.png",
    iosStoreUrl: "https://apps.apple.com/us/search?term=Breez%20Lightning%20Wallet",
    androidStoreUrl: "https://play.google.com/store/search?q=Breez%20Lightning%20Wallet&c=apps",
    universalUrl: "https://breez.technology",
    invoiceUrlBuilder: (invoiceBolt11) => `breez:${invoiceBolt11}`,
  },
  {
    id: "bluewallet",
    name: "BlueWallet",
    iconPath: "/wallets/lightning/bluewallet.png",
    iosStoreUrl: "https://apps.apple.com/us/search?term=BlueWallet",
    androidStoreUrl: "https://play.google.com/store/search?q=BlueWallet&c=apps",
    universalUrl: "https://bluewallet.io",
    invoiceUrlBuilder: (invoiceBolt11) => `bluewallet:lightning:${invoiceBolt11}`,
  },
]

const TERMINAL_PAYMENT_STATUSES = new Set(["CONFIRMED", "FAILED", "INCOMPLETE", "EXPIRED", "CANCELED"])

function normalizeTerminalStatus(status?: string): string {
  const normalized = String(status || "").trim().toUpperCase()
  if (normalized === "CANCELLED") return "CANCELED"
  return TERMINAL_PAYMENT_STATUSES.has(normalized) ? normalized : ""
}

type Props = {
  intentId: string
  usdAmount: number
  paymentStatus?: string
  onPaymentCreated?: () => void
  onExecutionStarted?: () => void
  onCancel?: () => void
}

type LightningSelectionResult = {
  paymentId?: string
  paymentUrl?: string
  qrCodeUrl?: string
  estimatedSats?: number | string | null
}

function normalizeLightningUri(invoice: string): string {
  const normalized = String(invoice || "").trim()
  if (!normalized) return ""
  return normalized.toLowerCase().startsWith("lightning:")
    ? normalized
    : `lightning:${normalized}`
}

function getBolt11Invoice(invoiceUri: string): string {
  return invoiceUri.replace(/^lightning:/i, "")
}

function normalizeWalletName(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function getMobilePlatform(): "ios" | "android" | "desktop" {
  if (typeof navigator === "undefined") return "desktop"
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios"
  if (/Android/i.test(ua)) return "android"
  return "desktop"
}

function getStoreFallbackUrl(wallet: LightningWallet): string {
  const platform = getMobilePlatform()
  if (platform === "ios" && wallet.iosStoreUrl) return wallet.iosStoreUrl
  if (platform === "android" && wallet.androidStoreUrl) return wallet.androidStoreUrl
  return wallet.universalUrl || wallet.iosStoreUrl || wallet.androidStoreUrl || ""
}

async function logLightning(stage: string, payload: Record<string, unknown> = {}): Promise<void> {
  console.log("[LIGHTNING DEBUG]", stage, payload)
  await fetch("/api/debug/lightning", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage, payload }),
  }).catch(() => null)
}

export default function LightningPayment({
  intentId,
  usdAmount,
  paymentStatus,
  onPaymentCreated,
  onExecutionStarted,
  onCancel,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [copiedField, setCopiedField] = useState<"invoice" | "amount" | "sats" | "">("")
  const [payment, setPayment] = useState<LightningSelectionResult | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [walletPickerOpen, setWalletPickerOpen] = useState(false)
  const [walletSearch, setWalletSearch] = useState("")
  const [pendingWalletId, setPendingWalletId] = useState("")
  const walletLaunchedRef = useRef(false)
  const [walletLaunched, setWalletLaunched] = useState(false)
  const [noPayAfterReturn, setNoPayAfterReturn] = useState(false)
  const [launchedWalletName, setLaunchedWalletName] = useState("")
  const autoPrepareStartedRef = useRef(false)

  const invoice = String(payment?.paymentUrl || "")
  const invoiceUri = useMemo(() => normalizeLightningUri(invoice), [invoice])
  const hasInvoice = Boolean(invoiceUri)
  const terminalStatus = normalizeTerminalStatus(paymentStatus)
  const isPaymentProcessing = String(paymentStatus || "").toUpperCase() === "PROCESSING"
  const formattedUsdAmount = useMemo(() => new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(usdAmount), [usdAmount])
  const estimatedSats = Number(payment?.estimatedSats)
  const hasEstimatedSats = Number.isFinite(estimatedSats) && estimatedSats > 0
  const formattedSats = hasEstimatedSats
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(estimatedSats)
    : ""

  const prepareInvoice = useCallback(async () => {
    setLoading(true)
    setError("")
    setCopiedField("")

    try {
      const res = await fetch(
        `/api/payment-intents/${encodeURIComponent(intentId)}/select-network`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ network: "bitcoin_lightning", asset: "BTC" }),
        }
      )

      const data = (await res.json()) as LightningSelectionResult & { error?: string }
      if (!res.ok) {
        throw new Error(data.error || "Bitcoin Lightning is unavailable for this merchant")
      }

      setPayment(data)
      setWalletSearch("")
      onPaymentCreated?.()
    } catch (err) {
      setError((err as Error).message || "Unable to prepare Lightning invoice")
    } finally {
      setLoading(false)
    }
  }, [intentId, onPaymentCreated])

  useEffect(() => {
    if (autoPrepareStartedRef.current || hasInvoice) return
    autoPrepareStartedRef.current = true
    void prepareInvoice()
  }, [hasInvoice, prepareInvoice])

  // When the customer returns to this page after being sent to a Lightning wallet,
  // surface recovery actions if no payment was completed.
  useEffect(() => {
    function handleReturn() {
      if (!walletLaunchedRef.current) return
      setNoPayAfterReturn(true)
      void logLightning("wallet_returned_without_payment", { walletName: launchedWalletName || null, rail: "lightning" })
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

  const openLightningWallet = useCallback((wallet: LightningWallet) => {
    if (!invoiceUri) return

    setPendingWalletId(wallet.id)
    setWalletPickerOpen(false)
    walletLaunchedRef.current = true
    setWalletLaunched(true)
    setNoPayAfterReturn(false)
    setLaunchedWalletName(wallet.name)
    onExecutionStarted?.()

    void logLightning("wallet_selected", { walletId: wallet.id, walletName: wallet.name, rail: "lightning" })

    if (wallet.invoiceUrlBuilder) {
      const bolt11 = getBolt11Invoice(invoiceUri)
      const appUrl = wallet.invoiceUrlBuilder(bolt11)

      void logLightning("lightning_uri_generated", {
        walletId: wallet.id,
        rail: "lightning",
        scheme: appUrl.split(":")[0],
        invoicePrefix: bolt11.slice(0, 12),
      })

      // Attempt to bring the wallet app to the foreground.
      // After 1.4 s, if the page is still visible (app didn't open / not installed),
      // open the appropriate app store as a fallback.
      // This is the safest pattern available since browsers cannot detect installed apps.
      const fallbackTimer = window.setTimeout(() => {
        if (document.visibilityState === "visible") {
          void logLightning("app_store_fallback_triggered", { walletId: wallet.id, rail: "lightning", reason: "timeout_1400ms" })
          const storeUrl = getStoreFallbackUrl(wallet)
          if (storeUrl) window.open(storeUrl, "_blank", "noopener,noreferrer")
        }
        setPendingWalletId("")
      }, 1400)

      window.addEventListener(
        "pagehide",
        () => {
          window.clearTimeout(fallbackTimer)
          setPendingWalletId("")
        },
        { once: true },
      )

      void logLightning("app_open_attempted", { walletId: wallet.id, rail: "lightning", scheme: appUrl.split(":")[0] })
      window.location.href = appUrl
      return
    }

    const installUrl = getStoreFallbackUrl(wallet)
    if (!installUrl) {
      setPendingWalletId("")
      return
    }

    void logLightning("app_store_fallback_triggered", { walletId: wallet.id, rail: "lightning", reason: "no_invoice_url_builder" })
    window.open(installUrl, "_blank", "noopener,noreferrer")
    setPendingWalletId("")
  }, [invoiceUri])

  const walletPickerSections: WalletPickerSection[] = useMemo(() => {
    const query = normalizeWalletName(walletSearch)
    const wallets = LIGHTNING_WALLETS
      .filter((wallet) => !query || normalizeWalletName(wallet.name).includes(query))
      .map((wallet) => ({
        id: wallet.id,
        name: wallet.name,
        iconPath: wallet.iconPath,
        badgeLabel: pendingWalletId === wallet.id
          ? "Opening"
          : wallet.invoiceUrlBuilder
            ? "Pay invoice"
            : "Install",
        badgeTone: "blue" as const,
        active: pendingWalletId === wallet.id,
        disabled: Boolean(pendingWalletId),
        onSelect: () => openLightningWallet(wallet),
      }))

    return [{ title: "Popular", wallets }]
  }, [openLightningWallet, pendingWalletId, walletSearch])

  async function copyValue(field: "invoice" | "amount" | "sats", value: string) {
    if (!value) return
    await navigator.clipboard.writeText(value)
    setCopiedField(field)
    window.setTimeout(() => setCopiedField(""), 1800)
  }

  if (terminalStatus) {
    if (terminalStatus === "CONFIRMED") {
      void logLightning("payment_confirmed", { rail: "lightning", status: terminalStatus })
    }
    return (
      <div className="space-y-3">
        <div className="text-center text-xs font-semibold uppercase tracking-widest text-gray-500">
          Bitcoin Lightning Payment
        </div>
        <PaymentStatusVisual status={terminalStatus} variant="card" />
      </div>
    )
  }

  if (!hasInvoice) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-700">Pay with Bitcoin Lightning</p>
        <p className="text-xs text-gray-500">Preparing your Lightning invoice and payment options.</p>
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        ) : null}
        <Button fullWidth disabled={loading || !error} onClick={() => void prepareInvoice()}>
          {loading ? "Preparing invoice..." : error ? "Retry Lightning invoice" : `Preparing ${formattedUsdAmount}`}
        </Button>
      </div>
    )
  }

  const showRecovery = walletLaunched && noPayAfterReturn && !isPaymentProcessing

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-gray-900">Pay with Bitcoin Lightning</p>
        <p className="mt-0.5 text-xs text-gray-500">Choose a Lightning wallet</p>
      </div>

      {/* QR code - desktop only. Hidden on mobile because the QR is on the same device that needs to scan it. */}
      {payment?.qrCodeUrl ? (
        <div className="hidden justify-center rounded-xl border border-gray-200 bg-white p-3 md:flex">
          <img
            src={payment.qrCodeUrl}
            alt="Bitcoin Lightning invoice QR code"
            className="h-56 w-56"
          />
        </div>
      ) : null}

      {showRecovery ? (
        <>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            No payment detected. Your wallet returned without completing the payment.
          </div>
          <Button
            fullWidth
            onClick={() => {
              void logLightning("retry_requested", { walletName: launchedWalletName || null, rail: "lightning" })
              setWalletSearch("")
              setWalletPickerOpen(true)
            }}
          >
            {launchedWalletName ? `Try again with ${launchedWalletName}` : "Try again"}
          </Button>
          {onCancel ? (
            <button
              type="button"
              onClick={() => {
                void logLightning("switch_method", { walletName: launchedWalletName || null, rail: "lightning" })
                setWalletLaunched(false)
                setNoPayAfterReturn(false)
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
        <>
          <Button
            fullWidth
            onClick={() => {
              setWalletSearch("")
              setWalletPickerOpen(true)
            }}
          >
            Choose Lightning Wallet
          </Button>

          <Button fullWidth onClick={() => {
            walletLaunchedRef.current = true
            setWalletLaunched(true)
            setNoPayAfterReturn(false)
            setLaunchedWalletName("")
            onExecutionStarted?.()
            window.location.href = invoiceUri
          }}>
            Pay with installed Lightning wallet
          </Button>
        </>
      )}

      <WalletPickerModal
        open={walletPickerOpen}
        eyebrow="Bitcoin Lightning Wallets"
        title="All Wallets"
        searchValue={walletSearch}
        sections={walletPickerSections}
        notice={(
          <div className="rounded-2xl bg-white/5 px-4 py-3 text-xs leading-relaxed text-slate-400 ring-1 ring-white/10">
            No Lightning wallet is detected in this browser. Choose Open app on mobile or Install on desktop.
          </div>
        )}
        onSearchChange={setWalletSearch}
        onClose={() => setWalletPickerOpen(false)}
      />

      <section className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">Manual Lightning payment</p>
          <p className="mt-0.5 text-xs text-gray-600">
            Use this if your wallet does not open automatically.
          </p>
        </div>

        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Amount</p>
            <p className="mt-1 font-semibold text-gray-900">{formattedUsdAmount}</p>
          </div>

          {hasEstimatedSats ? (
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Sats</p>
              <p className="mt-1 font-semibold text-gray-900">{formattedSats}</p>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Lightning invoice</p>
          <div className="overflow-x-auto whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-800">
            {invoiceUri}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <Button variant="secondary" fullWidth onClick={() => void copyValue("invoice", invoiceUri)}>
            {copiedField === "invoice" ? "Copied" : "Copy Invoice"}
          </Button>
          <Button variant="secondary" fullWidth onClick={() => void copyValue("amount", formattedUsdAmount)}>
            {copiedField === "amount" ? "Copied" : "Copy Amount"}
          </Button>
          {hasEstimatedSats ? (
            <Button variant="secondary" fullWidth onClick={() => void copyValue("sats", String(estimatedSats))}>
              {copiedField === "sats" ? "Copied" : "Copy Sats"}
            </Button>
          ) : null}
        </div>

        <p className="text-xs leading-relaxed text-gray-600">
          Open your Lightning wallet, paste the invoice, and confirm the exact amount.
        </p>
      </section>

      <button
        onClick={() => setShowDetails((v) => !v)}
        className="w-full text-center text-xs text-gray-400 transition-colors hover:text-gray-600"
      >
        {showDetails ? "Hide invoice details" : "Show invoice details"}
      </button>

      {showDetails ? (
        <div className="break-all rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-800">
          {invoiceUri}
        </div>
      ) : null}
    </div>
  )
}
