"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import QRCode from "react-qr-code"
import Button from "@/components/ui/Button"

type PosBaseStep =
  | "awaiting_wallet"
  | "wallet_connected"
  | "payment_sending"
  | "payment_submitted"
  | "confirming"
  | "failed"

type PosBaseSession = {
  controller: "pos_terminal"
  pairingUri?: string
  selectedAsset?: "ETH" | "USDC"
  step?: PosBaseStep
  walletAddressMasked?: string
  txHash?: string
  errorMessage?: string
  updatedAt: number
}

type Props = {
  intentId: string
  selectedAsset: "ETH" | "USDC"
  usdAmount: number
  checkoutToken: string
  onExecutionStarted?: () => void
  onCancel?: () => void
  onPaymentCreated?: () => void
}

const POLL_INTERVAL_MS = 3000

function isValidPairingUri(uri: string): boolean {
  return uri.startsWith("wc:") && uri.includes("@2")
}

// Wallet shortcuts — each opens the POS-owned WalletConnect pairing URI
// directly in the respective wallet app. These are secondary to the QR code
// (which is the primary WalletConnect connection path).
type WalletShortcut = { id: string; label: string; href: string }

function buildWalletShortcuts(pairingUri: string): WalletShortcut[] {
  const encoded = encodeURIComponent(pairingUri)
  return [
    { id: "metamask",  label: "MetaMask",        href: `https://metamask.app.link/wc?uri=${encoded}` },
    { id: "coinbase",  label: "Coinbase Wallet",  href: `https://go.cb-w.com/wc?uri=${encoded}` },
    { id: "trust",     label: "Trust Wallet",     href: `https://link.trustwallet.com/wc?uri=${encoded}` },
    { id: "rainbow",   label: "Rainbow",          href: `https://rnbwapp.com/wc?uri=${encoded}` },
  ]
}

