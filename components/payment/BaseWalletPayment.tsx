"use client"

import { useState, useCallback } from "react"
import Button from "@/components/ui/Button"

const BASE_CHAIN_ID = "0x2105" // 8453 decimal

type Props = {
  paymentUrl: string    // ethereum:0xContract@8453?value=X&data=0xCalldata
  nativeAmount: number  // total ETH (display only)
  usdAmount: number     // total USD (display only)
  onSuccess?: (txHash: string) => void
  onError?: (error: string) => void
}

type Step = "idle" | "connecting" | "switching" | "connected" | "paying" | "success" | "error"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseEthereumUrl(url: string): { to: `0x${string}`; value: string; data: string } | null {
  try {
    const withoutPrefix = url.replace(/^ethereum:/, "")
    const [addressPart, queryString] = withoutPrefix.split("?")
    const [to] = (addressPart || "").split("@")
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) return null
    const params = new URLSearchParams(queryString || "")
    const decimalValue = params.get("value") || "0"
    const hexValue = "0x" + BigInt(decimalValue).toString(16)
    const data = params.get("data") || "0x"
    return { to: to as `0x${string}`, value: hexValue, data }
  } catch {
    return null
  }
}

function getEthereum(): Record<string, (...args: unknown[]) => Promise<unknown>> | null {
  if (typeof window === "undefined") return null
  const eth = (window as unknown as { ethereum?: unknown }).ethereum
  if (!eth || typeof eth !== "object") return null
  return eth as Record<string, (...args: unknown[]) => Promise<unknown>>
}

