"use client"

import { useCallback, useState } from "react"
import Button from "@/components/ui/Button"
import {
  buildConnectUrl,
  buildSignAndSendUrl,
  clearSolflareSession,
  getStoredSession,
  storePendingPaymentId,
} from "@/lib/solflareDeeplink"

type SolanaAsset = "SOL" | "USDC"
type SolanaWalletId = "phantom" | "solflare"

type SolanaBrowserProvider = {
  isPhantom?: boolean
  isSolflare?: boolean
  publicKey?: { toString: () => string }
  connect: () => Promise<unknown>
  signAndSendTransaction: (transaction: unknown) => Promise<{ signature: string }>
}

type Props = {
  intentId?: string
  selectedAsset?: SolanaAsset
  paymentUrl?: string
  nativeAmount?: number
  usdAmount: number
  paymentId?: string
  walletOptions?: Array<{ id: string; label: string; url?: string; href?: string }>
  onPaymentCreated?: (paymentId: string) => void
  onError?: (error: string) => void
  initialError?: string
}

export default function SolanaWalletPayment({
  intentId,
  selectedAsset = "SOL",
  usdAmount,
  nativeAmount,
  paymentId: directPaymentId,
  onPaymentCreated,
  onError,
  initialError = "",
}: Props) {
  const [openingWallet, setOpeningWallet] = useState<SolanaWalletId | null>(null)
  const [error, setError] = useState(initialError)
  const [resolvedPaymentId, setResolvedPaymentId] = useState<string | null>(
    directPaymentId ?? null
  )

  function getSolanaWindow() {
    return window as Window & {
      solana?: SolanaBrowserProvider
      solflare?: SolanaBrowserProvider
    }
  }

  // Phantom provider only — Solflare uses the deep link flow, not an injected provider
  const getPhantomProvider = useCallback((): SolanaBrowserProvider | null => {
    const w = getSolanaWindow()
    return w.solana?.isPhantom === true ? w.solana : null
  }, [])

  const getPaymentId = useCallback(async (): Promise<string> => {
    if (resolvedPaymentId) return resolvedPaymentId
    if (!intentId) throw new Error("Missing payment ID")

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

    const data = (await res.json()) as { paymentId?: string }
    const id = String(data.paymentId || "").trim()
    if (!id) throw new Error("No payment ID returned")

    setResolvedPaymentId(id)
    onPaymentCreated?.(id)
    return id
  }, [intentId, onPaymentCreated, resolvedPaymentId, selectedAsset])

  // ── Phantom: in-browser provider flow (unchanged) ─────────────────────────

  const handlePhantomClick = useCallback(async () => {
    setError("")
    setOpeningWallet("phantom")
    try {
      const paymentId = await getPaymentId()
      const provider = getPhantomProvider()

      if (!provider) {
        throw new Error("Phantom wallet not found. Please install or unlock Phantom.")
      }

      await provider.connect()

      const walletPublicKey = provider.publicKey?.toString()
      if (!walletPublicKey) {
        throw new Error("Unable to read Phantom wallet public key")
      }

      const res = await fetch("/api/solana/build-wallet-transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, walletPublicKey }),
      })

      const data = (await res.json()) as { transaction?: string; error?: string }

      if (!res.ok || !data?.transaction) {
        throw new Error(data?.error || "Failed to build Solana transaction")
      }

      const { Transaction } = await import("@solana/web3.js")
      const tx = Transaction.from(Buffer.from(data.transaction, "base64"))

      const result = await provider.signAndSendTransaction(tx)

      await fetch(`/api/payments/${encodeURIComponent(paymentId)}/detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: result.signature }),
      }).catch(() => null)

      setError("")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send Solana transaction"
      setError(message)
      onError?.(message)
    } finally {
      setOpeningWallet(null)
    }
  }, [getPaymentId, getPhantomProvider, onError])

  // ── Solflare: Universal Link v1 deep link flow ────────────────────────────
  //
  // Flow A — no existing session:
  //   1. getPaymentId() creates the payment and returns the ID
  //   2. paymentId is saved to sessionStorage (bridges the connect redirect)
  //   3. navigate → Solflare connect URL
  //   4. Solflare redirects back to /pay?...&solflare_action=connect_callback
  //   5. PayClient decrypts connect response, builds tx, navigates to signAndSend
  //   6. Solflare redirects back to /pay?...&solflare_action=sign_callback
  //   7. PayClient decrypts signature, calls /detect, shows processing screen
  //
  // Flow B — session already in sessionStorage:
  //   1. getPaymentId() creates/resolves the payment
  //   2. Build tx via /api/solana/build-wallet-transaction using session.publicKey
  //   3. navigate → Solflare signAndSendTransaction URL
  //   4. Solflare redirects back to /pay?...&solflare_action=sign_callback
  //   5. PayClient handles sign_callback (same as Flow A step 7)

  const handleSolflareDeeplinkClick = useCallback(async () => {
    setError("")
    setOpeningWallet("solflare")

    // Strip stale status/error params from URL before navigating to Solflare
    const currentUrl = new URL(window.location.href)
    currentUrl.searchParams.delete("status")
    currentUrl.searchParams.delete("solflare_error")
    window.history.replaceState({}, "", currentUrl.toString())

    try {
      const paymentId = await getPaymentId()
      const session = getStoredSession()
      const origin = window.location.origin
      const base = `${origin}/pay?intent=${encodeURIComponent(intentId ?? "")}`

      if (!session) {
        // Flow A: no session — start connect
        storePendingPaymentId(paymentId)
        const connectRedirect = `${base}&solflare_action=connect_callback&solflare_asset=${encodeURIComponent(selectedAsset)}`
        console.log("[Solflare] Starting connect deeplink, paymentId:", paymentId)
        await fetch("/api/debug/solflare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stage: "start-connect",
            payload: { paymentId, intentId: intentId ?? null, selectedAsset },
          }),
        }).catch(() => null)
        window.location.href = buildConnectUrl(connectRedirect, origin)
        return // page is navigating away
      }

      // Flow B: session exists — build tx and send signAndSendTransaction deeplink
      const res = await fetch("/api/solana/build-wallet-transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, walletPublicKey: session.publicKey }),
      })
      const txData = (await res.json()) as { transaction?: string; error?: string }
      if (!res.ok || !txData.transaction) {
        // Clear stale session so the next tap starts a fresh connect flow
        clearSolflareSession()
        throw new Error(txData.error || "Failed to build Solana transaction")
      }

      const signRedirect = `${base}&solflare_action=sign_callback&solflare_payment_id=${encodeURIComponent(paymentId)}`
      console.log("[Solflare] Starting signAndSendTransaction deeplink")
      window.location.href = buildSignAndSendUrl(txData.transaction, session, signRedirect)
      // page is navigating away — no finally cleanup needed
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start Solflare payment"
      setError(message)
      onError?.(message)
      setOpeningWallet(null)
    }
  }, [getPaymentId, intentId, selectedAsset, onError])

  // ── Render ────────────────────────────────────────────────────────────────

  const amountDisplay = (
    <div className="bg-gray-50 rounded-xl px-4 py-3 text-center space-y-1">
      {intentId ? (
        <>
          <p className="text-lg font-bold text-gray-900">${usdAmount.toFixed(2)} USD</p>
          <p className="text-xs text-gray-500">via Solana · exact {selectedAsset} determined at payment</p>
        </>
      ) : (
        <>
          <p className="text-lg font-bold text-gray-900">{nativeAmount} SOL</p>
          <p className="text-xs text-gray-500">≈ ${usdAmount.toFixed(2)} USD</p>
        </>
      )}
    </div>
  )

  return (
    <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
      <div className="text-xs uppercase tracking-widest text-gray-500 text-center">
        Pay with {selectedAsset} (Solana)
      </div>
      {amountDisplay}

      {error ? (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          fullWidth
          onClick={() => void handlePhantomClick()}
          disabled={openingWallet !== null}
        >
          {openingWallet === "phantom" ? "Opening..." : "Pay with Phantom"}
        </Button>
        <Button
          variant="secondary"
          fullWidth
          onClick={() => void handleSolflareDeeplinkClick()}
          disabled={openingWallet !== null}
        >
          {openingWallet === "solflare" ? "Opening Solflare..." : "Pay with Solflare"}
        </Button>
      </div>
    </div>
  )
}