export default function BasePosCheckoutMirror({
  intentId,
  selectedAsset,
  checkoutToken,
  onExecutionStarted,
  onCancel,
  onPaymentCreated,
}: Props) {
  const [session, setSession] = useState<PosBaseSession | null>(null)
  const [selectNetworkError, setSelectNetworkError] = useState("")
  const [paymentReady, setPaymentReady] = useState(false)
  const [copiedUri, setCopiedUri] = useState(false)
  const selectCalledRef = useRef(false)
  const executionStartedRef = useRef(false)

  // Create the payment record by calling select-network on mount
  useEffect(() => {
    if (selectCalledRef.current) return
    selectCalledRef.current = true

    const run = async () => {
      try {
        const res = await fetch(
          `/api/payment-intents/${encodeURIComponent(intentId)}/select-network`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${checkoutToken}`,
            },
            body: JSON.stringify({ network: "base", asset: selectedAsset }),
          }
        )
        if (!res.ok) {
          const err = (await res.json()) as { error?: string }
          throw new Error(err.error || "Failed to prepare Base payment")
        }
        setPaymentReady(true)
        onPaymentCreated?.()
      } catch (err) {
        setSelectNetworkError(
          err instanceof Error ? err.message : "Failed to prepare payment"
        )
      }
    }

    void run()
  }, [intentId, selectedAsset, checkoutToken, onPaymentCreated])

  // Poll the POS-owned session for the pairing URI and status updates
  const pollSession = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/pos/base-session/${encodeURIComponent(intentId)}`,
        { cache: "no-store" }
      )
      if (!res.ok) return
      const data = (await res.json()) as { session: PosBaseSession | null }
      if (data.session) setSession(data.session)
    } catch {
      // best-effort — ignore transient errors
    }
  }, [intentId])

  useEffect(() => {
    if (!paymentReady) return
    void pollSession()
    const interval = setInterval(() => void pollSession(), POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [paymentReady, pollSession])

  // Notify parent when the POS enters active execution (wallet connected or beyond)
  useEffect(() => {
    if (executionStartedRef.current) return
    const step = session?.step
    if (
      step === "wallet_connected" ||
      step === "payment_sending" ||
      step === "payment_submitted" ||
      step === "confirming"
    ) {
      executionStartedRef.current = true
      onExecutionStarted?.()
    }
  }, [session?.step, onExecutionStarted])

  // After the customer taps a wallet shortcut, poll immediately so the UI
  // transitions as soon as the POS registers the connection event.
  function handleShortcutClick() {
    void pollSession()
  }

  async function copyPairingUri(uri: string) {
    try {
      await navigator.clipboard.writeText(uri)
      setCopiedUri(true)
      setTimeout(() => setCopiedUri(false), 2000)
    } catch {
      // silently ignore — clipboard unavailable in some mobile WebViews
    }
  }

  // ── Error state ─────────────────────────────────────────────────────────────

  if (selectNetworkError) {
    return (
      <div className="space-y-3">
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {selectNetworkError}
        </div>
        <Button variant="danger" fullWidth onClick={onCancel}>
          Cancel
        </Button>
      </div>
    )
  }

  // ── Waiting for session to be created ───────────────────────────────────────

  if (!paymentReady || !session) {
    return (
      <div className="space-y-4 text-center py-4">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#0052FF] border-t-transparent mx-auto" />
        <p className="text-sm text-gray-600">Preparing secure wallet connection from the payment terminal…</p>
      </div>
    )
  }

  const { step, pairingUri } = session

  // ── Awaiting wallet connection ───────────────────────────────────────────────

  if (!step || step === "awaiting_wallet") {

    // Spinner while the POS is still generating the pairing URI
    if (!pairingUri || !isValidPairingUri(pairingUri)) {
      return (
        <div className="space-y-4 text-center py-4">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#0052FF] border-t-transparent mx-auto" />
          <p className="text-sm text-gray-600">Preparing secure wallet connection from the payment terminal…</p>
          <Button variant="danger" fullWidth onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )
    }

    const shortcuts = buildWalletShortcuts(pairingUri)

    // ── WalletConnect-style connection panel ─────────────────────────────────
    // Layout matches the standard WalletConnect modal experience:
    //   • QR code is the centerpiece — scan with any WC-compatible wallet
    //   • Wallet app shortcuts below for mobile users (one tap to open + pair)
    //   • Copy link at the bottom for manual paste into any wallet
    return (
      <div className="space-y-4">

        {/* Header */}
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold text-gray-900">Connect via WalletConnect</p>
          <p className="text-xs text-gray-500">
            Scan with any WalletConnect-compatible wallet app.
          </p>
        </div>

        {/* QR code — primary connection path, shown by default */}
        <div className="flex justify-center">
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
            <QRCode
              value={pairingUri}
              size={176}
              bgColor="#ffffff"
              fgColor="#111827"
            />
          </div>
        </div>

        {/* QR scanning instruction */}
        <p className="text-center text-xs text-gray-400 px-2">
          Open your wallet, tap WalletConnect, then scan this code.
        </p>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-100" />
          <span className="text-xs text-gray-400 font-medium whitespace-nowrap">Or open a wallet directly</span>
          <div className="flex-1 h-px bg-gray-100" />
        </div>

        {/* Wallet shortcuts — 2 × 2 compact grid */}
        <div className="grid grid-cols-2 gap-2">
          {shortcuts.map((w) => (
            <a
              key={w.id}
              href={w.href}
              onClick={handleShortcutClick}
              className="flex items-center justify-center rounded-xl border border-[#0052FF]/15 bg-white px-3 py-2.5 text-xs font-semibold text-gray-800 shadow-sm transition-all hover:border-[#0052FF]/35 hover:bg-[#0052FF]/5"
            >
              {w.label}
            </a>
          ))}
        </div>

        {/* Copy pairing URI — manual fallback */}
        <button
          onClick={() => void copyPairingUri(pairingUri)}
          className="w-full text-center text-xs text-gray-400 hover:text-gray-600 font-medium py-1"
        >
          {copiedUri ? "✓ Copied to clipboard" : "Copy connection link"}
        </button>

        <Button variant="danger" fullWidth onClick={onCancel}>
          Cancel
        </Button>
      </div>
    )
  }

  // ── Wallet connected — POS is sending the transaction request ───────────────

  if (step === "wallet_connected") {
    return (
      <div className="space-y-4 text-center py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 mx-auto">
          <span className="text-green-600 text-xl font-bold">✓</span>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-gray-900">Wallet connected.</p>
          <p className="text-sm text-gray-600">Follow the approval prompt in your wallet.</p>
        </div>
        {session.walletAddressMasked && (
          <p className="text-xs text-gray-400 font-mono">{session.walletAddressMasked}</p>
        )}
      </div>
    )
  }

  // ── Transaction approval requested ──────────────────────────────────────────

  if (step === "payment_sending") {
    return (
      <div className="space-y-4 text-center py-4">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#0052FF] border-t-transparent mx-auto" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-gray-900">Approval requested in your wallet.</p>
          <p className="text-sm text-gray-600">Please approve the transaction in your wallet.</p>
        </div>
      </div>
    )
  }

  // ── Submitted / confirming on-chain ─────────────────────────────────────────

  if (step === "payment_submitted" || step === "confirming") {
    return (
      <div className="space-y-4 text-center py-4">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#0052FF] border-t-transparent mx-auto" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-gray-900">Payment submitted. Confirming on Base.</p>
          <p className="text-sm text-gray-600">This usually takes a few seconds.</p>
        </div>
      </div>
    )
  }

  // ── Failed ──────────────────────────────────────────────────────────────────

  if (step === "failed") {
    return (
      <div className="space-y-3">
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {session.errorMessage || "Payment could not be completed. Please try again."}
        </div>
        <Button variant="danger" fullWidth onClick={onCancel}>
          Try Again
        </Button>
      </div>
    )
  }

  // ── Fallback spinner ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 text-center py-4">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#0052FF] border-t-transparent mx-auto" />
      <p className="text-sm text-gray-600">Processing payment…</p>
    </div>
  )
}
