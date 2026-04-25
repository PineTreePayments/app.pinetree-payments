"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSwitchChain,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi"
import { base } from "wagmi/chains"
import { parseAbi, decodeFunctionData } from "viem"
import Button from "@/components/ui/Button"

const SPLIT_ABI = parseAbi([
  "function split(address merchant, address treasury, uint256 merchantAmountWei, uint256 feeAmountWei, string paymentRef) payable",
])

type Props = {
  paymentUrl: string    // ethereum:0xContract@8453?value=<wei>&data=0x<calldata>
  nativeAmount: number  // display only
  usdAmount: number     // display only
  onSuccess?: (txHash: string) => void
  onError?: (error: string) => void
}

function parseEthereumUrl(url: string): {
  to: `0x${string}`
  value: bigint
  data: `0x${string}`
} | null {
  try {
    const withoutPrefix = url.replace(/^ethereum:/, "")
    const [addressPart, queryString] = withoutPrefix.split("?")
    const [to] = (addressPart || "").split("@")
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) return null
    const params = new URLSearchParams(queryString || "")
    const decimalValue = params.get("value") || "0"
    const data = (params.get("data") || "0x") as `0x${string}`
    return { to: to as `0x${string}`, value: BigInt(decimalValue), data }
  } catch {
    return null
  }
}

function connectorIcon(name: string): string {
  const n = name.toLowerCase()
  if (n.includes("metamask")) return "🦊"
  if (n.includes("coinbase")) return "🔵"
  if (n.includes("walletconnect")) return "🔗"
  return "👛"
}