function detectWalletName(): string {
  const eth = getEthereum() as Record<string, unknown> | null
  if (!eth) return "Wallet"
  if (eth.isCoinbaseWallet) return "Coinbase Wallet"
  if (eth.isMetaMask) return "MetaMask"
  return "Wallet"
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BaseWalletPayment({ paymentUrl, nativeAmount, usdAmount, onSuccess, onError }: Props) {
  const [step, setStep] = useState<Step>("idle")
  const [account, setAccount] = useState<string>("")
  const [txHash, setTxHash] = useState<string>("")
  const [errorMsg, setErrorMsg] = useState<string>("")

  const walletName = detectWalletName()
  const hasProvider = Boolean(getEthereum())

  const handleError = useCallback((msg: string) => {
    setErrorMsg(msg)
    setStep("error")
    onError?.(msg)
  }, [onError])

  // ── Connect + switch chain ─────────────────────────────────────────────────

  async function connect() {
    const eth = getEthereum()
    if (!eth) {
      handleError("No wallet detected. Install MetaMask or Coinbase Wallet.")
      return
    }

    setStep("connecting")
    setErrorMsg("")

    try {
      const accounts = await eth.request({ method: "eth_requestAccounts" }) as string[]
      if (!Array.isArray(accounts) || !accounts[0]) throw new Error("No account returned from wallet")
      setAccount(accounts[0])

      setStep("switching")
      const chainId = await eth.request({ method: "eth_chainId" }) as string
      if (chainId !== BASE_CHAIN_ID) {
        try {
          await eth.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: BASE_CHAIN_ID }]
          })
        } catch (switchErr) {
          const code = (switchErr as { code?: number })?.code
          if (code === 4902) {
            // Base not in wallet yet — add it
            await eth.request({
              method: "wallet_addEthereumChain",
              params: [{
                chainId: BASE_CHAIN_ID,
                chainName: "Base",
                nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
                rpcUrls: ["https://mainnet.base.org"],
                blockExplorerUrls: ["https://basescan.org"]
              }]
            })
          } else {
            throw switchErr
          }
        }
      }

      setStep("connected")
    } catch (err) {
      const raw = (err as { message?: string })?.message ?? "Failed to connect"
      handleError(raw.toLowerCase().includes("rejected") ? "Connection rejected by user." : raw)
    }
  }

  // ── Execute contract call ──────────────────────────────────────────────────

  /**
   * executeBasePayment — calls split() on the PineTreeSplit contract.
   *
   * The backend (generateSplitPayment.ts) already ABI-encodes the split() calldata
   * into the paymentUrl. We parse it here and send the transaction directly,
   * which is equivalent to:
   *
   *   writeContract({
   *     address: splitContract,
   *     abi: SPLIT_ABI,
   *     functionName: "split",
   *     args: [merchant, treasury, merchantAmountWei, feeAmountWei, paymentRef],
   *     value: totalWei
   *   })
   */
  async function executeBasePayment() {
    const eth = getEthereum()
    if (!eth || !account) return

    const parsed = parseEthereumUrl(paymentUrl)
    if (!parsed) {
      handleError("Cannot decode payment URL. Please contact support.")
      return
    }

    if (!parsed.data || parsed.data === "0x") {
      handleError("Missing calldata — contract call will fail. Please contact support.")
      return
    }

    setStep("paying")

    try {
      const hash = await eth.request({
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: parsed.to,
          value: parsed.value,
          data: parsed.data
        }]
      }) as string

      setTxHash(hash)
      setStep("success")
      onSuccess?.(hash)
    } catch (err) {
      const raw = (err as { message?: string })?.message ?? "Transaction failed"
      handleError(raw.toLowerCase().includes("rejected") ? "Transaction rejected by user." : raw)
    }
  }

  function reset() {
    setStep("idle")
    setAccount("")
    setTxHash("")
    setErrorMsg("")
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (step === "success") {
    return (
      <div className="space-y-3 text-center py-2">
        <div className="flex justify-center">
          <svg className="w-12 h-12 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-gray-900">Transaction Submitted</p>
        <p className="text-xs text-gray-500">Awaiting confirmation on Base — this usually takes 5–30 seconds.</p>
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

  if (step === "error") {
    return (
      <div className="space-y-3">
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {errorMsg}
        </div>
        <Button fullWidth onClick={reset}>Try Again</Button>
      </div>
    )
  }

  const isSpinning = step === "connecting" || step === "switching" || step === "paying"

  const spinnerLabel =
    step === "connecting" ? "Connecting to wallet…" :
    step === "switching"  ? "Switching to Base network…" :
    step === "paying"     ? "Waiting for confirmation in wallet…" :
    ""

  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-widest text-gray-500 text-center">
        Pay via Base Network
      </div>

      <div className="bg-gray-50 rounded-xl px-4 py-3 text-center space-y-1">
        <p className="text-lg font-bold text-gray-900">{nativeAmount} ETH</p>
        <p className="text-xs text-gray-500">≈ ${usdAmount.toFixed(2)} USD</p>
      </div>

      {!hasProvider ? (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          No wallet detected. Install{" "}
          <a href="https://metamask.io" target="_blank" rel="noopener noreferrer" className="underline">MetaMask</a>
          {" "}or{" "}
          <a href="https://www.coinbase.com/wallet" target="_blank" rel="noopener noreferrer" className="underline">Coinbase Wallet</a>
          {" "}in your browser.
        </div>
      ) : null}

      {isSpinning ? (
        <Button fullWidth disabled>
          <span className="inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin mr-2" />
          {spinnerLabel}
        </Button>
      ) : null}

      {step === "idle" ? (
        <Button fullWidth onClick={connect} disabled={!hasProvider}>
          Connect Wallet
        </Button>
      ) : null}

      {step === "connected" ? (
        <div className="space-y-2">
          <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2 break-all font-mono">
            {account}
          </div>
          <Button fullWidth onClick={executeBasePayment}>
            Pay {nativeAmount} ETH with {walletName}
          </Button>
          <Button variant="secondary" fullWidth onClick={reset}>
            Disconnect
          </Button>
        </div>
      ) : null}
    </div>
  )
}
