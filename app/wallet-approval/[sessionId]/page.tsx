"use client"

/**
 * PineTree Wallet Approval Page
 *
 * Opened on the merchant's phone after scanning the QR from the POS/desktop.
 * Shows the exact wallet app the merchant registered for this rail.
 * Only the correct wallet type is offered — no generic picker, no wrong-wallet path.
 *
 * Supported flows:
 *   Base / MetaMask / Trust  — wallet-specific deep link opens this page in the
 *                              wallet's in-app browser; window.ethereum is injected;
 *                              connect → validate address + chain → eth_sendTransaction
 *   Phantom                  — Phantom Universal Link v1 (connect → signAndSendTransaction)
 *   Solflare                 — Solflare Universal Link v1 (connect → signAndSendTransaction)
 *
 * Activity is only recorded AFTER a real tx_hash (Base) or signature (Solana).
 *
 * ?debug=1  — shows a compact developer debug panel (never shown by default).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import {
  buildPhantomConnectUrl,
  buildPhantomSignTransactionUrl,
  decryptPhantomConnectResponse,
  decryptPhantomSignResponse,
  decryptPhantomSignedTransaction,
  getStoredPhantomSession,
  storePhantomSession,
  clearPhantomSession,
  type PhantomSession,
} from "@/lib/wallets/phantomDeeplink"
import {
  buildConnectUrl as buildSolflareConnectUrl,
  buildSignAndSendUrl as buildSolflareSignAndSendUrl,
  decryptConnectResponse as decryptSolflareConnectResponse,
  decryptSignResponse as decryptSolflareSignResponse,
  getStoredSession as getSolflareStoredSession,
  storeSession as storeSolflareSession,
  clearSolflareSession,
  type SolflareSession,
} from "@/lib/solflareDeeplink"
import { PaymentStatusVisual } from "@/components/payment/PaymentStatusVisual"

// ── Types ─────────────────────────────────────────────────────────────────────

// Canonical names: base_wallet, trust_wallet.  Legacy aliases (base, trust) are
// accepted when reading sessions created before the rename so old QR links still work.
type WalletType = "base_wallet" | "base" | "metamask" | "trust_wallet" | "trust" | "phantom" | "solflare"

type SessionData = {
  id: string
  rail: string
  wallet_type: string
  wallet_address: string
  asset: string
  network: string
  destination_address: string
  destination_label: string | null
  amount: string
  prepared_payload: {
    tx_params?: {
      from: string
      to: string
      value: string
      data: string
      gas: string
      chainId?: string
    }
    unsigned_tx_base64?: string
    destination_kind?: string
  }
  status: string
  tx_hash: string | null
  signature: string | null
  error: string | null
  expires_at: string
}

type PageStatus =
  | "loading"
  | "ready"
  | "in_wallet_browser"
  | "connecting"
  | "validating"
  | "signing"
  | "recording"
  | "submitted"
  | "confirmed"
  | "rejected"
  | "failed"
  | "expired"
  | "not_found"
  // Wallet connected — waiting for user tap to open transaction signing deeplink
  | "phantom_connected"
  | "solflare_connected"

type Eip1193Provider = {
  isCoinbaseWallet?: boolean
  isBaseWallet?: boolean
  isMetaMask?: boolean
  isTrust?: boolean
  isTrustWallet?: boolean
  providers?: Eip1193Provider[]
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

const BASE_CHAIN_ID_HEX = "0x2105"
const BASE_CHAIN_ID_DEC = "8453"
const BASE_RPC_URL =
  process.env.NEXT_PUBLIC_BASE_RPC_URL ||
  process.env.NEXT_PUBLIC_BASE_MAINNET_RPC_URL ||
  "https://mainnet.base.org"

// ── Helpers ───────────────────────────────────────────────────────────────────

function walletDisplayName(type: WalletType | string): string {
  if (type === "base_wallet" || type === "base") return "Base Wallet"
  if (type === "metamask")                       return "MetaMask"
  if (type === "trust_wallet" || type === "trust") return "Trust Wallet"
  if (type === "phantom")  return "Phantom"
  if (type === "solflare") return "Solflare"
  return "Wallet"
}

function normalizeWalletType(type: WalletType | string): WalletType {
  if (type === "base") return "base_wallet"
  if (type === "trust") return "trust_wallet"
  return type as WalletType
}

function isEvmWalletType(type: WalletType | string): boolean {
  return ["base_wallet", "base", "metamask", "trust_wallet", "trust"].includes(type)
}

function getAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (typeof window === "undefined") return "https://app.pinetree-payments.com"
  return window.location.origin
}

function normalizeAddress(addr: string): string {
  return String(addr || "").trim().toLowerCase()
}

function formatShortAddress(addr: string): string {
  const t = addr.trim()
  if (t.length <= 14) return t
  return `${t.slice(0, 6)}...${t.slice(-4)}`
}

function formatNetworkName(network: string): string {
  const value = String(network || "").toLowerCase()
  if (value === "solana") return "Solana"
  if (value === "base") return "Base"
  if (value === "ethereum") return "Ethereum"
  return network ? network.charAt(0).toUpperCase() + network.slice(1) : ""
}

function formatAssetSymbol(asset: string): string {
  return String(asset || "").toUpperCase()
}

function formatExpiry(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return "Expired"
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

function ApprovalStatusIcon({ tone }: { tone: "success" | "error" | "processing" }) {
  const classes =
    tone === "success"
      ? "bg-emerald-50 text-emerald-600 ring-emerald-100"
      : tone === "error"
        ? "bg-red-50 text-red-600 ring-red-100"
        : "bg-[#0052FF]/5 text-[#0052FF] ring-[#0052FF]/10"

  return (
    <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ring-8 ${classes}`}>
      {tone === "success" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : tone === "error" ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 8v5" />
          <path d="M12 17h.01" />
          <path d="M10.3 4.4 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0Z" />
        </svg>
      ) : (
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
    </div>
  )
}

function ApprovalDetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-gray-100 bg-gray-50/70 px-3.5 py-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">{label}</span>
      <span className={`min-w-0 truncate text-right text-sm font-semibold text-gray-900 ${mono ? "font-mono" : ""}`} title={value}>
        {value}
      </span>
    </div>
  )
}

function ApprovalOutcomeCard({
  tone,
  title,
  message,
  detail,
  primaryAction,
  secondaryAction
}: {
  tone: "success" | "error"
  title: string
  message: string
  detail?: string
  primaryAction?: { label: string; onClick: () => void }
  secondaryAction?: { label: string; onClick: () => void }
}) {
  return (
    <div className="text-center">
      <ApprovalStatusIcon tone={tone} />
      <p className="mt-5 text-xl font-bold tracking-tight text-gray-950">{title}</p>
      <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-gray-600">{message}</p>
      {detail && (
        <p className={`mt-3 rounded-2xl border px-3.5 py-3 text-left text-xs leading-5 ${tone === "success" ? "border-emerald-100 bg-emerald-50/70 text-emerald-800" : "border-red-100 bg-red-50/70 text-red-700"}`}>
          {detail}
        </p>
      )}
      {(primaryAction || secondaryAction) && (
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          {primaryAction && (
            <button
              type="button"
              onClick={primaryAction.onClick}
              className="inline-flex min-h-12 flex-1 items-center justify-center rounded-2xl bg-[#0052FF] px-5 py-3 text-sm font-bold text-white shadow-sm shadow-[#0052FF]/25 transition hover:bg-[#003FCC] active:scale-[0.98]"
            >
              {primaryAction.label}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              className="inline-flex min-h-12 flex-1 items-center justify-center rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-gray-300 hover:bg-gray-50"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Resolve the wallet-specific in-app browser deep link for Base-family wallets. */
