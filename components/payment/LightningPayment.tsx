"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Button from "@/components/ui/Button"
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
  },
  {
    id: "strike",
    name: "Strike",
    iconPath: "/wallets/lightning/strike.png",
    iosStoreUrl: "https://apps.apple.com/us/app/strike-btc-global-money/id1488724463",
    androidStoreUrl: "https://play.google.com/store/search?q=Strike%20Bitcoin&c=apps",
    universalUrl: "https://strike.me/download",
  },
  {
    id: "wallet-of-satoshi",
    name: "Wallet of Satoshi",
    iconPath: "/wallets/lightning/wallet-of-satoshi.png",
    iosStoreUrl: "https://apps.apple.com/us/search?term=Wallet%20of%20Satoshi",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.livingroomofsatoshi.wallet",
    universalUrl: "https://www.walletofsatoshi.com",
  },
  {
    id: "muun",
    name: "Muun",
    iconPath: "/wallets/lightning/muun.png",
    iosStoreUrl: "https://apps.apple.com/us/search?term=Muun%20Bitcoin%20Lightning",
    androidStoreUrl: "https://play.google.com/store/search?q=Muun%20Bitcoin%20Lightning&c=apps",
    universalUrl: "https://muun.com",
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

type Props = {
  intentId: string
  usdAmount: number
  paymentStatus?: string
  onPaymentCreated?: () => void
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

export default function LightningPayment({
  intentId,
  usdAmount,
  paymentStatus,
  onPaymentCreated,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [copiedField, setCopiedField] = useState<"invoice" | "amount" | "sats" | "">("")
  const [payment, setPayment] = useState<LightningSelectionResult | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [walletPickerOpen, setWalletPickerOpen] = useState(false)
  const [walletSearch, setWalletSearch] = useState("")
  const [pendingWalletId, setPendingWalletId] = useState("")
  const autoPrepareStartedRef = useRef(false)

  const invoice = String(payment?.paymentUrl || "")
  const invoiceUri = useMemo(() => normalizeLightningUri(invoice), [invoice])
  const hasInvoice = Boolean(invoiceUri)
  const status = String(paymentStatus || "").toUpperCase()
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
      setWalletPickerOpen(true)
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

  const openLightningWallet = useCallback((wallet: LightningWallet) => {
    if (!invoiceUri) return

    setPendingWalletId(wallet.id)
    setWalletPickerOpen(false)

    if (wallet.invoiceUrlBuilder) {
      window.location.href = wallet.invoiceUrlBuilder(getBolt11Invoice(invoiceUri))
      window.setTimeout(() => setPendingWalletId(""), 1200)
      return
    }

    const installUrl = getStoreFallbackUrl(wallet)
    if (!installUrl) {
      setPendingWalletId("")
      return
    }

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

      <Button
        fullWidth
        onClick={() => {
          setWalletSearch("")
          setWalletPickerOpen(true)
        }}
      >
        Choose Lightning Wallet
      </Button>

      <Button fullWidth onClick={() => { window.location.href = invoiceUri }}>
        Pay with installed Lightning wallet
      </Button>

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

      {status ? (
        <div className="text-center text-xs uppercase tracking-widest text-gray-500">
          {status}
        </div>
      ) : null}

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