export default function BaseWalletPayment({
  paymentUrl,
  nativeAmount,
  usdAmount,
  onSuccess,
  onError,
}: Props) {
  const { address, chain, isConnected } = useAccount()
  const { connectors, connect, status: connectStatus } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain, status: switchStatus } = useSwitchChain()
  const {
    writeContract,
    data: txHash,
    status: writeStatus,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract()
  const { status: receiptStatus } = useWaitForTransactionReceipt({
    hash: txHash,
    query: { enabled: Boolean(txHash) },
  })

  const [showPicker, setShowPicker] = useState(false)
  const [localError, setLocalError] = useState("")

  const parsed = useMemo(() => parseEthereumUrl(paymentUrl), [paymentUrl])

  const isOnBase = chain?.id === base.id
  const isConnecting = connectStatus === "pending"
  const isSwitching = switchStatus === "pending"
  const isPaying = writeStatus === "pending"
  const isSubmitted = writeStatus === "success"
  const isConfirmed = isSubmitted && receiptStatus === "success"

  useEffect(() => {
    if (isSubmitted && txHash) {
      onSuccess?.(txHash)
    }
  }, [isSubmitted, txHash, onSuccess])

  useEffect(() => {
    if (!writeError) return
    const msg = writeError.message || "Transaction failed"
    const friendly = msg.toLowerCase().includes("rejected")
      ? "Transaction rejected by user."
      : msg
    setLocalError(friendly)
    onError?.(friendly)
  }, [writeError, onError])

  const handlePay = useCallback(() => {
    if (!parsed) {
      setLocalError("Cannot decode payment URL. Please contact support.")
      return
    }
    if (!parsed.data || parsed.data === "0x") {
      setLocalError("Missing calldata — contract call will fail. Please contact support.")
      return
    }
    setLocalError("")
    try {
      const { args } = decodeFunctionData({ abi: SPLIT_ABI, data: parsed.data })
      writeContract({
        address: parsed.to,
        abi: SPLIT_ABI,
        functionName: "split",
        args: args as [`0x${string}`, `0x${string}`, bigint, bigint, string],
        value: parsed.value,
        chainId: base.id,
      })
    } catch (err) {
      const msg = (err as Error).message || "Failed to encode transaction"
      setLocalError(msg)
      onError?.(msg)
    }
  }, [parsed, writeContract, onError])

  // ── Success ────────────────────────────────────────────────────────────────

  if (isSubmitted) {
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
        <p className="text-sm font-semibold text-gray-900">
          {isConfirmed ? "Payment Confirmed" : "Transaction Submitted"}
        </p>
        <p className="text-xs text-gray-500">
          {isConfirmed
            ? "Your payment was confirmed on Base."
            : "Awaiting on-chain confirmation — usually 5–30 seconds."}
        </p>
        {txHash ? (
          <a
            href={`https://basescan.org/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 underline break-all block"
          >
            View on Basescan ↗
          </a>
        ) : null}
      </div>
    )
  }

  // ── Amount display (shared across states) ─────────────────────────────────

  const amountDisplay = (
    <div className="bg-gray-50 rounded-xl px-4 py-3 text-center space-y-1">
      <p className="text-lg font-bold text-gray-900">{nativeAmount} ETH</p>
      <p className="text-xs text-gray-500">≈ ${usdAmount.toFixed(2)} USD</p>
    </div>
  )

  // ── Wallet picker ──────────────────────────────────────────────────────────

  if (showPicker) {
    return (
      <div className="space-y-3">
        <p className="text-xs uppercase tracking-widest text-gray-500 text-center">
          Connect a wallet
        </p>
        <div className="space-y-2">
          {connectors.map((connector) => (
            <button
              key={connector.uid}
              disabled={isConnecting}
              onClick={() => {
                connect({ connector })
                setShowPicker(false)
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition text-sm font-medium text-gray-900 disabled:opacity-50"
            >
              <span className="text-lg leading-none">{connectorIcon(connector.name)}</span>
              {connector.name}
              {connector.name.toLowerCase().includes("walletconnect") ? (
                <span className="ml-auto text-xs text-gray-400">Scan QR</span>
              ) : null}
            </button>
          ))}
        </div>
        <Button variant="secondary" fullWidth onClick={() => setShowPicker(false)}>
          Cancel
        </Button>
      </div>
    )
  }

  // ── Not connected ──────────────────────────────────────────────────────────

  if (!isConnected) {
    return (
      <div className="space-y-3">
        <div className="text-xs uppercase tracking-widest text-gray-500 text-center">
          Pay via Base Network
        </div>
        {amountDisplay}
        {isConnecting ? (
          <Button fullWidth disabled>
            <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
            Connecting…
          </Button>
        ) : (
          <Button fullWidth onClick={() => setShowPicker(true)}>
            Connect Wallet
          </Button>
        )}
      </div>
    )
  }

  // ── Wrong chain ────────────────────────────────────────────────────────────

  if (!isOnBase) {
    return (
      <div className="space-y-3">
        <div className="text-xs uppercase tracking-widest text-gray-500 text-center">
          Pay via Base Network
        </div>
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          Your wallet is on the wrong network. Switch to Base to continue.
        </div>
        {isSwitching ? (
          <Button fullWidth disabled>
            <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
            Switching to Base…
          </Button>
        ) : (
          <Button fullWidth onClick={() => switchChain({ chainId: base.id })}>
            Switch to Base Network
          </Button>
        )}
        <Button variant="secondary" fullWidth onClick={() => disconnect()}>
          Disconnect
        </Button>
      </div>
    )
  }

  // ── Connected on Base — ready to pay ──────────────────────────────────────

  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-widest text-gray-500 text-center">
        Pay via Base Network
      </div>
      {amountDisplay}
      <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2 break-all font-mono">
        {address}
      </div>
      {localError ? (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {localError}
        </div>
      ) : null}
      {isPaying ? (
        <Button fullWidth disabled>
          <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
          Waiting for confirmation in wallet…
        </Button>
      ) : localError ? (
        <Button
          fullWidth
          onClick={() => {
            setLocalError("")
            resetWrite()
            handlePay()
          }}
        >
          Retry Payment
        </Button>
      ) : (
        <Button fullWidth onClick={handlePay}>
          Pay {nativeAmount} ETH
        </Button>
      )}
      <Button variant="secondary" fullWidth onClick={() => disconnect()}>
        Disconnect
      </Button>
    </div>
  )
}
