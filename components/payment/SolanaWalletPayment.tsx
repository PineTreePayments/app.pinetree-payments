"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useWallet, useConnection } from "@solana/wallet-adapter-react"
import { WalletReadyState } from "@solana/wallet-adapter-base"
import type { WalletName } from "@solana/wallet-adapter-base"
import { Transaction } from "@solana/web3.js"
import Image from "next/image"
import Button from "@/components/ui/Button"

type Props = {
  paymentUrl: string    // solana:https://.../transaction?paymentId=<id>
  nativeAmount: number  // display only
  usdAmount: number     // display only
  qrCodeUrl?: string    // fallback QR (always preserved)
  onSuccess?: (signature: string) => void
  onError?: (error: string) => void
}

function parsePaymentId(paymentUrl: string): string | null {
  try {
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
  paymentUrl,
  nativeAmount,
  usdAmount,
  qrCodeUrl,
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
  const [txSignature, setTxSignature] = useState("")
  const [localError, setLocalError] = useState("")

  // Tracks a pending connect() after select() updates state
  const pendingConnectRef = useRef(false)

  const paymentId = parsePaymentId(paymentUrl)

  // Fire connect() once the wallet state is updated after select()
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

  const handlePay = useCallback(async () => {
    if (!publicKey || !paymentId) return
    setIsPaying(true)
    setLocalError("")

    try {
      const res = await fetch(
        `/api/solana-pay/transaction?paymentId=${encodeURIComponent(paymentId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account: publicKey.toBase58() }),
        }
      )

      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error || "Failed to build transaction")
      }

      const { transaction: serialized } = (await res.json()) as { transaction: string }

      // Decode base64 → Uint8Array without Buffer (browser-safe)
      const txBytes = Uint8Array.from(atob(serialized), (c) => c.charCodeAt(0))
      const tx = Transaction.from(txBytes)

      if (!tx.instructions || tx.instructions.length < 3) {
        throw new Error("Invalid transaction: missing split instructions")
      }

      const signature = await sendTransaction(tx, connection)
      console.log("SOLANA TX SIGNATURE:", signature)

      const latestBlockhash = await connection.getLatestBlockhash()
      await connection.confirmTransaction(
        { signature, ...latestBlockhash },
        "confirmed"
      )

      setTxSignature(signature)
      onSuccess?.(signature)
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
  }, [publicKey, paymentId, sendTransaction, connection, onSuccess, onError])

  // Wallets to show: exclude Unsupported, sort Installed first
  const readyStateRank = (s: WalletReadyState) =>
    s === WalletReadyState.Installed ? 0
    : s === WalletReadyState.Loadable ? 1
    : s === WalletReadyState.NotDetected ? 2
    : 3

  const availableWallets = wallets
    .filter((w) => w.readyState !== WalletReadyState.Unsupported)
    .sort((a, b) => readyStateRank(a.readyState) - readyStateRank(b.readyState))

  // ── Amount display (shared) ────────────────────────────────────────────────

  const amountDisplay = (
    <div className="bg-gray-50 rounded-xl px-4 py-3 text-center space-y-1">
      <p className="text-lg font-bold text-gray-900">{nativeAmount} SOL</p>
      <p className="text-xs text-gray-500">≈ ${usdAmount.toFixed(2)} USD</p>
    </div>
  )

  // ── QR fallback (always preserved) ────────────────────────────────────────

  const qrFallback = qrCodeUrl ? (
    <details className="group">
      <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 text-center list-none">
        Prefer scanning QR instead?
      </summary>
      <div className="mt-3 flex flex-col items-center space-y-2">
        <div className="text-xs uppercase tracking-widest text-gray-500">
          Open Phantom → Scanner → Scan QR
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-2">
          <Image
            src={qrCodeUrl}
            alt="Scan with Phantom mobile"
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
        {availableWallets.length === 0 ? (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            No Solana wallets detected. Install{" "}
            <a href="https://phantom.app" target="_blank" rel="noopener noreferrer" className="underline">Phantom</a>
            {" "}or{" "}
            <a href="https://solflare.com" target="_blank" rel="noopener noreferrer" className="underline">Solflare</a>
            {" "}in your browser, then refresh.
          </div>
        ) : (
          <div className="space-y-2">
            {availableWallets.map((w) => {
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
            Pay {nativeAmount} SOL
          </Button>
        )}
        <Button variant="secondary" fullWidth onClick={() => void disconnect()}>
          Disconnect
        </Button>
        {qrFallback}
      </div>
    )
  }

  // ── Not connected — connect button + QR always visible ────────────────────

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
      {connecting ? (
        <Button fullWidth disabled>
          <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
          Connecting…
        </Button>
      ) : (
        <Button fullWidth onClick={() => setShowPicker(true)}>
          Connect Solana Wallet
        </Button>
      )}
      {qrCodeUrl ? (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-widest text-gray-500 text-center">
            Or scan with Phantom mobile
          </div>
          <div className="flex flex-col items-center">
            <div className="bg-white border border-gray-200 rounded-xl p-2">
              <Image
                src={qrCodeUrl}
                alt="Scan with Phantom mobile"
                width={168}
                height={168}
                className="rounded-lg"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Open Phantom → Scanner → Scan QR
            </p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
