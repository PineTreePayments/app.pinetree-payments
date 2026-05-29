"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import QRCode from "react-qr-code"
import Button from "@/components/ui/Button"
import BASE_WALLETS from "@/lib/payment/baseWallets"

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

function isValidPairingUri(uri: string): boolean {
  return uri.startsWith("wc:") && uri.includes("@2")
}

// ─────────────────────────────────────────────────────────────────────────────
// WalletLauncherModal
// Dark bottom sheet that lets the customer pick a wallet deep-link into the
// POS-owned WalletConnect pairing URI. Styled to match WalletPickerModal.
// ─────────────────────────────────────────────────────────────────────────────

type LauncherModalProps = {
  pairingUri: string
  onClose: () => void
  onWalletClick: () => void
}

function WalletLauncherModal({ pairingUri, onClose, onWalletClick }: LauncherModalProps) {
  const [showQr, setShowQr] = useState(false)
  const [copied, setCopied] = useState(false)
  const [search, setSearch] = useState("")

  // Lock body scroll while modal is open (matches WalletPickerModal behaviour)
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    const prevOverflowX = document.body.style.overflowX
    document.body.style.overflow = "hidden"
    document.body.style.overflowX = "hidden"
    return () => {
      document.body.style.overflow = prevOverflow
      document.body.style.overflowX = prevOverflowX
    }
  }, [])

  const enabledWallets = BASE_WALLETS.filter((w) => w.enabled !== false)

  const filtered = search.trim()
    ? enabledWallets.filter((w) =>
        w.label.toLowerCase().includes(search.trim().toLowerCase())
      )
    : enabledWallets

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
    <div
      className="fixed inset-0 z-50 flex w-screen items-end justify-center overflow-hidden bg-black/70 backdrop-blur-md sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-full flex-col overflow-hidden rounded-t-[30px] border border-white/10 bg-[#0b0f17] shadow-2xl shadow-black/60 sm:max-w-[520px] sm:rounded-[30px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="border-b border-white/10 bg-[#0f1420] px-5 pb-4 pt-5 sm:px-6">
          <div className="relative flex items-center justify-center">
            <div className="text-center">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                Base Network
              </p>
              <h2 className="mt-1 text-xl font-bold text-white">Choose your wallet</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center rounded-full bg-white/8 text-slate-300 ring-1 ring-white/10 transition hover:bg-white/12 hover:text-white"
              aria-label="Close wallet picker"
            >
              ✕
            </button>
          </div>

          {/* Search */}
          <div className="relative mt-5">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-500">
              ⌕
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search wallets"
              className="h-12 w-full rounded-2xl border border-white/10 bg-[#171d28] px-4 pl-10 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#3b82f6]/70 focus:ring-2 focus:ring-[#0052FF]/20"
            />
          </div>
        </div>

        {/* ── Scrollable content ── */}
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5 pb-[calc(env(safe-area-inset-bottom)+24px)] sm:px-6">

          {/* Wallet grid */}
          {filtered.length > 0 ? (
            <div className="space-y-3">
              <p className="px-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                Base-compatible wallets
              </p>
            <div className="grid grid-cols-2 gap-2 min-[360px]:grid-cols-3 sm:grid-cols-4 sm:gap-3">
              {filtered.map((w) => (
                <a
                  key={w.id}
                  href={w.href(pairingUri)}
                  onClick={onWalletClick}
                  className="group flex min-h-[130px] w-full flex-col items-center justify-between overflow-hidden rounded-[22px] border border-white/10 bg-[#151922] px-2 py-3 text-center shadow-[0_14px_34px_rgba(0,0,0,0.22)] transition-all hover:-translate-y-0.5 hover:border-[#3b82f6]/55 hover:bg-[#1b2330] hover:shadow-[0_18px_44px_rgba(0,82,255,0.18)] sm:min-h-[136px] sm:px-2.5"
                >
                  <span className="flex flex-col items-center gap-2">
                    <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-[18px] bg-[#0f172a] shadow-[0_12px_28px_rgba(0,0,0,0.28)] ring-1 ring-white/15 transition group-hover:scale-[1.03]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={w.iconPath}
                        alt=""
                        className="h-full w-full rounded-[18px] object-contain p-1.5"
                      />
                    </span>
                    <span className="line-clamp-2 min-h-[34px] w-full text-xs font-semibold leading-tight text-white sm:text-sm">
                      {w.label}
                    </span>
                  </span>
                  <span className="max-w-full truncate rounded-full bg-[#0052FF]/18 px-2 py-1 text-[10px] font-semibold text-blue-200 ring-1 ring-blue-300/15">
                    Open →
                  </span>
                </a>
              ))}
            </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-400 ring-1 ring-white/10">
              No wallets match your search.
            </div>
          )}

          {/* Copy WalletConnect link — low-priority fallback inside modal only */}
          <button
            onClick={() => void copyLink()}
            className="w-full rounded-2xl border border-white/10 bg-[#151922] py-3.5 text-sm font-medium text-slate-300 transition hover:border-[#3b82f6]/40 hover:text-white"
          >
            {copied ? "✓ Copied to clipboard" : "Copy WalletConnect link"}
          </button>

          {/* QR toggle — secondary, for scanning from another device only */}
          <button
            onClick={() => setShowQr((v) => !v)}
            className="w-full py-2 text-xs font-medium text-slate-500 hover:text-slate-300"
          >
            {showQr ? "Hide QR code" : "Use another device / Show QR code"}
          </button>

          {showQr && (
            <div className="flex flex-col items-center space-y-3">
              <div className="rounded-2xl border border-white/10 bg-white p-4 shadow-sm">
                <QRCode value={pairingUri} size={160} bgColor="#ffffff" fgColor="#111827" />
              </div>
              <p className="px-2 text-center text-xs text-slate-400">
                Open your wallet on another device, tap WalletConnect, then scan.
              </p>
            </div>
          )}

          <p className="px-2 text-center text-xs text-slate-500">
            If your wallet does not open, choose WalletConnect inside your wallet app and paste
            the connection link.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BasePosCheckoutMirror
// Customer-facing component for POS-created Base payments.
// The POS terminal owns the WalletConnect session; this component mirrors
// the POS session state and provides the wallet deep-link launcher.
// ─────────────────────────────────────────────────────────────────────────────

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
  const [showLauncher, setShowLauncher] = useState(false)
  // burstUntil: epoch ms until which we poll at 1s (activated after tapping Connect)
  const [burstUntil, setBurstUntil] = useState(0)
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

  // pairingReady switches from false → true exactly once; drives interval switching
  const pairingReady = !!(session?.pairingUri && isValidPairingUri(session.pairingUri))

  // Dynamic polling:
  //   1s — pairingUri not yet available (fast catch-up while POS generates URI)
  //   1s — within 30s burst window after customer taps Connect (detect wallet ASAP)
  //   3s — steady state
  useEffect(() => {
    if (!paymentReady) return
    const isBurst = Date.now() < burstUntil
    const ms = !pairingReady || isBurst ? 1000 : 3000
    void pollSession()
    const timer = setInterval(() => void pollSession(), ms)
    return () => clearInterval(timer)
  }, [paymentReady, pollSession, pairingReady, burstUntil])

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

  // Open the launcher and enable burst polling for 30s so the UI transitions
  // as soon as the POS registers the wallet connection event.
  function handleConnectTapped() {
    setBurstUntil(Date.now() + 30_000)
    setShowLauncher(true)
    void pollSession()
    setTimeout(() => setBurstUntil(0), 30_000)
  }

  // After the customer taps a wallet deep-link, poll immediately and close modal
  function handleWalletClick() {
    setShowLauncher(false)
    void pollSession()
  }

  // ── Error state ─────────────────────────────────────────────────────────────

  if (selectNetworkError) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {selectNetworkError}
        </div>
        <Button variant="danger" fullWidth onClick={onCancel}>
          Cancel
        </Button>
      </div>
    )
  }

  // ── Waiting for payment to be created ───────────────────────────────────────

  if (!paymentReady || !session) {
    return (
      <div className="space-y-4 py-4 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#0052FF] border-t-transparent" />
        <p className="text-sm text-gray-600">Preparing secure WalletConnect session…</p>
        <p className="text-xs text-gray-400">
          The payment terminal is getting your wallet connection ready.
        </p>
      </div>
    )
  }

  const { step, pairingUri } = session

  // ── Awaiting wallet connection ───────────────────────────────────────────────

  if (!step || step === "awaiting_wallet") {

    // Spinner while POS is still generating the pairing URI
    if (!pairingUri || !isValidPairingUri(pairingUri)) {
      return (
        <div className="space-y-4 py-4 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#0052FF] border-t-transparent" />
          <p className="text-sm text-gray-600">Preparing secure WalletConnect session…</p>
          <p className="text-xs text-gray-400">
            The payment terminal is getting your wallet connection ready.
          </p>
          <Button variant="danger" fullWidth onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )
    }

    // Pairing URI ready — clean card: title, Connect button, Cancel only
    return (
      <div className="space-y-4">
        <div className="space-y-1 text-center">
          <p className="text-base font-semibold text-gray-900">Connect your wallet</p>
          <p className="text-sm text-gray-500">
            Open your wallet app and approve the connection.
          </p>
        </div>

        <Button fullWidth onClick={handleConnectTapped}>
          Connect with WalletConnect
        </Button>

        <Button variant="danger" fullWidth onClick={onCancel}>
          Cancel
        </Button>

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

  // ── Wallet connected — POS is preparing the transaction request ─────────────

  if (step === "wallet_connected") {
    return (
      <div className="space-y-4 py-4 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
          <span className="text-xl font-bold text-green-600">✓</span>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-gray-900">Wallet connected.</p>
          <p className="text-sm text-gray-600">Follow the approval prompt in your wallet.</p>
        </div>
        {session.walletAddressMasked && (
          <p className="font-mono text-xs text-gray-400">{session.walletAddressMasked}</p>
        )}
      </div>
    )
  }

  // ── Transaction approval requested ──────────────────────────────────────────

  if (step === "payment_sending") {
    const isUsdc = session.selectedAsset === "USDC"
    return (
      <div className="space-y-4 py-4 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#0052FF] border-t-transparent" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-gray-900">
            {isUsdc
              ? "Authorize USDC payment in your wallet."
              : "Approve ETH payment in your wallet."}
          </p>
          <p className="text-sm text-gray-600">Please approve the transaction in your wallet.</p>
        </div>
      </div>
    )
  }

  // ── Submitted / confirming on-chain ─────────────────────────────────────────

  if (step === "payment_submitted" || step === "confirming") {
    return (
      <div className="space-y-4 py-4 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#0052FF] border-t-transparent" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-gray-900">
            Payment submitted. Confirming on Base.
          </p>
          <p className="text-sm text-gray-600">This usually takes a few seconds.</p>
        </div>
      </div>
    )
  }

  // ── Failed ──────────────────────────────────────────────────────────────────

  if (step === "failed") {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
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
    <div className="space-y-4 py-4 text-center">
      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[#0052FF] border-t-transparent" />
      <p className="text-sm text-gray-600">Processing payment…</p>
    </div>
  )
}
