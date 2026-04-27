"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useWallet, useConnection } from "@solana/wallet-adapter-react"
import { WalletReadyState } from "@solana/wallet-adapter-base"
import type { WalletName } from "@solana/wallet-adapter-base"
import { Transaction } from "@solana/web3.js"
import Image from "next/image"
import Button from "@/components/ui/Button"

// Props support two modes:
//   Intent mode  — provide `intentId`; payment is created when user clicks Pay / opens wallet.
//   Direct mode  — provide `paymentUrl`; payment is already created (POS / legacy QR).
type Props = {
  intentId?: string
  paymentUrl?: string
  nativeAmount?: number
  usdAmount: number
  qrCodeUrl?: string
  paymentId?: string
  onPaymentCreated?: (paymentId: string) => void
  onSuccess?: (txHash: string, paymentId: string) => void
  onError?: (error: string) => void
}

function parsePaymentId(paymentUrl: string): string | null {
  try {
    // Handles: solana:https://app.../api/solana-pay/transaction?paymentId=<id>
    const txUrl = paymentUrl.replace(/^solana:/, "")
    return new URL(txUrl).searchParams.get("paymentId")
  } catch {
    return null
  }
}

function walletIcon(name: string, icon: string | null): string {
  if (icon) return icon
  const n = name.toLowerCase()
  if (n.includes("phantom")) return "👻"
  if (n.includes("solflare")) return "🔥"
  if (n.includes("backpack")) return "🎒"
  return "👛"
}

