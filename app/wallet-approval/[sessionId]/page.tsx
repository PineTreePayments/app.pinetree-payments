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
 */

import { useCallback, useEffect, useRef, useState } from "react"
import {
  buildPhantomConnectUrl,
  buildPhantomSignAndSendUrl,
  decryptPhantomConnectResponse,
  decryptPhantomSignResponse,
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

// ── Types ─────────────────────────────────────────────────────────────────────

type WalletType = "base" | "metamask" | "trust" | "phantom" | "solflare"

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
  | "rejected"
  | "failed"
  | "expired"
  | "not_found"

type Eip1193Provider = {
  isCoinbaseWallet?: boolean
  isBaseWallet?: boolean
  isMetaMask?: boolean
  isTrust?: boolean
  isTrustWallet?: boolean
  providers?: Eip1193Provider[]
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function walletDisplayName(type: WalletType | string): string {
  if (type === "base")     return "Base Wallet"
  if (type === "metamask") return "MetaMask"
  if (type === "trust")    return "Trust Wallet"
  if (type === "phantom")  return "Phantom"
  if (type === "solflare") return "Solflare"
  return "Wallet"
}

function getAppUrl(): string {
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

function formatExpiry(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now()
  if (ms <= 0) return "Expired"
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

/** Resolve the wallet-specific in-app browser deep link for Base-family wallets. */
function buildEvmWalletBrowserDeepLink(walletType: WalletType, targetUrl: string): string {
  const encoded = encodeURIComponent(targetUrl)
  if (walletType === "base") {
    return `https://go.cb-w.com/dapp?cb_url=${encoded}`
  }
  if (walletType === "metamask") {
    // MetaMask deep link: replace scheme with metamask.app.link/dapp/
    const urlObj = new URL(targetUrl)
    const path = urlObj.hostname + urlObj.pathname + urlObj.search
    return `https://metamask.app.link/dapp/${path}`
  }
  if (walletType === "trust") {
    return `https://link.trustwallet.com/open_url?coin_id=60&url=${encoded}`
  }
  return targetUrl
}

/** Pick the injected EVM provider that matches the expected wallet type. */
function getMatchingEvmProvider(walletType: WalletType): Eip1193Provider | null {
  if (typeof window === "undefined") return null
  const eth = (window as Window & { ethereum?: Eip1193Provider }).ethereum
  if (!eth) return null

  const providers: Eip1193Provider[] =
    Array.isArray(eth.providers) && eth.providers.length > 0
      ? eth.providers
      : [eth]

  if (walletType === "base") {
    return providers.find((p) => p.isCoinbaseWallet || p.isBaseWallet) || null
  }
  if (walletType === "metamask") {
    return providers.find((p) => p.isMetaMask && !p.isCoinbaseWallet) || null
  }
  if (walletType === "trust") {
    return providers.find((p) => p.isTrust || p.isTrustWallet) || null
  }
  return null
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
  params: { tx_hash?: string; signature?: string }
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
  const expiryRef = useRef<NodeJS.Timeout | null>(null)
  const signingRef = useRef(false)

  // Resolve params
  useEffect(() => {
    params.then(({ sessionId: sid }) => setSessionId(sid))
  }, [params])

  // Expiry countdown
  useEffect(() => {
    if (!session?.expires_at) return
    expiryRef.current = setInterval(() => {
      setExpiryDisplay(formatExpiry(session.expires_at))
    }, 1000)
    setExpiryDisplay(formatExpiry(session.expires_at))
    return () => { if (expiryRef.current) clearInterval(expiryRef.current) }
  }, [session?.expires_at])

  // ── Load session + handle deeplink callbacks ─────────────────────────────────

  const handlePhantomCallback = useCallback(async (
    searchParams: URLSearchParams,
    loadedSession: SessionData
  ) => {
    const action = searchParams.get("phantom_action")
    if (!action) return false

    const appUrl = getAppUrl()
    const baseRedirect = `${appUrl}/wallet-approval/${loadedSession.id}`

    if (action === "connect") {
      // Phantom connect callback — decrypt session, proceed to sign
      const phantomSession = decryptPhantomConnectResponse(searchParams)
      if (!phantomSession) {
        setStatusMessage("Failed to decrypt Phantom connect response. Please try again.")
        setPageStatus("failed")
        await patchSessionStatus(loadedSession.id, "failed", "Phantom connect decrypt failed")
        return true
      }

      // Validate public key matches merchant wallet address
      if (normalizeAddress(phantomSession.publicKey) !== normalizeAddress(loadedSession.wallet_address)) {
        clearPhantomSession()
        setStatusMessage(
          "Connected wallet does not match the merchant wallet saved for this rail."
        )
        setPageStatus("failed")
        await patchSessionStatus(loadedSession.id, "failed", "Phantom public key mismatch")
        return true
      }

      storePhantomSession(phantomSession)
      await patchSessionStatus(loadedSession.id, "wallet_connected")

      const txBase64 = loadedSession.prepared_payload.unsigned_tx_base64
      if (!txBase64) {
        setStatusMessage("Missing prepared transaction data.")
        setPageStatus("failed")
        await patchSessionStatus(loadedSession.id, "failed", "Missing unsigned_tx_base64")
        return true
      }

      await patchSessionStatus(loadedSession.id, "approval_requested")
      const signUrl = buildPhantomSignAndSendUrl(
        txBase64,
        phantomSession,
        `${baseRedirect}?phantom_action=sign`
      )
      window.location.href = signUrl
      return true
    }

    if (action === "sign") {
      // Phantom sign callback — extract signature, complete session
      const phantomSession = getStoredPhantomSession()
      if (!phantomSession) {
        setStatusMessage("Phantom session not found. Please start the approval again.")
        setPageStatus("failed")
        await patchSessionStatus(loadedSession.id, "failed", "Phantom session lost")
        return true
      }

      const signature = decryptPhantomSignResponse(searchParams, phantomSession.phPublicKey)
      if (!signature) {
        const errCode = searchParams.get("errorCode")
        if (errCode === "4001" || searchParams.get("errorMessage")?.toLowerCase().includes("reject")) {
          setStatusMessage("Transaction rejected in Phantom.")
          setPageStatus("rejected")
          await patchSessionStatus(loadedSession.id, "rejected", "User rejected in Phantom")
          clearPhantomSession()
          return true
        }
        setStatusMessage("Failed to extract signature from Phantom response.")
        setPageStatus("failed")
        await patchSessionStatus(loadedSession.id, "failed", "Phantom sign decrypt failed")
        return true
      }

      clearPhantomSession()
      setPageStatus("recording")
      setStatusMessage("Recording transaction...")

      const result = await completeSession(loadedSession.id, { signature })
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

    const appUrl = getAppUrl()
    const baseRedirect = `${appUrl}/wallet-approval/${loadedSession.id}`

    if (action === "connect") {
      const solflareSession = decryptSolflareConnectResponse(searchParams)
      if (!solflareSession) {
        setStatusMessage("Failed to decrypt Solflare connect response. Please try again.")
        setPageStatus("failed")
        await patchSessionStatus(loadedSession.id, "failed", "Solflare connect decrypt failed")
        return true
      }

      if (normalizeAddress(solflareSession.publicKey) !== normalizeAddress(loadedSession.wallet_address)) {
        clearSolflareSession()
        setStatusMessage("Connected wallet does not match the merchant wallet saved for this rail.")
        setPageStatus("failed")
        await patchSessionStatus(loadedSession.id, "failed", "Solflare public key mismatch")
        return true
      }

      storeSolflareSession(solflareSession)
      await patchSessionStatus(loadedSession.id, "wallet_connected")

      const txBase64 = loadedSession.prepared_payload.unsigned_tx_base64
      if (!txBase64) {
        setStatusMessage("Missing prepared transaction data.")
        setPageStatus("failed")
        await patchSessionStatus(loadedSession.id, "failed", "Missing unsigned_tx_base64")
        return true
      }

      await patchSessionStatus(loadedSession.id, "approval_requested")
      const signUrl = buildSolflareSignAndSendUrl(
        txBase64,
        solflareSession,
        `${baseRedirect}?solflare_action=sign`
      )
      window.location.href = signUrl
      return true
    }

    if (action === "sign") {
      const solflareSession = getSolflareStoredSession()
      if (!solflareSession) {
        setStatusMessage("Solflare session not found. Please start the approval again.")
        setPageStatus("failed")
        await patchSessionStatus(loadedSession.id, "failed", "Solflare session lost")
        return true
      }

      const signature = decryptSolflareSignResponse(searchParams, solflareSession.sfPublicKey)
      if (!signature) {
        const errCode = searchParams.get("errorCode")
        if (errCode === "4001" || searchParams.get("errorMessage")?.toLowerCase().includes("reject")) {
          setStatusMessage("Transaction rejected in Solflare.")
          setPageStatus("rejected")
          await patchSessionStatus(loadedSession.id, "rejected", "User rejected in Solflare")
          clearSolflareSession()
          return true
        }
        setStatusMessage("Failed to extract signature from Solflare response.")
        setPageStatus("failed")
        await patchSessionStatus(loadedSession.id, "failed", "Solflare sign decrypt failed")
        return true
      }

      clearSolflareSession()
      setPageStatus("recording")
      setStatusMessage("Recording transaction...")

      const result = await completeSession(loadedSession.id, { signature })
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
      const res = await fetch(`/api/wallets/send-sessions/${sessionId}`).catch(() => null)
      if (!res) {
        setPageStatus("not_found")
        return
      }
      if (res.status === 404 || res.status === 410) {
        setPageStatus(res.status === 410 ? "expired" : "not_found")
        return
      }
      if (!res.ok) {
        setPageStatus("not_found")
        return
      }

      const data = await res.json().catch(() => null) as { success?: boolean; session?: SessionData } | null
      if (!data?.success || !data.session) {
        setPageStatus("not_found")
        return
      }

      const s = data.session
      setSession(s)

      // Already terminal?
      if (s.status === "submitted") { setPageStatus("submitted"); return }
      if (s.status === "rejected")  { setPageStatus("rejected");  return }
      if (s.status === "failed")    { setPageStatus("failed");    setStatusMessage(s.error || ""); return }
      if (s.status === "expired")   { setPageStatus("expired");   return }

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
      if (s.status === "created") {
        await patchSessionStatus(s.id, "opened")
      }

      // Detect if we're already inside the target wallet's browser
      const inWalletBrowser =
        (["base", "metamask", "trust"].includes(walletType) && isInsideEvmWalletBrowser(walletType)) ||
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

    if (["base", "metamask", "trust"].includes(walletType)) {
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
    setPageStatus("connecting")
    setStatusMessage("Connecting wallet...")

    try {
      await patchSessionStatus(s.id, "wallet_connecting")

      const provider = getMatchingEvmProvider(walletType)
      if (!provider) {
        throw new Error(`${walletDisplayName(walletType)} was not detected. Are you opening this page inside ${walletDisplayName(walletType)}?`)
      }

      const chainId = await provider.request({ method: "eth_chainId" }).catch(() => "")
      if (String(chainId).toLowerCase() !== "0x2105" && String(chainId) !== "8453") {
        throw new Error("Wallet is not on Base network. Switch to Base in your wallet settings.")
      }

      const accountsResponse = await provider.request({ method: "eth_requestAccounts" })
      const account = Array.isArray(accountsResponse) ? String(accountsResponse[0] || "") : ""

      await patchSessionStatus(s.id, "wallet_connected")
      setPageStatus("validating")
      setStatusMessage("Validating wallet address...")

      if (normalizeAddress(account) !== normalizeAddress(s.wallet_address)) {
        throw new Error("Connected wallet does not match the merchant wallet saved for this rail.")
      }

      const txParams = s.prepared_payload.tx_params
      if (!txParams) throw new Error("Missing transaction parameters. Please start a new send from the desktop.")

      await patchSessionStatus(s.id, "approval_requested")
      setPageStatus("signing")
      setStatusMessage("Waiting for transaction approval in wallet...")

      const rawResult = await provider.request({
        method: "eth_sendTransaction",
        params: [{
          from:  account || txParams.from,
          to:    txParams.to,
          value: txParams.value,
          data:  txParams.data,
          gas:   txParams.gas,
        }]
      })

      const txHash = String(rawResult || "").trim()
      if (!txHash) throw new Error("Wallet connected, but transaction approval was not completed.")

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

      if (!signature) throw new Error("Wallet connected, but transaction approval was not completed.")

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

      if (!signature) throw new Error("Wallet connected, but transaction approval was not completed.")

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
      return
    }

    const connectUrl = buildPhantomConnectUrl(
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
      return
    }

    const connectUrl = buildSolflareConnectUrl(
      `${baseRedirect}?solflare_action=connect`,
      appUrl
    )
    window.location.href = connectUrl
  }

  function startEvmWalletApproval(walletType: WalletType) {
    if (!session) return

    // If already inside the wallet's browser, sign directly
    if (isInsideEvmWalletBrowser(walletType)) {
      setPageStatus("in_wallet_browser")
      return
    }

    // Otherwise open the wallet's in-app browser pointing at this page with
    // a param that triggers auto-connect when the wallet's provider is injected.
    const appUrl = getAppUrl()
    const targetUrl = `${appUrl}/wallet-approval/${session.id}?in_wallet=1`
    const deepLink = buildEvmWalletBrowserDeepLink(walletType, targetUrl)
    window.location.href = deepLink
  }

  // Re-detect wallet browser if we came from a deep link
  useEffect(() => {
    if (!session || pageStatus !== "ready") return
    const searchParams = new URLSearchParams(window.location.search)
    if (searchParams.get("in_wallet") === "1") {
      setPageStatus("in_wallet_browser")
    }
  }, [session, pageStatus])

  // ── Render ────────────────────────────────────────────────────────────────────

  const walletType = session?.wallet_type as WalletType | undefined
  const walletName = walletType ? walletDisplayName(walletType) : "Wallet"

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-sm space-y-4">

        {/* Header */}
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[#0052FF]">
            PineTree Payments
          </p>
          <h1 className="mt-1 text-xl font-semibold text-gray-950">
            Wallet Approval
          </h1>
        </div>

        {/* Loading */}
        {pageStatus === "loading" && (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center text-sm text-gray-500">
            Loading session...
          </div>
        )}

        {/* Not found */}
        {pageStatus === "not_found" && (
          <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-center">
            <p className="text-sm font-semibold text-red-700">Session not found</p>
            <p className="mt-1 text-xs text-red-600">This approval link is invalid or has been removed.</p>
          </div>
        )}

        {/* Expired */}
        {pageStatus === "expired" && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
            <p className="text-sm font-semibold text-amber-700">Session Expired</p>
            <p className="mt-1 text-xs text-amber-600">
              This approval link has expired. Go back to the POS and start a new send.
            </p>
          </div>
        )}

        {/* Session info + action */}
        {session && !["loading", "not_found", "expired"].includes(pageStatus) && (
          <>
            {/* Transaction summary */}
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-400">
                Transaction
              </p>
              <div className="mt-3 space-y-2">
                {[
                  { label: "Wallet",      value: walletName },
                  { label: "Asset",       value: session.asset },
                  { label: "Amount",      value: `${session.amount} ${session.asset}` },
                  { label: "Destination", value: session.destination_label || formatShortAddress(session.destination_address) },
                  { label: "To address",  value: formatShortAddress(session.destination_address) },
                  { label: "Fee",         value: "Wallet will estimate" },
                  { label: "Expires in",  value: expiryDisplay || "—" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-400">
                      {label}
                    </span>
                    <span className="min-w-0 truncate text-right text-sm font-semibold text-gray-800">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Status / action card */}
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">

              {/* Ready — show approve button */}
              {pageStatus === "ready" && walletType && (
                <>
                  <p className="text-sm font-semibold text-gray-950">
                    Approve with {walletName}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-gray-500">
                    Tap to open {walletName} and approve this transaction.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (walletType === "phantom")  startPhantomApproval()
                      else if (walletType === "solflare") startSolflareApproval()
                      else startEvmWalletApproval(walletType)
                    }}
                    className="mt-3 w-full rounded-xl bg-[#0052FF] py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.98]"
                  >
                    Approve with {walletName}
                  </button>
                </>
              )}

              {/* In-wallet browser — show "auto-connecting" message, signing starts automatically */}
              {pageStatus === "in_wallet_browser" && (
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-blue-500" />
                  <p className="text-sm font-semibold text-[#0052FF]">
                    Opening {walletName}...
                  </p>
                </div>
              )}

              {pageStatus === "connecting" && (
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-blue-500" />
                  <p className="text-sm font-semibold text-[#0052FF]">
                    {statusMessage || `Connecting ${walletName}...`}
                  </p>
                </div>
              )}

              {pageStatus === "validating" && (
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-blue-500" />
                  <p className="text-sm font-semibold text-[#0052FF]">
                    Validating wallet address...
                  </p>
                </div>
              )}

              {pageStatus === "signing" && (
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-blue-500" />
                  <p className="text-sm font-semibold text-[#0052FF]">
                    Waiting for approval in {walletName}...
                  </p>
                </div>
              )}

              {pageStatus === "recording" && (
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-blue-500" />
                  <p className="text-sm font-semibold text-[#0052FF]">Recording transaction...</p>
                </div>
              )}

              {pageStatus === "submitted" && (
                <div>
                  <p className="text-sm font-semibold text-green-700">Submitted</p>
                  <p className="mt-1 text-xs leading-5 text-gray-500">
                    Transaction approved and submitted. You can close this page.
                  </p>
                </div>
              )}

              {pageStatus === "rejected" && (
                <div>
                  <p className="text-sm font-semibold text-red-700">Rejected</p>
                  <p className="mt-1 text-xs leading-5 text-gray-600">
                    {statusMessage || "Transaction was rejected in the wallet."}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      signingRef.current = false
                      setPageStatus("ready")
                      setStatusMessage("")
                    }}
                    className="mt-3 w-full rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-semibold text-gray-700 shadow-sm"
                  >
                    Try Again
                  </button>
                </div>
              )}

              {pageStatus === "failed" && (
                <div>
                  <p className="text-sm font-semibold text-red-700">Failed</p>
                  <p className="mt-1 text-xs leading-5 text-red-600">
                    {statusMessage || "An error occurred."}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      signingRef.current = false
                      setPageStatus("ready")
                      setStatusMessage("")
                    }}
                    className="mt-3 w-full rounded-xl border border-gray-200 bg-white py-2.5 text-sm font-semibold text-gray-700 shadow-sm"
                  >
                    Try Again
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
