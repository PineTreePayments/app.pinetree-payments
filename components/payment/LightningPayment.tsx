"use client"

import { useCallback, useMemo, useState } from "react"
import Button from "@/components/ui/Button"
import WalletPickerModal, { type WalletPickerSection } from "@/components/payment/WalletPickerModal"

type LightningWallet = {
  id: string
  name: string
  color: string
  iosStoreUrl?: string
  androidStoreUrl?: string
  universalUrl?: string
  schemeBuilder?: (invoiceUri: string) => string
}

const LIGHTNING_WALLETS: LightningWallet[] = [
  {
    id: "cash-app",
    name: "Cash App",
    color: "#00D632",
    iosStoreUrl: "https://apps.apple.com/us/app/cash-app/id711923939",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.squareup.cash",
    universalUrl: "https://cash.app/download",
    schemeBuilder: (invoiceUri) => invoiceUri,
  },
  {
    id: "strike",
    name: "Strike",
    color: "#7C3AED",
    iosStoreUrl: "https://apps.apple.com/us/app/strike-btc-global-money/id1488724463",
    androidStoreUrl: "https://play.google.com/store/search?q=Strike%20Bitcoin&c=apps",
    universalUrl: "https://strike.me/download",
    schemeBuilder: (invoiceUri) => invoiceUri,
  },
  {
    id: "wallet-of-satoshi",
    name: "Wallet of Satoshi",
    color: "#2563EB",
    iosStoreUrl: "https://apps.apple.com/us/search?term=Wallet%20of%20Satoshi",
    androidStoreUrl: "https://play.google.com/store/apps/details?id=com.livingroomofsatoshi.wallet",
    universalUrl: "https://www.walletofsatoshi.com",
    schemeBuilder: (invoiceUri) => invoiceUri,
  },
  {
    id: "muun",
    name: "Muun",
    color: "#F97316",
    iosStoreUrl: "https://apps.apple.com/us/search?term=Muun%20Bitcoin%20Lightning",
    androidStoreUrl: "https://play.google.com/store/search?q=Muun%20Bitcoin%20Lightning&c=apps",
    universalUrl: "https://muun.com",
    schemeBuilder: (invoiceUri) => invoiceUri,
  },
  {
    id: "phoenix",
    name: "Phoenix",
    color: "#F59E0B",
    iosStoreUrl: "https://apps.apple.com/us/search?term=Phoenix%20Wallet%20Bitcoin",
    androidStoreUrl: "https://play.google.com/store/search?q=Phoenix%20Wallet%20Bitcoin&c=apps",
    universalUrl: "https://phoenix.acinq.co",
    schemeBuilder: (invoiceUri) => invoiceUri,
  },
  {
    id: "zeus",
    name: "Zeus",
    color: "#A855F7",
    iosStoreUrl: "https://apps.apple.com/us/app/zeus-wallet/id1456038895",
    androidStoreUrl: "https://play.google.com/store/search?q=ZEUS%20Wallet&c=apps",
    universalUrl: "https://zeusln.app",
    schemeBuilder: (invoiceUri) => invoiceUri,
  },
  {
    id: "breez",
    name: "Breez",
    color: "#06B6D4",
    iosStoreUrl: "https://apps.apple.com/us/search?term=Breez%20Lightning%20Wallet",
    androidStoreUrl: "https://play.google.com/store/search?q=Breez%20Lightning%20Wallet&c=apps",
    universalUrl: "https://breez.technology",
    schemeBuilder: (invoiceUri) => invoiceUri,
  },
  {
    id: "bluewallet",
    name: "BlueWallet",
    color: "#0EA5E9",
    iosStoreUrl: "https://apps.apple.com/us/search?term=BlueWallet",
    androidStoreUrl: "https://play.google.com/store/search?q=BlueWallet&c=apps",
    universalUrl: "https://bluewallet.io",
    schemeBuilder: (invoiceUri) => invoiceUri,
  },
  {
    id: "other",
    name: "Other Lightning Wallet",
    color: "#64748B",
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
}

function normalizeLightningUri(invoice: string): string {
  const normalized = String(invoice || "").trim()
  if (!normalized) return ""
  return normalized.toLowerCase().startsWith("lightning:")
    ? normalized
    : `lightning:${normalized}`
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

function LightningWalletIcon({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="flex h-full w-full items-center justify-center rounded-[18px] ring-1 ring-white/10"
      style={{ background: `linear-gradient(135deg, ${color}, #111827)` }}
    >
      <svg className="h-8 w-8 text-white drop-shadow" viewBox="0 0 24 24" fill="currentColor" role="img" aria-label={`${name} icon`}>
        <path d="M13.8 2.6 4.5 13.2c-.5.6-.1 1.5.7 1.5h5.1l-1.4 6c-.2.9.9 1.4 1.5.7l9.1-10.8c.5-.6.1-1.5-.7-1.5h-5l1.5-5.8c.2-.9-.9-1.4-1.5-.7Z" />
      </svg>
    </span>
  )
}

export default function LightningPayment({
  intentId,
  usdAmount,
  paymentStatus,
  onPaymentCreated,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const [payment, setPayment] = useState<LightningSelectionResult | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [walletPickerOpen, setWalletPickerOpen] = useState(false)
  const [walletSearch, setWalletSearch] = useState("")
  const [pendingWalletId, setPendingWalletId] = useState("")

  const invoice = String(payment?.paymentUrl || "")
  const invoiceUri = useMemo(() => normalizeLightningUri(invoice), [invoice])
  const hasInvoice = Boolean(invoiceUri)
  const status = String(paymentStatus || "").toUpperCase()

  const prepareInvoice = useCallback(async () => {
    setLoading(true)
    setError("")
    setCopied(false)

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

  const openLightningWallet = useCallback((wallet: LightningWallet) => {
    if (!invoiceUri) return

    const targetUrl = wallet.schemeBuilder?.(invoiceUri) || invoiceUri
    setPendingWalletId(wallet.id)
    setWalletPickerOpen(false)

    if (wallet.id === "other") {
      window.location.href = invoiceUri
      window.setTimeout(() => setPendingWalletId(""), 1200)
      return
    }

    const fallbackUrl = getStoreFallbackUrl(wallet)
    const fallbackTimer = window.setTimeout(() => {
      if (fallbackUrl && document.visibilityState === "visible") {
        window.location.href = fallbackUrl
        return
      }
      setPendingWalletId("")
    }, 1400)

    window.addEventListener("pagehide", () => window.clearTimeout(fallbackTimer), { once: true })
    window.location.href = targetUrl
  }, [invoiceUri])

  const walletPickerSections: WalletPickerSection[] = useMemo(() => {
    const query = normalizeWalletName(walletSearch)
    const wallets = LIGHTNING_WALLETS
      .filter((wallet) => !query || normalizeWalletName(wallet.name).includes(query))
      .map((wallet) => ({
        id: wallet.id,
        name: wallet.name,
        icon: <LightningWalletIcon name={wallet.name} color={wallet.color} />,
        badgeLabel: pendingWalletId === wallet.id ? "Opening" : "Open app",
        active: pendingWalletId === wallet.id,
        disabled: Boolean(pendingWalletId),
        spanAll: wallet.id === "other",
        onSelect: () => openLightningWallet(wallet),
      }))

    return [{ title: "Popular", wallets }]
  }, [openLightningWallet, pendingWalletId, walletSearch])

  async function copyInvoice() {
    if (!invoiceUri) return
    await navigator.clipboard.writeText(invoiceUri)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  if (!hasInvoice) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-700">Pay with Bitcoin Lightning</p>
        <p className="text-xs text-gray-500">Use any compatible Lightning wallet.</p>
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        ) : null}
        <Button fullWidth disabled={loading} onClick={() => void prepareInvoice()}>
          {loading
            ? "Preparing invoice..."
            : `Pay with Bitcoin Lightning (${new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
              }).format(usdAmount)})`}
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

      <WalletPickerModal
        open={walletPickerOpen}
        eyebrow="Bitcoin Lightning Wallets"
        title="All Wallets"
        searchValue={walletSearch}
        sections={walletPickerSections}
        onSearchChange={setWalletSearch}
        onClose={() => setWalletPickerOpen(false)}
      />

      <Button variant="secondary" fullWidth onClick={() => void copyInvoice()}>
        {copied ? "Copied" : "Copy Invoice"}
      </Button>

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