export default function SolanaWalletPayment({
  intentId,
  paymentUrl: directPaymentUrl,
  nativeAmount,
  usdAmount,
  qrCodeUrl,
  paymentId: directPaymentId,
  onPaymentCreated,
  onSuccess,
  onError,
}: Props) {
  const { connection } = useConnection()
  const {
    wallets,
    wallet,
    select,
    connect,
    disconnect,
    connected,
    publicKey,
    connecting,
    sendTransaction,
  } = useWallet()

  const [showPicker, setShowPicker] = useState(false)
  const [isPaying, setIsPaying] = useState(false)
  const [isOpeningWallet, setIsOpeningWallet] = useState(false)
  const [txSignature, setTxSignature] = useState("")
  const [localError, setLocalError] = useState("")

  const isIntentMode = Boolean(intentId)

  // Tracks a pending connect() after select() updates state
  const pendingConnectRef = useRef(false)

  // Fire connect() once wallet state is updated after select()
  useEffect(() => {
    if (!pendingConnectRef.current || !wallet || connecting || connected) return
    pendingConnectRef.current = false
    connect().catch((err: unknown) => {
      const msg = (err as Error)?.message || "Failed to connect"
      setLocalError(msg.toLowerCase().includes("rejected") ? "Connection rejected." : msg)
    })
  }, [wallet, connecting, connected, connect])

  const handleSelectWallet = useCallback(
    (name: string) => {
      setShowPicker(false)
      setLocalError("")
      pendingConnectRef.current = true
      select(name as WalletName<string>)
    },
    [select]
  )

  // Creates payment and opens the wallet app via Solana Pay v1/pay deep link.
  // Works for both Phantom and Solflare — they both support the v1/pay endpoint.
  const handleDeepLink = useCallback(
    async (walletType: "phantom" | "solflare") => {
      setLocalError("")
      setIsOpeningWallet(true)
      try {
        let resolvedPaymentUrl: string
        let resolvedPaymentId: string

        if (isIntentMode) {
          const res = await fetch(
            `/api/payment-intents/${encodeURIComponent(intentId!)}/select-network`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ network: "solana" }),
            }
          )
          if (!res.ok) {
            const err = (await res.json()) as { error?: string }
            throw new Error(err.error || "Failed to create payment")
          }
          const result = (await res.json()) as { paymentId?: string; paymentUrl?: string }
          resolvedPaymentId = String(result.paymentId || "")
          resolvedPaymentUrl = String(result.paymentUrl || "")
          if (!resolvedPaymentId || !resolvedPaymentUrl) {
            throw new Error("Incomplete payment data returned from server")
          }
          onPaymentCreated?.(resolvedPaymentId)
        } else {
          resolvedPaymentUrl = directPaymentUrl || ""
          resolvedPaymentId = directPaymentId || parsePaymentId(resolvedPaymentUrl) || ""
          if (!resolvedPaymentUrl) throw new Error("No payment URL available")
        }

        // Phantom and Solflare's /ul/v1/pay?link= expects the raw HTTPS transaction
        // request URL — NOT the "solana:" URI wrapper. Strip it before encoding.
        const txRequestUrl = resolvedPaymentUrl.startsWith("solana:")
          ? resolvedPaymentUrl.slice("solana:".length)
          : resolvedPaymentUrl
        const encoded = encodeURIComponent(txRequestUrl)
        const deepLink =
          walletType === "phantom"
            ? `https://phantom.app/ul/v1/pay?link=${encoded}`
            : `https://solflare.com/ul/v1/pay?link=${encoded}`

        window.location.href = deepLink
      } catch (err) {
        const msg = (err as Error)?.message || "Failed to open wallet"
        setLocalError(msg)
        onError?.(msg)
      } finally {
        setIsOpeningWallet(false)
      }
    },
    [isIntentMode, intentId, directPaymentUrl, directPaymentId, onPaymentCreated, onError]
  )

  // Creates payment (intent mode) then builds + sends tx via the wallet adapter.
  const handlePay = useCallback(async () => {
    if (!publicKey) return
    setIsPaying(true)
    setLocalError("")

    try {
      let resolvedPaymentId: string

      if (isIntentMode) {
        // Step 1: create payment
        const createRes = await fetch(
          `/api/payment-intents/${encodeURIComponent(intentId!)}/select-network`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ network: "solana" }),
          }
        )
        if (!createRes.ok) {
          const err = (await createRes.json()) as { error?: string }
          throw new Error(err.error || "Failed to create payment")
        }
        const createResult = (await createRes.json()) as { paymentId?: string }
        resolvedPaymentId = String(createResult.paymentId || "")
        if (!resolvedPaymentId) throw new Error("Missing paymentId from server")
        onPaymentCreated?.(resolvedPaymentId)
      } else {
        resolvedPaymentId =
          directPaymentId || parsePaymentId(directPaymentUrl || "") || ""
        if (!resolvedPaymentId) throw new Error("Cannot determine paymentId")
      }

      // Step 2: build transaction from the payment
      const txRes = await fetch(
        `/api/solana-pay/transaction?paymentId=${encodeURIComponent(resolvedPaymentId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account: publicKey.toBase58() }),
        }
      )
      if (!txRes.ok) {
        const err = (await txRes.json()) as { error?: string }
        throw new Error(err.error || "Failed to build transaction")
      }
      const { transaction: serialized } = (await txRes.json()) as { transaction: string }

      const txBytes = Uint8Array.from(atob(serialized), (c) => c.charCodeAt(0))
      const tx = Transaction.from(txBytes)

      if (!tx.instructions || tx.instructions.length < 3) {
        throw new Error("Invalid transaction: missing split instructions")
      }

      // Step 3: send + confirm
      const signature = await sendTransaction(tx, connection)
      console.log("[SolanaWalletPayment] tx:signature", signature)

      const latestBlockhash = await connection.getLatestBlockhash()
      await connection.confirmTransaction(
        { signature, ...latestBlockhash },
        "confirmed"
      )

      setTxSignature(signature)
      onSuccess?.(signature, resolvedPaymentId)
    } catch (err) {
      const msg = (err as Error)?.message || "Transaction failed"
      const friendly =
        msg.toLowerCase().includes("rejected") || msg.toLowerCase().includes("user rejected")
          ? "Transaction rejected by user."
          : msg
      setLocalError(friendly)
      onError?.(friendly)
    } finally {
      setIsPaying(false)
    }
  }, [
    isIntentMode,
    intentId,
    directPaymentUrl,
    directPaymentId,
    publicKey,
    sendTransaction,
    connection,
    onPaymentCreated,
    onSuccess,
    onError,
  ])

  const readyStateRank = (s: WalletReadyState) =>
    s === WalletReadyState.Installed ? 0
    : s === WalletReadyState.Loadable ? 1
    : s === WalletReadyState.NotDetected ? 2
    : 3

  // Only adapters that can actually connect — NotDetected = never injected on this browser
  const connectableWallets = wallets
    .filter(
      (w) =>
        w.readyState === WalletReadyState.Installed ||
        w.readyState === WalletReadyState.Loadable
    )
    .sort((a, b) => readyStateRank(a.readyState) - readyStateRank(b.readyState))

  // ── Amount display (shared) ────────────────────────────────────────────────

  const amountDisplay = (
    <div className="bg-gray-50 rounded-xl px-4 py-3 text-center space-y-1">
      {isIntentMode ? (
        <>
          <p className="text-lg font-bold text-gray-900">${usdAmount.toFixed(2)} USD</p>
          <p className="text-xs text-gray-500">via Solana · exact SOL determined at payment</p>
        </>
      ) : (
        <>
          <p className="text-lg font-bold text-gray-900">{nativeAmount} SOL</p>
          <p className="text-xs text-gray-500">≈ ${usdAmount.toFixed(2)} USD</p>
        </>
      )}
    </div>
  )

  // QR fallback — only in direct mode and only when a QR URL is provided
  const qrFallback = !isIntentMode && qrCodeUrl ? (
    <details className="group">
      <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 text-center list-none">
        Prefer scanning QR instead?
      </summary>
      <div className="mt-3 flex flex-col items-center space-y-2">
        <div className="text-xs uppercase tracking-widest text-gray-500">
          Open your Solana wallet → Scanner → Scan QR
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-2">
          <Image
            src={qrCodeUrl}
            alt="Scan with a Solana wallet"
            width={168}
            height={168}
            className="rounded-lg"
          />
        </div>
      </div>
    </details>
  ) : null

  // ── Success ────────────────────────────────────────────────────────────────

  if (txSignature) {
    return (
      <div className="space-y-3 text-center py-2">
        <div className="flex justify-center">
          <svg
            className="w-12 h-12 text-green-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <p className="text-sm font-semibold text-gray-900">Transaction Submitted</p>
        <p className="text-xs text-gray-500">Awaiting confirmation on Solana.</p>
        <a
          href={`https://solscan.io/tx/${txSignature}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 underline break-all block"
        >
          View on Solscan ↗
        </a>
      </div>
    )
  }

  // ── Wallet picker ──────────────────────────────────────────────────────────

  if (showPicker) {
    return (
      <div className="space-y-3">
        <p className="text-xs uppercase tracking-widest text-gray-500 text-center">
          Connect a Solana wallet
        </p>
        {connectableWallets.length === 0 ? (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            No wallet extension detected in this browser. Use the &ldquo;Open in Phantom&rdquo;
            or &ldquo;Open in Solflare&rdquo; buttons to pay from your mobile wallet.
          </div>
        ) : (
          <div className="space-y-2">
            {connectableWallets.map((w) => {
              const icon = walletIcon(w.adapter.name, w.adapter.icon || null)
              const isImg = icon.startsWith("http") || icon.startsWith("data:")
              return (
                <button
                  key={w.adapter.name}
                  disabled={connecting}
                  onClick={() => handleSelectWallet(w.adapter.name)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition text-sm font-medium text-gray-900 disabled:opacity-50"
                >
                  {isImg ? (
                    <img src={icon} alt={w.adapter.name} className="w-5 h-5 rounded" />
                  ) : (
                    <span className="text-lg leading-none">{icon}</span>
                  )}
                  {w.adapter.name}
                  {w.readyState === WalletReadyState.Installed ? (
                    <span className="ml-auto text-xs text-green-600">Installed</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        )}
        <Button variant="secondary" fullWidth onClick={() => setShowPicker(false)}>
          Cancel
        </Button>
        {qrFallback}
      </div>
    )
  }

  // ── Connected — ready to pay ───────────────────────────────────────────────

  if (connected && publicKey) {
    return (
      <div className="space-y-3">
        <div className="text-xs uppercase tracking-widest text-gray-500 text-center">
          Pay via Solana
        </div>
        {amountDisplay}
        <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2 break-all font-mono">
          {publicKey.toBase58()}
        </div>
        {localError ? (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            {localError}
          </div>
        ) : null}
        {isPaying ? (
          <Button fullWidth disabled>
            <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
            Waiting for approval in wallet…
          </Button>
        ) : localError ? (
          <Button
            fullWidth
            onClick={() => {
              setLocalError("")
              void handlePay()
            }}
          >
            Retry Payment
          </Button>
        ) : (
          <Button fullWidth onClick={() => void handlePay()}>
            {isIntentMode ? `Pay $${usdAmount.toFixed(2)} USD` : `Pay ${nativeAmount} SOL`}
          </Button>
        )}
        <Button variant="secondary" fullWidth onClick={() => void disconnect()}>
          Disconnect
        </Button>
        {qrFallback}
      </div>
    )
  }

  // ── Not connected — deep links (mobile) + adapter (desktop) ───────────────

  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-widest text-gray-500 text-center">
        Pay via Solana
      </div>
      {amountDisplay}
      {localError ? (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {localError}
        </div>
      ) : null}

      {/* Primary: open wallet with payment pre-filled — works on iOS + Android */}
      <div className="space-y-2">
        <p className="text-xs text-center text-gray-500">Open your wallet to pay:</p>
        {isOpeningWallet ? (
          <Button fullWidth disabled>
            <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
            Preparing payment…
          </Button>
        ) : (
          <>
            <button
              onClick={() => void handleDeepLink("phantom")}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition"
            >
              <span className="text-base leading-none">👻</span>
              Open in Phantom
            </button>
            <button
              onClick={() => void handleDeepLink("solflare")}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition"
            >
              <span className="text-base leading-none">🔥</span>
              Open in Solflare
            </button>
          </>
        )}
      </div>

      {/* Secondary: connect installed wallet extension (desktop / wallet browser) */}
      {connectableWallets.length > 0 ? (
        connecting ? (
          <Button fullWidth disabled>
            <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
            Connecting…
          </Button>
        ) : (
          <Button variant="secondary" fullWidth onClick={() => setShowPicker(true)}>
            Connect wallet extension
          </Button>
        )
      ) : null}

      {qrFallback}
    </div>
  )
}
