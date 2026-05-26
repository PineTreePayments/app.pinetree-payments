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

// Centralized wallet shortcut config — each entry deep-links into the wallet
// using the POS-owned pairing URI. Add or remove entries here only.
const WALLET_SHORTCUTS: { id: string; label: string; href: (uri: string) => string }[] = [
  { id: "metamask",  label: "MetaMask",        href: (uri) => `https://metamask.app.link/wc?uri=${encodeURIComponent(uri)}` },
  { id: "coinbase",  label: "Coinbase Wallet",  href: (uri) => `https://go.cb-w.com/wc?uri=${encodeURIComponent(uri)}` },
  { id: "trust",     label: "Trust Wallet",     href: (uri) => `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}` },
  { id: "rainbow",   label: "Rainbow",          href: (uri) => `https://rnbwapp.com/wc?uri=${encodeURIComponent(uri)}` },
]

type LauncherModalProps = {
  pairingUri: string
  onClose: () => void
  onWalletClick: () => void
}

function WalletLauncherModal({ pairingUri, onClose, onWalletClick }: LauncherModalProps) {
  const [showQr, setShowQr] = useState(false)
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(pairingUri)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard unavailable in some mobile WebViews
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Bottom sheet */}
      <div className="relative z-10 w-full max-w-md rounded-t-3xl bg-white px-5 pt-4 pb-10 shadow-2xl">
        {/* Drag handle */}
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-gray-200" />

        {/* Header */}
        <div className="mb-5 text-center">
          <p className="text-base font-semibold text-gray-900">Choose your wallet</p>
          <p className="mt-1 text-xs text-gray-500">
            WalletConnect will securely connect your wallet to this PineTree terminal.
          </p>
        </div>

        {/* Wallet list */}
        <div className="mb-4 space-y-2">
          {WALLET_SHORTCUTS.map((w) => (
            <a
              key={w.id}
              href={w.href(pairingUri)}
              onClick={onWalletClick}
              className="flex items-center justify-between rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3.5 text-sm font-semibold text-gray-800 transition-colors hover:border-[#0052FF]/20 hover:bg-[#0052FF]/5 active:bg-[#0052FF]/10"
            >
              <span>{w.label}</span>
              <span className="text-xs font-medium text-[#0052FF]">Open →</span>
            </a>
          ))}
        </div>

        {/* Copy link */}
        <button
          onClick={() => void copyLink()}
          className="mb-2 w-full rounded-xl border border-gray-200 bg-gray-50 py-3 text-sm font-medium text-gray-600 transition-colors hover:border-[#0052FF]/25 hover:text-[#0052FF]"
        >
          {copied ? "✓ Copied to clipboard" : "Copy WalletConnect link"}
        </button>

        {/* QR toggle — for another device only, never the default */}
        <button
          onClick={() => setShowQr((v) => !v)}
          className="w-full py-2 text-xs font-medium text-gray-400 hover:text-gray-600"
        >
          {showQr ? "Hide QR code" : "Use another device / Show QR code"}
        </button>

        {showQr && (
          <div className="mt-3 flex flex-col items-center space-y-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <QRCode
                value={pairingUri}
                size={160}
                bgColor="#ffffff"
                fgColor="#111827"
              />
            </div>
            <p className="px-2 text-center text-xs text-gray-400">
              Open your wallet on another device, tap WalletConnect, then scan.
            </p>
          </div>
        )}

        {/* If no wallet opens */}
        <p className="mt-3 px-2 text-center text-xs text-gray-400">
          If your wallet does not open, choose WalletConnect inside your wallet app and paste the connection link.
        </p>

        {/* Close */}
        <button
          onClick={onClose}
          className="mt-4 w-full py-3 text-sm font-medium text-gray-400 hover:text-gray-600"
        >
          Close
        </button>
      </div>
    </div>
  )
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
  const [showLauncher, setShowLauncher] = useState(false)
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

  // After the customer opens a wallet deep-link, poll immediately so the UI
  // transitions as soon as the POS registers the connection event.
  function handleWalletClick() {
    setShowLauncher(false)
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
        <p className="text-sm text-gray-600">Preparing secure WalletConnect session…</p>
        <p className="text-xs text-gray-400">The payment terminal is getting your wallet connection ready.</p>
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
          <p className="text-sm text-gray-600">Preparing secure WalletConnect session…</p>
          <p className="text-xs text-gray-400">The payment terminal is getting your wallet connection ready.</p>
          <Button variant="danger" fullWidth onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )
    }

    // Pairing URI is ready — primary action is "Connect with WalletConnect"
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="text-center space-y-1">
          <p className="text-base font-semibold text-gray-900">Connect your wallet</p>
          <p className="text-sm text-gray-500">
            Use WalletConnect to connect your wallet securely.
          </p>
        </div>

        {/* Primary action */}
        <Button fullWidth onClick={() => setShowLauncher(true)}>
          Connect with WalletConnect
        </Button>

        {/* Secondary fallbacks */}
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={() => void copyPairingUri(pairingUri)}
            className="text-xs text-gray-400 hover:text-gray-600 font-medium py-1"
          >
            {copiedUri ? "✓ Copied to clipboard" : "Copy connection link"}
          </button>
          <button
            onClick={() => setShowLauncher(true)}
            className="text-xs text-gray-400 hover:text-gray-600 font-medium py-1"
          >
            Trouble connecting?
          </button>
        </div>

        <Button variant="danger" fullWidth onClick={onCancel}>
          Cancel
        </Button>

        {/* WalletConnect-style launcher — opens as a bottom sheet */}
        {showLauncher && (
          <WalletLauncherModal
            pairingUri={pairingUri}
            onClose={() => setShowLauncher(false)}
            onWalletClick={handleWalletClick}
          />
        )}
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
    const isUsdc = session.selectedAsset === "USDC"
    return (
      <div className="space-y-4 text-center py-4">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#0052FF] border-t-transparent mx-auto" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-gray-900">
            {isUsdc ? "Authorize USDC payment in your wallet." : "Approve ETH payment in your wallet."}
          </p>
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