function buildEvmWalletBrowserDeepLink(walletType: WalletType, targetUrl: string): string {
  const encoded = encodeURIComponent(targetUrl)
  if (walletType === "base_wallet" || walletType === "base") {
    return `https://go.cb-w.com/dapp?cb_url=${encoded}`
  }
  if (walletType === "metamask") {
    const urlObj = new URL(targetUrl)
    const path = urlObj.hostname + urlObj.pathname + urlObj.search
    return `https://metamask.app.link/dapp/${path}`
  }
  if (walletType === "trust_wallet" || walletType === "trust") {
    return `https://link.trustwallet.com/open_url?coin_id=60&url=${encoded}`
  }
  return targetUrl
}

function buildEvmWalletBrowserFallbackDeepLink(walletType: WalletType, targetUrl: string): string | null {
  const encoded = encodeURIComponent(targetUrl)
  if (walletType === "base_wallet" || walletType === "base") {
    return `cbwallet://dapp?url=${encoded}`
  }
  return null
}

function getEvmProviders(): Eip1193Provider[] {
  if (typeof window === "undefined") return []
  const eth = (window as Window & { ethereum?: Eip1193Provider }).ethereum
  if (!eth) return []
  return Array.isArray(eth.providers) && eth.providers.length > 0 ? eth.providers : [eth]
}

function describeEvmProvider(provider: Eip1193Provider | null): string {
  if (!provider) return "none"
  if (provider.isCoinbaseWallet || provider.isBaseWallet) return "base_wallet"
  if (provider.isMetaMask) return "metamask"
  if (provider.isTrust || provider.isTrustWallet) return "trust_wallet"
  return "unknown"
}

function devLog(label: string, data: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") return
  console.debug(`[wallet-approval:evm] ${label}`, data)
}

/** Pick the injected EVM provider that matches the expected wallet type.
 *  Falls back to the only available provider when wallet-specific flags are
 *  absent — address validation in signWithEvmWallet catches wrong accounts. */
function getMatchingEvmProvider(walletType: WalletType): Eip1193Provider | null {
  const normalized = normalizeWalletType(walletType)
  const providers = getEvmProviders()
  if (providers.length === 0) return null

  if (normalized === "base_wallet") {
    const specific = providers.find((p) => p.isCoinbaseWallet || p.isBaseWallet)
    if (specific) return specific
    if (providers.length === 1) return providers[0]
    return null
  }
  if (normalized === "metamask") {
    const specific = providers.find((p) => p.isMetaMask && !p.isCoinbaseWallet)
    if (specific) return specific
    if (providers.length === 1) return providers[0]
    return null
  }
  if (normalized === "trust_wallet") {
    const specific = providers.find((p) => p.isTrust || p.isTrustWallet)
    if (specific) return specific
    if (providers.length === 1) return providers[0]
    return null
  }
  return null
}

/**
 * Wait up to `timeoutMs` for the EVM provider to be injected.
 * Mobile wallet in-app browsers may inject window.ethereum several hundred
 * milliseconds after DOMContentLoaded; failing immediately produces false-negatives.
 */
async function waitForEvmProvider(
  walletType: WalletType,
  timeoutMs = 8000
): Promise<Eip1193Provider | null> {
  const step = 150
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const p = getMatchingEvmProvider(walletType)
    if (p) return p
    await new Promise((r) => setTimeout(r, step))
  }
  return null
}

async function ensureBaseChain(provider: Eip1193Provider): Promise<{ before: string; after: string }> {
  const before = String(await provider.request({ method: "eth_chainId" }).catch(() => ""))
  if (before.toLowerCase() === BASE_CHAIN_ID_HEX || before === BASE_CHAIN_ID_DEC) {
    return { before, after: before }
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_CHAIN_ID_HEX }],
    })
  } catch (switchErr) {
    const code = Number((switchErr as { code?: number })?.code)
    if (code !== 4902) throw switchErr

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: BASE_CHAIN_ID_HEX,
        chainName: "Base",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: [BASE_RPC_URL],
        blockExplorerUrls: ["https://basescan.org"],
      }],
    })
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_CHAIN_ID_HEX }],
    })
  }

  const after = String(await provider.request({ method: "eth_chainId" }).catch(() => ""))
  if (after.toLowerCase() !== BASE_CHAIN_ID_HEX && after !== BASE_CHAIN_ID_DEC) {
    throw new Error("Wallet is not on Base network. Switch to Base in your wallet settings and try again.")
  }
  return { before, after }
}

/** Check if we're running inside the target EVM wallet's in-app browser. */
function isInsideEvmWalletBrowser(walletType: WalletType): boolean {
  return getMatchingEvmProvider(walletType) !== null
}

/** Check if we're running inside Phantom's in-app browser. */
function isInsidePhantomBrowser(): boolean {
  if (typeof window === "undefined") return false
  const w = window as Window & { phantom?: { solana?: { isPhantom?: boolean } } }
  return Boolean(w.phantom?.solana?.isPhantom)
}

/** Check if we're running inside Solflare's in-app browser. */
function isInsideSolflareBrowser(): boolean {
  if (typeof window === "undefined") return false
  const w = window as Window & { solflare?: { isSolflare?: boolean } }
  return Boolean(w.solflare?.isSolflare)
}

// ── PATCH session status helper ────────────────────────────────────────────────

