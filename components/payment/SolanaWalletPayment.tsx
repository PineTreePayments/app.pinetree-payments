"use client"

import { useCallback, useEffect, useState } from "react"
import Button from "@/components/ui/Button"
import { PaymentStatusVisual } from "@/components/payment/PaymentStatusVisual"
import {
  getDetectedSolanaWallets,
  getSolanaProviderPublicKey,
  getSolanaTransactionSignature,
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

const TERMINAL_PAYMENT_STATUSES = new Set(["CONFIRMED", "FAILED", "INCOMPLETE", "EXPIRED", "CANCELED"])

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
  const [execStage, setExecStage] = useState<SolanaExecutionStage>("idle")
  const [error, setError] = useState(initialError)
  const [paymentData, setPaymentData] = useState<PaymentData | null>(() => {
    const paymentId = String(directPaymentId || parsePaymentIdFromUrl(directPaymentUrl)).trim()
    const paymentUrl = String(directPaymentUrl || "").trim()
    return paymentId || paymentUrl ? { paymentId, paymentUrl } : null
  })

  const terminalStatus = normalizeTerminalStatus(paymentStatus)
  const refreshWallets = useCallback(() => {
    const detected = getDetectedSolanaWallets()
    setWallets(detected)
    setSelectedWalletId((current) => {
      if (current && detected.some((wallet) => wallet.id === current)) return current
      return detected[0]?.id || ""
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
    }
  }, [getPaymentData, onError, onExecutionStarted, onPaymentCreated])

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

      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#EAF2FF] via-white to-[#DCEBFF] p-[1px] shadow-sm shadow-[#0052FF]/10">
        <div className="pointer-events-none absolute -right-16 -top-20 h-40 w-40 rounded-full bg-[#0052FF]/15 blur-3xl" />
        <div className="relative bg-white/95 rounded-3xl overflow-hidden ring-1 ring-white/80">
        <div className="px-4 pt-4 pb-3 space-y-2.5">
          {renderStep("Wallet selection", "active", wallets.length ? "Choose an installed Solana wallet" : "No installed Solana wallet detected")}
          {renderStep("Confirm payment", "upcoming")}
          {renderStep("Network confirmation", "upcoming")}
        </div>

        <div className="mx-4 mb-4 space-y-2">
          {wallets.map((wallet) => (
            <div
              key={wallet.id}
              className={`w-full rounded-2xl border px-3.5 py-3 text-left transition-all ${
                selectedWalletId === wallet.id
                  ? "border-[#0052FF]/30 bg-[#0052FF]/5"
                  : "border-gray-200 bg-white hover:bg-gray-50"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{wallet.name}</p>
                  <p className="text-xs text-gray-500">
                    {wallet.source === "wallet-standard" ? "Wallet Standard detected" : "Installed wallet detected"}
                  </p>
                </div>
                <span className={`h-3 w-3 rounded-full border ${
                  selectedWalletId === wallet.id ? "border-[#0052FF] bg-[#0052FF]" : "border-gray-300"
                }`} />
              </div>
              <Button
                fullWidth
                className="mt-3"
                onClick={() => void startPayment(wallet)}
              >
                Pay with this wallet
              </Button>
            </div>
          ))}

          {wallets.length === 0 ? (
            <div className="rounded-2xl bg-gray-50 ring-1 ring-gray-100 px-4 py-3 text-xs text-gray-600 leading-relaxed">
              No Solana wallet detected. Open this checkout on a device with Phantom, Solflare, Backpack, or another Solana wallet installed.
            </div>
          ) : null}
        </div>
        </div>
      </div>

      {wallets.length === 0 ? (
        <Button fullWidth variant="secondary" onClick={refreshWallets}>
          Refresh Wallets
        </Button>
      ) : null}
    </div>
  )
}