async function patchSessionStatus(sessionId: string, status: string, error?: string) {
  try {
    await fetch(`/api/wallets/send-sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...(error ? { error } : {}) }),
    })
  } catch {
    // Non-critical — desktop poll will detect the final submitted/failed state
  }
}

// ── POST complete session helper ───────────────────────────────────────────────

async function completeSession(
  sessionId: string,
  params: { tx_hash?: string; signature?: string; signed_tx?: string }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/wallets/send-sessions/${sessionId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    })
    const data = await res.json().catch(() => null) as { success?: boolean; error?: string } | null
    if (!res.ok || !data?.success) {
      return { ok: false, error: data?.error || "Failed to complete session" }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" }
  }
}

// ── Refresh Solana unsigned tx helper ─────────────────────────────────────────

/**
 * Rebuilds the unsigned Solana transaction with a fresh blockhash.
 * Must be called before building the Phantom/Solflare sign URL because
 * blockhashes expire after ~75 seconds and the connect→sign round trip
 * can easily take longer.
 */
async function refreshUnsignedTx(sessionId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/wallets/send-sessions/${sessionId}/refresh-tx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })
    const data = await res.json().catch(() => null) as { success?: boolean; unsigned_tx_base64?: string; error?: string } | null
    if (!res.ok || !data?.success || !data.unsigned_tx_base64) {
      console.debug("[refresh-tx] failed", { sessionId, error: data?.error, status: res.status })
      return null
    }
    return data.unsigned_tx_base64
  } catch (err) {
    console.debug("[refresh-tx] network error", { sessionId, err })
    return null
  }
}

// ── Debug panel helpers ────────────────────────────────────────────────────────

function getDebugProviderFlags(): Record<string, unknown> {
  if (typeof window === "undefined") return {}
  const eth = (window as Window & { ethereum?: Eip1193Provider }).ethereum
  if (!eth) return { hasEthereum: false }
  const providers: Eip1193Provider[] =
    Array.isArray(eth.providers) && eth.providers.length > 0 ? eth.providers : [eth]
  return {
    hasEthereum: true,
    providerCount: providers.length,
    isCoinbaseWallet: providers.some((p) => p.isCoinbaseWallet),
    isBaseWallet: providers.some((p) => p.isBaseWallet),
    isMetaMask: providers.some((p) => p.isMetaMask),
    isTrust: providers.some((p) => p.isTrust || p.isTrustWallet),
  }
}

async function getDebugChainId(walletType: WalletType): Promise<string> {
  try {
    const p = getMatchingEvmProvider(walletType)
    if (!p) return "provider not found"
    const id = await p.request({ method: "eth_chainId" })
    return String(id)
  } catch {
    return "error"
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function WalletApprovalPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const [sessionId, setSessionId] = useState<string>("")
  const [session, setSession] = useState<SessionData | null>(null)
  const [pageStatus, setPageStatus] = useState<PageStatus>("loading")
  const [statusMessage, setStatusMessage] = useState<string>("")
  const [expiryDisplay, setExpiryDisplay] = useState<string>("")
  // Pending sign URLs stored after connect so the user taps a button to open
  // the transaction deeplink — iOS Universal Links require a real user gesture.
  const [pendingPhantomSignUrl, setPendingPhantomSignUrl] = useState<string>("")
  const [pendingSolflareSignUrl, setPendingSolflareSignUrl] = useState<string>("")
  const expiryRef = useRef<NodeJS.Timeout | null>(null)
  const signingRef = useRef(false)

  // Debug panel (activated by ?debug=1)
  const [debugMode, setDebugMode] = useState(false)
  const [debugInfo, setDebugInfo] = useState<Record<string, unknown>>({})
  const [debugChainId, setDebugChainId] = useState<string>("")
  const [lastStep, setLastStep] = useState<string>("")

  // Resolve params
  useEffect(() => {
    params.then(({ sessionId: sid }) => setSessionId(sid))
  }, [params])

  // Check debug mode from URL
  useEffect(() => {
    if (typeof window === "undefined") return
    const isDebug = new URLSearchParams(window.location.search).get("debug") === "1"
    setDebugMode(isDebug)
    if (isDebug) {
      setDebugInfo(getDebugProviderFlags())
    }
  }, [])

  // Expiry countdown
  useEffect(() => {
    if (!session?.expires_at) return
    expiryRef.current = setInterval(() => {
      setExpiryDisplay(formatExpiry(session.expires_at))
    }, 1000)
    setExpiryDisplay(formatExpiry(session.expires_at))
    return () => { if (expiryRef.current) clearInterval(expiryRef.current) }
  }, [session?.expires_at])

  // Track last step for debug panel
  useEffect(() => {
    setLastStep(pageStatus)
    if (debugMode) {
      setDebugInfo(getDebugProviderFlags())
    }
  }, [pageStatus, debugMode])

  // ── Load session + handle deeplink callbacks ─────────────────────────────────

  const handlePhantomCallback = useCallback(async (
    searchParams: URLSearchParams,
    loadedSession: SessionData
  ) => {
    const action = searchParams.get("phantom_action")
    if (!action) return false

    const sid = loadedSession.id
    const appUrl = getAppUrl()
    const baseRedirect = `${appUrl}/wallet-approval/${sid}`

    console.debug("[Phantom callback]", {
      action,
      paramNames: Array.from(searchParams.keys()),
      hasEncPubKey: searchParams.has("phantom_encryption_public_key"),
      hasData: searchParams.has("data"),
      hasNonce: searchParams.has("nonce"),
      hasErrorCode: searchParams.has("errorCode"),
      hasErrorMessage: searchParams.has("errorMessage"),
      hasDappKeypair: (() => { try { return localStorage.getItem(`pinetree_ph_keypair_${sid}`) !== null } catch { return false } })(),
      hasPhantomSession: getStoredPhantomSession(sid) !== null,
      sessionId: sid,
    })

    const errCode = searchParams.get("errorCode")
    const errMsg = searchParams.get("errorMessage") || ""
    if (errCode || errMsg) {
      const isUserRejection =
        String(errCode) === "4001" ||
        errMsg.toLowerCase().includes("reject") ||
        errMsg.toLowerCase().includes("cancel") ||
        errMsg.toLowerCase().includes("declined") ||
        errMsg.toLowerCase().includes("denied")
      if (isUserRejection) {
        setStatusMessage(`Transaction rejected in Phantom.${errMsg ? ` (${errMsg})` : ""}`)
        setPageStatus("rejected")
        await patchSessionStatus(sid, "rejected", `Phantom rejected: ${errMsg || errCode}`)
      } else {
        const detail = errMsg || `error code ${errCode || "unknown"}`
        setStatusMessage(
          `Phantom returned an error: ${detail}. Tap "Try Again" to restart the approval.`
        )
        setPageStatus("failed")
        await patchSessionStatus(sid, "failed", `Phantom error: ${detail}`)
      }
      clearPhantomSession(sid)
      return true
    }

    if (action === "connect") {
      const paramNames = Array.from(searchParams.keys())
      const hasEncPubKey = searchParams.has("phantom_encryption_public_key")
      const hasData = searchParams.has("data")
      const hasNonce = searchParams.has("nonce")

      if (!hasEncPubKey || !hasData || !hasNonce) {
        const missing = (
          [!hasEncPubKey && "phantom_encryption_public_key", !hasData && "data", !hasNonce && "nonce"] as (string | false)[]
        ).filter(Boolean) as string[]
        console.debug("[Phantom connect] missing params:", missing, "available:", paramNames)
        setStatusMessage(
          "Phantom returned to PineTree, but PineTree could not decrypt the approval response. " +
          "This usually means the browser lost the approval keypair or Phantom returned an unexpected payload. " +
          `(Missing: ${missing.join(", ")})`
        )
        setPageStatus("failed")
        return true
      }

      const phantomSession = decryptPhantomConnectResponse(sid, searchParams)
      if (!phantomSession) {
        const hasDappKeypair = (() => { try { return localStorage.getItem(`pinetree_ph_keypair_${sid}`) !== null } catch { return false } })()
        console.debug("[Phantom connect decrypt failed]", { hasDappKeypair, sessionId: sid })
        setStatusMessage(
          "Phantom returned to PineTree, but PineTree could not decrypt the approval response. " +
          "This usually means the browser lost the approval keypair or Phantom returned an unexpected payload."
        )
        setPageStatus("failed")
        return true
      }

      // Validate public key matches merchant wallet address
      if (normalizeAddress(phantomSession.publicKey) !== normalizeAddress(loadedSession.wallet_address)) {
        clearPhantomSession(sid)
        setStatusMessage("Connected wallet does not match the merchant wallet saved for this rail.")
        setPageStatus("failed")
        await patchSessionStatus(sid, "failed", "Phantom public key mismatch")
        return true
      }

      storePhantomSession(sid, phantomSession)
      patchSessionStatus(sid, "wallet_connected").catch(() => {})

      // ── Refresh the unsigned tx with a fresh blockhash before signing ──────────
      // Solana blockhashes expire after ~75 seconds. The tx was built at
      // prepare_direct time; the connect round-trip easily takes 60-90+ seconds.
      setStatusMessage("Refreshing transaction...")
      const freshTxBase64 = await refreshUnsignedTx(sid)
      // Use the fresh tx if available; fall back to the one stored in the session.
      const txBase64 = freshTxBase64 || loadedSession.prepared_payload.unsigned_tx_base64

      if (!txBase64) {
        setStatusMessage("Missing prepared transaction data. Please start a new send from the desktop.")
        setPageStatus("failed")
        await patchSessionStatus(sid, "failed", "Missing unsigned_tx_base64 after refresh")
        return true
      }

      if (!freshTxBase64) {
        console.debug("[Phantom connect] refresh-tx failed — using original tx (may have expired blockhash)", { sessionId: sid })
      }

      console.debug("[Phantom connect] building signAndSend URL", {
        sessionId: sid,
        hasTx: Boolean(txBase64),
        txLength: txBase64.length,
        usedFreshTx: Boolean(freshTxBase64),
        redirectBase: baseRedirect,
      })

      // Use signTransaction (not signAndSendTransaction) — Phantom returns the
      // signed transaction bytes and PineTree submits to RPC server-side.
      // This avoids the "This method is not supported" error seen with
      // signAndSendTransaction on older Phantom mobile builds.
      const signUrl = buildPhantomSignTransactionUrl(
        sid,
        txBase64,
        phantomSession,
        `${baseRedirect}?phantom_action=sign`
      )
      patchSessionStatus(sid, "approval_requested").catch(() => {})
      setPendingPhantomSignUrl(signUrl)
      setStatusMessage("")
      setPageStatus("phantom_connected")
      return true
    }

    if (action === "sign") {
      const phantomSession = getStoredPhantomSession(sid)
      if (!phantomSession) {
        console.debug("[Phantom sign] session not found in localStorage", { sessionId: sid })
        setStatusMessage("Phantom session not found. Please start the approval again.")
        setPageStatus("failed")
        await patchSessionStatus(sid, "failed", "Phantom session lost after sign redirect")
        return true
      }

      // signTransaction path: Phantom returns the signed transaction bytes.
      // PineTree submits them to Solana RPC server-side via the /complete endpoint.
      const signedTx = decryptPhantomSignedTransaction(sid, searchParams, phantomSession.phPublicKey)

      // signAndSendTransaction fallback path (kept for backward compatibility
      // with any existing sessions or future Phantom update that re-enables it).
      const signature = !signedTx
        ? decryptPhantomSignResponse(sid, searchParams, phantomSession.phPublicKey)
        : null

      if (!signedTx && !signature) {
        console.debug("[Phantom sign decrypt failed]", {
          sessionId: sid,
          hasData: searchParams.has("data"),
          hasNonce: searchParams.has("nonce"),
          hasSignature: searchParams.has("signature"),
        })
        setStatusMessage("Failed to extract signed transaction from Phantom response.")
        setPageStatus("failed")
        await patchSessionStatus(sid, "failed", "Phantom sign decrypt failed")
        return true
      }

      clearPhantomSession(sid)
      setPageStatus("recording")
      setStatusMessage(signedTx ? "Submitting transaction to Solana..." : "Recording transaction...")

      const completeParams = signedTx ? { signed_tx: signedTx } : { signature: signature! }
      const result = await completeSession(sid, completeParams)
      if (result.ok) {
        setPageStatus("submitted")
        setStatusMessage("Transaction submitted.")
      } else {
        setStatusMessage(result.error || "Failed to record transaction.")
        setPageStatus("failed")
      }
      return true
    }

    return false
  }, [])

  const handleSolflareCallback = useCallback(async (
    searchParams: URLSearchParams,
    loadedSession: SessionData
  ) => {
    const action = searchParams.get("solflare_action")
    if (!action) return false

    const sid = loadedSession.id
    const appUrl = getAppUrl()
    const baseRedirect = `${appUrl}/wallet-approval/${sid}`

    console.debug("[Solflare callback]", {
      action,
      paramNames: Array.from(searchParams.keys()),
      hasSfEncPubKey: searchParams.has("solflare_encryption_public_key"),
      hasData: searchParams.has("data"),
      hasNonce: searchParams.has("nonce"),
      hasErrorCode: searchParams.has("errorCode"),
      hasErrorMessage: searchParams.has("errorMessage"),
      hasDappKeypair: (() => { try { return localStorage.getItem(`pinetree_sf_keypair_${sid}`) !== null } catch { return false } })(),
      hasSolflareSession: getSolflareStoredSession(sid) !== null,
      sessionId: sid,
    })

    const errCode = searchParams.get("errorCode")
    const errMsg = searchParams.get("errorMessage") || ""
    if (errCode || errMsg) {
      const isUserRejection =
        String(errCode) === "4001" ||
        errMsg.toLowerCase().includes("reject") ||
        errMsg.toLowerCase().includes("cancel") ||
        errMsg.toLowerCase().includes("declined") ||
        errMsg.toLowerCase().includes("denied")
      if (isUserRejection) {
        setStatusMessage(`Transaction rejected in Solflare.${errMsg ? ` (${errMsg})` : ""}`)
        setPageStatus("rejected")
        await patchSessionStatus(sid, "rejected", `Solflare rejected: ${errMsg || errCode}`)
      } else {
        const detail = errMsg || `error code ${errCode || "unknown"}`
        setStatusMessage(
          `Solflare returned an error: ${detail}. Tap "Try Again" to restart the approval.`
        )
        setPageStatus("failed")
        await patchSessionStatus(sid, "failed", `Solflare error: ${detail}`)
      }
      clearSolflareSession(sid)
      return true
    }

    if (action === "connect") {
      const paramNames = Array.from(searchParams.keys())
      const hasSfEncPubKey = searchParams.has("solflare_encryption_public_key")
      const hasData = searchParams.has("data")
      const hasNonce = searchParams.has("nonce")

      if (!hasSfEncPubKey || !hasData || !hasNonce) {
        const missing = (
          [!hasSfEncPubKey && "solflare_encryption_public_key", !hasData && "data", !hasNonce && "nonce"] as (string | false)[]
        ).filter(Boolean) as string[]
        console.debug("[Solflare connect] missing params:", missing, "available:", paramNames)
        setStatusMessage(
          "Solflare returned to PineTree, but PineTree could not decrypt the approval response. " +
          "This usually means the browser lost the approval keypair or Solflare returned an unexpected payload. " +
          `(Missing: ${missing.join(", ")})`
        )
        setPageStatus("failed")
        return true
      }

      const solflareSession = decryptSolflareConnectResponse(searchParams, sid)
      if (!solflareSession) {
        console.debug("[Solflare connect decrypt failed]", { sessionId: sid })
        setStatusMessage(
          "Solflare returned to PineTree, but PineTree could not decrypt the approval response. " +
          "This usually means the browser lost the approval keypair or Solflare returned an unexpected payload."
        )
        setPageStatus("failed")
        return true
      }

      if (normalizeAddress(solflareSession.publicKey) !== normalizeAddress(loadedSession.wallet_address)) {
        clearSolflareSession(sid)
        setStatusMessage("Connected wallet does not match the merchant wallet saved for this rail.")
        setPageStatus("failed")
        await patchSessionStatus(sid, "failed", "Solflare public key mismatch")
        return true
      }

      storeSolflareSession(solflareSession, sid)
      patchSessionStatus(sid, "wallet_connected").catch(() => {})

      // ── Refresh the unsigned tx with a fresh blockhash before signing ──────────
      setStatusMessage("Refreshing transaction...")
      const freshTxBase64 = await refreshUnsignedTx(sid)
      const txBase64 = freshTxBase64 || loadedSession.prepared_payload.unsigned_tx_base64

      if (!txBase64) {
        setStatusMessage("Missing prepared transaction data. Please start a new send from the desktop.")
        setPageStatus("failed")
        await patchSessionStatus(sid, "failed", "Missing unsigned_tx_base64 after refresh")
        return true
      }

      if (!freshTxBase64) {
        console.debug("[Solflare connect] refresh-tx failed — using original tx (may have expired blockhash)", { sessionId: sid })
      }

      console.debug("[Solflare connect] building signAndSend URL", {
        sessionId: sid,
        hasTx: Boolean(txBase64),
        txLength: txBase64.length,
        usedFreshTx: Boolean(freshTxBase64),
        redirectBase: baseRedirect,
      })

      const signUrl = buildSolflareSignAndSendUrl(
        txBase64,
        solflareSession,
        `${baseRedirect}?solflare_action=sign`,
        sid
      )
      patchSessionStatus(sid, "approval_requested").catch(() => {})
      setPendingSolflareSignUrl(signUrl)
      setStatusMessage("")
      setPageStatus("solflare_connected")
      return true
    }

    if (action === "sign") {
      const solflareSession = getSolflareStoredSession(sid)
      if (!solflareSession) {
        console.debug("[Solflare sign] session not found in localStorage", { sessionId: sid })
        setStatusMessage("Solflare session not found. Please start the approval again.")
        setPageStatus("failed")
        await patchSessionStatus(sid, "failed", "Solflare session lost after sign redirect")
        return true
      }

      const signature = decryptSolflareSignResponse(searchParams, solflareSession.sfPublicKey, sid)
      if (!signature) {
        console.debug("[Solflare sign decrypt failed]", { sessionId: sid })
        setStatusMessage("Failed to extract signature from Solflare response.")
        setPageStatus("failed")
        await patchSessionStatus(sid, "failed", "Solflare sign decrypt failed")
        return true
      }

      clearSolflareSession(sid)
      setPageStatus("recording")
      setStatusMessage("Recording transaction...")

      const result = await completeSession(sid, { signature })
      if (result.ok) {
        setPageStatus("submitted")
        setStatusMessage("Transaction submitted.")
      } else {
        setStatusMessage(result.error || "Failed to record transaction.")
        setPageStatus("failed")
      }
      return true
    }

    return false
  }, [])

  useEffect(() => {
    if (!sessionId) return

    async function init() {
      console.debug("[wallet-approval] fetching session", { sessionId })

      const res = await fetch(`/api/wallets/send-sessions/${sessionId}`).catch(() => null)

      if (!res) {
        setStatusMessage("Could not connect to PineTree. Check your network connection and try reloading.")
        setPageStatus("not_found")
        return
      }

      if (res.status === 410) {
        setPageStatus("expired")
        return
      }

      if (res.status === 404) {
        const errBody = await res.json().catch(() => null) as { error?: string } | null
        setStatusMessage(errBody?.error || "Approval session not found. It may have expired or the link may be invalid. Create a new QR from PineTree.")
        setPageStatus("not_found")
        return
      }

      if (res.status === 401) {
        console.error("[wallet-approval] session load returned 401 — mobile approval endpoint still requires login", { sessionId })
        setStatusMessage(
          "Approval session could not be loaded because the mobile approval endpoint still requires login. " +
          "This approval page must be public-safe by session link."
        )
        setPageStatus("not_found")
        return
      }

      if (!res.ok) {
        const errBody = await res.json().catch(() => null) as { error?: string } | null
        const serverMsg = errBody?.error || ""
        console.error("[wallet-approval] session load error", { status: res.status, serverMsg })
        setStatusMessage(serverMsg || "Could not load the approval session. Try creating a new QR from PineTree.")
        setPageStatus("not_found")
        return
      }

      const data = await res.json().catch(() => null) as { success?: boolean; session?: SessionData } | null
      if (!data?.success || !data.session) {
        setStatusMessage("Approval session response was unexpected. Try creating a new QR from PineTree.")
        setPageStatus("not_found")
        return
      }

      console.debug("[wallet-approval] session loaded", { id: data.session.id, status: data.session.status, rail: data.session.rail, wallet_type: data.session.wallet_type })

      const s = data.session
      setSession(s)
      const normalizedStatus = String(s.status || "").toLowerCase()

      // Already terminal?
      if (normalizedStatus === "confirmed") { setPageStatus("confirmed"); return }
      if (normalizedStatus === "submitted") { setPageStatus("submitted"); return }
      if (normalizedStatus === "rejected")  { setPageStatus("rejected");  return }
      if (normalizedStatus === "failed")    { setPageStatus("failed");    setStatusMessage(s.error || ""); return }
      if (normalizedStatus === "expired")   { setPageStatus("expired");   return }

      // Handle deeplink callbacks first
      const searchParams = new URLSearchParams(window.location.search)

      const walletType = s.wallet_type as WalletType

      if (walletType === "phantom") {
        const handled = await handlePhantomCallback(searchParams, s)
        if (handled) return
      }
      if (walletType === "solflare") {
        const handled = await handleSolflareCallback(searchParams, s)
        if (handled) return
      }

      // Mark session as opened when the merchant's phone first views it
      if (normalizedStatus === "created") {
        await patchSessionStatus(s.id, "opened")
      }

      // Detect if we're already inside the target wallet's browser
      const inWalletBrowser =
        (["base_wallet", "base", "metamask", "trust_wallet", "trust"].includes(walletType) && isInsideEvmWalletBrowser(walletType)) ||
        (walletType === "phantom"  && isInsidePhantomBrowser()) ||
        (walletType === "solflare" && isInsideSolflareBrowser())

      if (inWalletBrowser) {
        setPageStatus("in_wallet_browser")
      } else {
        setPageStatus("ready")
      }
    }

    init()
  }, [sessionId, handlePhantomCallback, handleSolflareCallback])

  // ── Auto-sign when inside the wallet browser ─────────────────────────────────

  useEffect(() => {
    if (pageStatus !== "in_wallet_browser" || !session || signingRef.current) return
    signingRef.current = true

    const walletType = session.wallet_type as WalletType

    if (["base_wallet", "base", "metamask", "trust_wallet", "trust"].includes(walletType)) {
      signWithEvmWallet(walletType, session)
    } else if (walletType === "phantom") {
      signWithPhantomBrowser(session)
    } else if (walletType === "solflare") {
      signWithSolflareBrowser(session)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageStatus, session])

  // ── EVM signing (in-wallet browser) ──────────────────────────────────────────

  async function signWithEvmWallet(walletType: WalletType, s: SessionData) {
    const normalizedWalletType = normalizeWalletType(walletType)
    setPageStatus("connecting")
    setStatusMessage(`Connecting ${walletDisplayName(normalizedWalletType)}...`)

    try {
      await patchSessionStatus(s.id, "wallet_connecting")
      devLog("sign-start", {
        session_id: s.id,
        wallet_type_raw: s.wallet_type,
        wallet_type_normalized: normalizedWalletType,
        in_wallet_param_present: typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("in_wallet") === "1" : false,
        window_ethereum_present: typeof window !== "undefined" ? Boolean((window as Window & { ethereum?: Eip1193Provider }).ethereum) : false,
        providers_count: getEvmProviders().length,
        asset: s.asset,
      })

      const provider = await waitForEvmProvider(normalizedWalletType, 8000)
      if (!provider) {
        throw new Error(`Open this approval inside ${walletDisplayName(normalizedWalletType)} to continue.`)
      }

      if (debugMode) setDebugInfo(getDebugProviderFlags())
      devLog("provider-selected", {
        session_id: s.id,
        providers_count: getEvmProviders().length,
        selected_provider_type: describeEvmProvider(provider),
      })

      const accountsResponse = await provider.request({ method: "eth_requestAccounts" })
      const account = Array.isArray(accountsResponse) ? String(accountsResponse[0] || "") : ""
      const accountMatched = normalizeAddress(account) === normalizeAddress(s.wallet_address)
      devLog("account-requested", {
        session_id: s.id,
        requested_account: formatShortAddress(account),
        saved_wallet_address: formatShortAddress(s.wallet_address),
        account_matched: accountMatched,
      })

      await patchSessionStatus(s.id, "wallet_connected")
      setPageStatus("validating")
      setStatusMessage("Validating wallet address...")

      if (!accountMatched) {
        throw new Error("This is not the connected PineTree wallet for this Base Pay rail.")
      }

      const chainResult = await ensureBaseChain(provider)
      if (debugMode) getDebugChainId(normalizedWalletType).then(setDebugChainId)
      devLog("chain-checked", {
        session_id: s.id,
        chain_id_before_switch: chainResult.before,
        chain_id_after_switch: chainResult.after,
      })

      const txParams = s.prepared_payload.tx_params
      if (!txParams) throw new Error("Prepared Base transaction is missing transaction parameters. Please start a new send from the desktop.")
      if (!txParams.to) throw new Error("Prepared Base transaction is missing the destination address.")
      if (!txParams.from) throw new Error("Prepared Base transaction is missing the from address.")

      await patchSessionStatus(s.id, "approval_requested")
      setPageStatus("signing")
      setStatusMessage(`Waiting for withdrawal approval in ${walletDisplayName(normalizedWalletType)}...`)

      const txRequest = {
        from: account || txParams.from,
        to: txParams.to,
        value: txParams.value || "0x0",
        data: txParams.data || "0x",
        ...(txParams.gas ? { gas: txParams.gas } : {}),
        chainId: txParams.chainId || BASE_CHAIN_ID_HEX,
      }
      devLog("tx-built", {
        session_id: s.id,
        asset: s.asset,
        tx_request_built: true,
      })

      const rawResult = await provider.request({
        method: "eth_sendTransaction",
        params: [txRequest],
      })

      const txHash = String(rawResult || "").trim()
      devLog("tx-returned", {
        session_id: s.id,
        tx_hash_returned: Boolean(txHash),
      })
      if (!txHash) throw new Error(`${walletDisplayName(normalizedWalletType)} connected, but no transaction hash was returned after approval.`)

      setPageStatus("recording")
      setStatusMessage("Recording transaction...")

      const result = await completeSession(s.id, { tx_hash: txHash })
      if (result.ok) {
        setPageStatus("submitted")
        setStatusMessage("Transaction submitted.")
      } else {
        throw new Error(result.error || "Failed to record transaction.")
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Approval failed"
      const isRejection = msg.toLowerCase().includes("reject") ||
        msg.toLowerCase().includes("denied") || msg.toLowerCase().includes("declined") ||
        msg.toLowerCase().includes("user denied")

      setStatusMessage(msg)
      setPageStatus(isRejection ? "rejected" : "failed")
      await patchSessionStatus(s.id, isRejection ? "rejected" : "failed", msg)
    } finally {
      signingRef.current = false
    }
  }

  // ── Phantom in-browser signing ────────────────────────────────────────────────

  async function signWithPhantomBrowser(s: SessionData) {
    setPageStatus("connecting")
    setStatusMessage("Connecting Phantom...")

    try {
      await patchSessionStatus(s.id, "wallet_connecting")

      const w = window as Window & {
        phantom?: { solana?: { isPhantom?: boolean; connect: () => Promise<{ publicKey: { toString(): string } }>; signAndSendTransaction: (tx: unknown) => Promise<{ signature: string } | string> } }
        solana?: { isPhantom?: boolean; connect: () => Promise<{ publicKey: { toString(): string } }>; signAndSendTransaction: (tx: unknown) => Promise<{ signature: string } | string> }
      }
      const provider = w.phantom?.solana || (w.solana?.isPhantom ? w.solana : null)
      if (!provider) throw new Error("Phantom not detected in this browser.")

      const connectResult = await provider.connect()
      const publicKey = String(connectResult?.publicKey?.toString() || "").trim()

      await patchSessionStatus(s.id, "wallet_connected")
      setPageStatus("validating")

      if (normalizeAddress(publicKey) !== normalizeAddress(s.wallet_address)) {
        throw new Error("Connected wallet does not match the merchant wallet saved for this rail.")
      }

      const txBase64 = s.prepared_payload.unsigned_tx_base64
      if (!txBase64) throw new Error("Missing prepared transaction data.")

      await patchSessionStatus(s.id, "approval_requested")
      setPageStatus("signing")
      setStatusMessage("Waiting for approval in Phantom...")

      const { Transaction } = await import("@solana/web3.js")
      const tx = Transaction.from(Buffer.from(txBase64, "base64"))
      const signResult = await provider.signAndSendTransaction(tx)
      const signature = typeof signResult === "string"
        ? signResult
        : String((signResult as { signature?: string })?.signature || "").trim()

      if (!signature) throw new Error("Phantom connected, but no signature was returned after transaction approval.")

      setPageStatus("recording")
      setStatusMessage("Recording transaction...")
      const result = await completeSession(s.id, { signature })
      if (result.ok) {
        setPageStatus("submitted")
        setStatusMessage("Transaction submitted.")
      } else {
        throw new Error(result.error || "Failed to record transaction.")
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Approval failed"
      const isRejection = msg.toLowerCase().includes("reject") || msg.toLowerCase().includes("user rejected")
      setStatusMessage(msg)
      setPageStatus(isRejection ? "rejected" : "failed")
      await patchSessionStatus(s.id, isRejection ? "rejected" : "failed", msg)
    } finally {
      signingRef.current = false
    }
  }

  // ── Solflare in-browser signing ───────────────────────────────────────────────

  async function signWithSolflareBrowser(s: SessionData) {
    setPageStatus("connecting")
    setStatusMessage("Connecting Solflare...")

    try {
      await patchSessionStatus(s.id, "wallet_connecting")

      const w = window as Window & {
        solflare?: {
          isSolflare?: boolean
          connect: () => Promise<unknown>
          publicKey?: { toString(): string }
          signAndSendTransaction: (tx: unknown) => Promise<{ signature: string } | string>
        }
      }
      const provider = w.solflare
      if (!provider?.isSolflare) throw new Error("Solflare not detected in this browser.")

      await provider.connect()
      const publicKey = String(provider.publicKey?.toString() || "").trim()

      await patchSessionStatus(s.id, "wallet_connected")
      setPageStatus("validating")

      if (normalizeAddress(publicKey) !== normalizeAddress(s.wallet_address)) {
        throw new Error("Connected wallet does not match the merchant wallet saved for this rail.")
      }

      const txBase64 = s.prepared_payload.unsigned_tx_base64
      if (!txBase64) throw new Error("Missing prepared transaction data.")

      await patchSessionStatus(s.id, "approval_requested")
      setPageStatus("signing")
      setStatusMessage("Waiting for approval in Solflare...")

      const { Transaction } = await import("@solana/web3.js")
      const tx = Transaction.from(Buffer.from(txBase64, "base64"))
      const signResult = await provider.signAndSendTransaction(tx)
      const signature = typeof signResult === "string"
        ? signResult
        : String((signResult as { signature?: string })?.signature || "").trim()

      if (!signature) throw new Error("Solflare connected, but no signature was returned after transaction approval.")

      setPageStatus("recording")
      setStatusMessage("Recording transaction...")
      const result = await completeSession(s.id, { signature })
      if (result.ok) {
        setPageStatus("submitted")
        setStatusMessage("Transaction submitted.")
      } else {
        throw new Error(result.error || "Failed to record transaction.")
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Approval failed"
      const isRejection = msg.toLowerCase().includes("reject") || msg.toLowerCase().includes("user rejected")
      setStatusMessage(msg)
      setPageStatus(isRejection ? "rejected" : "failed")
      await patchSessionStatus(s.id, isRejection ? "rejected" : "failed", msg)
    } finally {
      signingRef.current = false
    }
  }

  // ── Manual approval trigger (Phantom UL / Solflare UL) ───────────────────────

  async function startPhantomApproval() {
    if (!session || signingRef.current) return
    signingRef.current = true

    const appUrl = getAppUrl()
    const baseRedirect = `${appUrl}/wallet-approval/${session.id}`

    await patchSessionStatus(session.id, "wallet_connecting")
    setStatusMessage("Opening Phantom...")

    // If injected provider present, sign in-browser instead of deep link
    if (isInsidePhantomBrowser()) {
      setPageStatus("in_wallet_browser")
      signingRef.current = false
      return
    }

    const connectUrl = buildPhantomConnectUrl(
      session.id,
      `${baseRedirect}?phantom_action=connect`,
      appUrl
    )
    window.location.href = connectUrl
  }

  async function startSolflareApproval() {
    if (!session || signingRef.current) return
    signingRef.current = true

    const appUrl = getAppUrl()
    const baseRedirect = `${appUrl}/wallet-approval/${session.id}`

    await patchSessionStatus(session.id, "wallet_connecting")
    setStatusMessage("Opening Solflare...")

    if (isInsideSolflareBrowser()) {
      setPageStatus("in_wallet_browser")
      signingRef.current = false
      return
    }

    const connectUrl = buildSolflareConnectUrl(
      `${baseRedirect}?solflare_action=connect`,
      appUrl,
      session.id
    )
    window.location.href = connectUrl
  }

  async function startEvmWalletApproval(walletType: WalletType) {
    if (!session) return
    const normalizedWalletType = normalizeWalletType(walletType)

    // If already inside the wallet's browser, sign directly
    if (isInsideEvmWalletBrowser(normalizedWalletType)) {
      setPageStatus("in_wallet_browser")
      return
    }

    // Otherwise open the wallet's in-app browser pointing at this page.
    // ?in_wallet=1 triggers auto-connect once the provider is detected.
    const appUrl = getAppUrl()
    const targetUrl = `${appUrl}/wallet-approval/${session.id}?in_wallet=1`
    const deepLink = buildEvmWalletBrowserDeepLink(normalizedWalletType, targetUrl)
    const fallbackDeepLink = buildEvmWalletBrowserFallbackDeepLink(normalizedWalletType, targetUrl)

    await patchSessionStatus(session.id, "wallet_connecting")
    setStatusMessage(`Opening ${walletDisplayName(normalizedWalletType)}...`)
    devLog("open-wallet", {
      session_id: session.id,
      wallet_type_raw: walletType,
      wallet_type_normalized: normalizedWalletType,
      approval_url: targetUrl,
      deep_link_url_type_used: fallbackDeepLink ? "coinbase_https_primary" : "wallet_primary",
    })
    window.location.href = deepLink

    if (fallbackDeepLink) {
      window.setTimeout(() => {
        if (document.visibilityState !== "visible") return
        devLog("open-wallet-fallback", {
          session_id: session.id,
          wallet_type_normalized: normalizedWalletType,
          deep_link_url_type_used: "coinbase_cbwallet_fallback",
        })
        window.location.href = fallbackDeepLink
      }, 1200)
    }
  }

  // Re-detect wallet browser if we came back from a deep link
  useEffect(() => {
    if (!session || pageStatus !== "ready") return
    const searchParams = new URLSearchParams(window.location.search)
    if (searchParams.get("in_wallet") === "1") {
      setPageStatus("in_wallet_browser")
    }
  }, [session, pageStatus])

  // ── Render ────────────────────────────────────────────────────────────────────

  const walletType = session?.wallet_type as WalletType | undefined
  const normalizedWalletType = walletType ? normalizeWalletType(walletType) : undefined
  const walletName = normalizedWalletType ? walletDisplayName(normalizedWalletType) : "Wallet"
  const canOpenEvmWallet = Boolean(normalizedWalletType && isEvmWalletType(normalizedWalletType))

  const activeStatusCopy: Record<string, string> = {
    in_wallet_browser: `Connecting ${walletName}...`,
    connecting: statusMessage || `Connecting ${walletName}...`,
    validating: "Validating wallet address...",
    signing: statusMessage || `Waiting for approval in ${walletName}...`,
    recording: "Recording transaction...",
  }
  const destinationLabel = session?.destination_label || "Destination"
  const destinationAddress = session ? formatShortAddress(session.destination_address) : "-"
  const displayAmount = session ? `${session.amount} ${formatAssetSymbol(session.asset)}` : ""
  const networkWalletLine = session ? `${formatNetworkName(session.network)} - ${walletName}` : ""
  const submittedReference = session ? session.tx_hash || session.signature || "" : ""

  function resetForRetry() {
    if (session?.wallet_type === "phantom")  clearPhantomSession(session.id)
    if (session?.wallet_type === "solflare") clearSolflareSession(session.id)
    signingRef.current = false
    setPendingPhantomSignUrl("")
    setPendingSolflareSignUrl("")
    setPageStatus("ready")
    setStatusMessage("")
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-gradient-to-br from-white via-[#f8fbff] to-[#edf5ff] px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1.5rem+env(safe-area-inset-top))] sm:justify-center sm:py-10">
      <div className="w-full max-w-md space-y-4">

        {/* Header */}
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#0052FF]">
            PineTree Payments
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900">
            Wallet Approval
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-gray-500">
            Approve this merchant wallet transfer from your connected wallet.
          </p>
        </div>

        {/* Loading */}
        {pageStatus === "loading" && (
          <div className="w-full rounded-3xl border border-[#0052FF]/10 bg-white p-8 text-center shadow-[0_18px_60px_rgba(0,82,255,0.10)] ring-1 ring-white/80">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-[#0052FF] border-t-transparent" />
            <p className="text-sm font-semibold text-gray-900">Loading approval...</p>
            <p className="mt-1 text-sm text-gray-500">Getting the wallet transfer details.</p>
          </div>
        )}

        {/* Not found / load error */}
        {pageStatus === "not_found" && (
          <div className="rounded-3xl border border-red-100 bg-white p-6 shadow-[0_18px_44px_rgba(15,23,42,0.08)] ring-1 ring-white/80">
            <ApprovalOutcomeCard
              tone="error"
              title="Approval unavailable"
              message="This approval link is invalid or has been removed."
              detail={statusMessage || undefined}
              primaryAction={{ label: "Done", onClick: () => window.close() }}
            />
          </div>
        )}

        {/* Expired */}
        {pageStatus === "expired" && (
          <div className="rounded-3xl border border-red-100 bg-white p-6 shadow-[0_18px_44px_rgba(15,23,42,0.08)] ring-1 ring-white/80">
            <ApprovalOutcomeCard
              tone="error"
              title="Session expired"
              message="This withdrawal approval link has expired."
              detail="Create a new approval QR from PineTree."
              primaryAction={{ label: "Done", onClick: () => window.close() }}
            />
          </div>
        )}

        {/* Session info + action */}
        {session && !["loading", "not_found", "expired"].includes(pageStatus) && (
          <>
            {/* Transaction summary card */}
            <div className="overflow-hidden rounded-3xl border border-[#0052FF]/15 bg-white p-5 shadow-[0_12px_30px_rgba(15,23,42,0.07)] ring-1 ring-white/80">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#0052FF]">
                Transfer summary
              </p>
              <div className="mt-4 border-b border-[#0052FF]/10 pb-4">
                <p className="text-4xl font-bold tracking-tight text-gray-950">{displayAmount}</p>
                <p className="mt-1 text-sm font-medium text-gray-500">{networkWalletLine}</p>
              </div>
              <div className="mt-4 space-y-2.5">
                {[
                  { label: "Wallet",      value: formatShortAddress(session.wallet_address) },
                  { label: "Destination", value: destinationLabel },
                  { label: "To address",  value: destinationAddress },
                  { label: "Fee",         value: "Wallet will estimate" },
                  { label: "Expires",     value: expiryDisplay || "-" },
                ].map(({ label, value }) => (
                  <ApprovalDetailRow key={label} label={label} value={value} mono={label === "Wallet" || label === "To address"} />
                ))}
              </div>
            </div>

            {/* Status / action card */}
            <div className="rounded-3xl border border-[#0052FF]/15 bg-white p-5 shadow-[0_18px_44px_rgba(0,82,255,0.10)] ring-1 ring-white/80">

              {/* Ready — show approve button */}
              {pageStatus === "ready" && walletType && (
                <>
                  <p className="text-lg font-bold text-gray-950">
                    Approve with {walletName}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-gray-500">
                    Review and approve this withdrawal in your connected wallet.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (walletType === "phantom")  startPhantomApproval()
                      else if (walletType === "solflare") startSolflareApproval()
                      else startEvmWalletApproval(walletType)
                    }}
                    className="mt-4 w-full rounded-2xl bg-[#0052FF] px-5 py-3.5 text-sm font-bold text-white shadow-sm shadow-[#0052FF]/25 transition hover:bg-[#003FCC] active:scale-[0.98]"
                  >
                    Open {walletName}
                  </button>
                </>
              )}

              {/* In-wallet browser — provider loaded; signing starts automatically */}
              {pageStatus === "in_wallet_browser" && (
                <PaymentStatusVisual
                  status="PROCESSING"
                  size="compact"
                  labelOverride="Approval in progress"
                  messageOverride={activeStatusCopy.in_wallet_browser}
                  labelClassName="text-lg font-bold text-gray-950"
                />
              )}

              {/* Phantom connected — must tap to open signing deeplink (iOS gesture) */}
              {pageStatus === "phantom_connected" && (
                <>
                  <p className="text-lg font-bold text-gray-950">Approve with Phantom</p>
                  <p className="mt-1 text-sm leading-6 text-gray-500">
                    Review and approve this withdrawal in your connected wallet.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (pendingPhantomSignUrl) window.location.href = pendingPhantomSignUrl
                    }}
                    className="mt-4 w-full rounded-2xl bg-[#0052FF] px-5 py-3.5 text-sm font-bold text-white shadow-sm shadow-[#0052FF]/25 transition hover:bg-[#003FCC] active:scale-[0.98]"
                  >
                    Confirm Withdrawal
                  </button>
                </>
              )}

              {/* Solflare connected — must tap to open signing deeplink (iOS gesture) */}
              {pageStatus === "solflare_connected" && (
                <>
                  <p className="text-lg font-bold text-gray-950">Approve with Solflare</p>
                  <p className="mt-1 text-sm leading-6 text-gray-500">
                    Review and approve this withdrawal in your connected wallet.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (pendingSolflareSignUrl) window.location.href = pendingSolflareSignUrl
                    }}
                    className="mt-4 w-full rounded-2xl bg-[#0052FF] px-5 py-3.5 text-sm font-bold text-white shadow-sm shadow-[#0052FF]/25 transition hover:bg-[#003FCC] active:scale-[0.98]"
                  >
                    Confirm Withdrawal
                  </button>
                </>
              )}

              {pageStatus === "connecting" && (
                <PaymentStatusVisual
                  status="PROCESSING"
                  size="compact"
                  labelOverride="Approval in progress"
                  messageOverride={activeStatusCopy.connecting}
                  labelClassName="text-lg font-bold text-gray-950"
                />
              )}

              {pageStatus === "validating" && (
                <PaymentStatusVisual
                  status="PROCESSING"
                  size="compact"
                  labelOverride="Approval in progress"
                  messageOverride={activeStatusCopy.validating}
                  labelClassName="text-lg font-bold text-gray-950"
                />
              )}

              {pageStatus === "signing" && (
                <PaymentStatusVisual
                  status="PROCESSING"
                  size="compact"
                  labelOverride="Waiting for approval"
                  messageOverride={activeStatusCopy.signing}
                  labelClassName="text-lg font-bold text-gray-950"
                />
              )}

              {pageStatus === "recording" && (
                <PaymentStatusVisual
                  status="PROCESSING"
                  size="compact"
                  labelOverride="Approval in progress"
                  messageOverride={activeStatusCopy.recording}
                  labelClassName="text-lg font-bold text-gray-950"
                />
              )}

              {/* Refreshing blockhash — shown briefly during connect→sign transition */}
              {pageStatus === "phantom_connected" && statusMessage === "Refreshing transaction..." && (
                <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400" />
                  {statusMessage}
                </div>
              )}

              {pageStatus === "submitted" && (
                <div>
                  <ApprovalOutcomeCard
                    tone="success"
                    title="Withdrawal Submitted"
                    message="Your withdrawal was submitted successfully."
                    primaryAction={{ label: "Done", onClick: () => window.close() }}
                  />
                  <div className="mt-5 space-y-2.5">
                    {submittedReference && (
                      <ApprovalDetailRow label="Transaction" value={formatShortAddress(submittedReference)} mono />
                    )}
                    <ApprovalDetailRow label="Status" value="Submitted" />
                  </div>
                </div>
              )}

              {pageStatus === "confirmed" && (
                <div>
                  <ApprovalOutcomeCard
                    tone="success"
                    title="Withdrawal Confirmed"
                    message="Your withdrawal has been confirmed on-chain."
                    primaryAction={{ label: "Done", onClick: () => window.close() }}
                  />
                  <div className="mt-5 space-y-2.5">
                    {submittedReference && (
                      <ApprovalDetailRow label="Transaction" value={formatShortAddress(submittedReference)} mono />
                    )}
                    <ApprovalDetailRow label="Status" value="Confirmed" />
                  </div>
                </div>
              )}

              {pageStatus === "rejected" && (
                <div>
                  <PaymentStatusVisual
                    status="FAILED"
                    size="compact"
                    labelOverride="Withdrawal rejected"
                    messageOverride={statusMessage || "The wallet rejected this withdrawal."}
                    labelClassName="text-lg font-bold text-gray-950"
                  />
                  <button
                    type="button"
                    onClick={resetForRetry}
                    className="mt-4 w-full rounded-2xl border border-[#0052FF]/15 bg-white px-5 py-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-[#0052FF]/30 hover:text-[#0052FF]"
                  >
                    Try Again
                  </button>
                  <button
                    type="button"
                    onClick={() => window.close()}
                    className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-gray-300 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {pageStatus === "failed" && (
                <div>
                  <PaymentStatusVisual
                    status="FAILED"
                    size="compact"
                    labelOverride="Approval failed"
                    messageOverride={statusMessage || "This withdrawal could not be approved."}
                    labelClassName="text-lg font-bold text-gray-950"
                  />
                  {canOpenEvmWallet && normalizedWalletType && (
                    <button
                      type="button"
                      onClick={() => startEvmWalletApproval(normalizedWalletType)}
                      className="mt-4 w-full rounded-2xl bg-[#0052FF] px-5 py-3 text-sm font-bold text-white shadow-sm shadow-[#0052FF]/25 transition hover:bg-[#003FCC] active:scale-[0.98]"
                    >
                      Open {walletName}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={resetForRetry}
                    className={`${canOpenEvmWallet ? "mt-2" : "mt-4"} w-full rounded-2xl border border-[#0052FF]/15 bg-white px-5 py-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-[#0052FF]/30 hover:text-[#0052FF]`}
                  >
                    Try Again
                  </button>
                  <button
                    type="button"
                    onClick={() => window.close()}
                    className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-gray-300 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Debug panel (?debug=1) ─────────────────────────────────────────── */}
        {debugMode && (
          <details className="rounded-2xl border border-dashed border-gray-300/80 bg-white/65 p-3 text-xs text-gray-500 shadow-sm">
            <summary className="cursor-pointer select-none font-semibold text-gray-700">
              Debug details
            </summary>
            <div className="mt-3 space-y-1 font-mono text-[10px]">
            {[
              ["session_id",          sessionId || "—"],
              ["rail",                session?.rail || "—"],
              ["wallet_type",         session?.wallet_type || "—"],
              ["wallet_type_normalized", normalizedWalletType || "—"],
              ["asset",               session?.asset || "—"],
              ["network",             session?.network || "—"],
              ["status",              session?.status || "—"],
              ["has_payload",         session ? String(Boolean(session.prepared_payload)) : "—"],
              ["payload_keys",        session ? Object.keys(session.prepared_payload || {}).join(", ") || "none" : "—"],
              ["has_unsigned_tx",     session ? String(Boolean(session.prepared_payload?.unsigned_tx_base64)) : "—"],
              ["has_tx_params",       session ? String(Boolean(session.prepared_payload?.tx_params)) : "—"],
              ["has_ethereum",        String(debugInfo.hasEthereum ?? false)],
              ["provider_count",      String(debugInfo.providerCount ?? "—")],
              ["isCoinbaseWallet",    String(debugInfo.isCoinbaseWallet ?? false)],
              ["isBaseWallet",        String(debugInfo.isBaseWallet ?? false)],
              ["isMetaMask",          String(debugInfo.isMetaMask ?? false)],
              ["isTrust",             String(debugInfo.isTrust ?? false)],
              ["chain_id",            debugChainId || "—"],
              ["page_status",         pageStatus],
              ["last_step",           lastStep],
              ["status_message",      statusMessage || "—"],
              ["pending_phantom_url", pendingPhantomSignUrl ? "set" : "none"],
              ["pending_sf_url",      pendingSolflareSignUrl ? "set" : "none"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 border-b border-gray-200/80 py-0.5 last:border-0">
                <span className="text-gray-400">{k}</span>
                <span className="max-w-[55%] truncate text-right text-gray-700">{v}</span>
              </div>
            ))}
            </div>
          </details>
        )}

      </div>
    </div>
  )
}
