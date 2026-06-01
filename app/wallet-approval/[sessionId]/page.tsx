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
  // Pending sign URLs stored after connect so the user taps a button to open
  // the transaction deeplink — iOS Universal Links require a real user gesture.
  const [pendingPhantomSignUrl, setPendingPhantomSignUrl] = useState<string>("")
  const [pendingSolflareSignUrl, setPendingSolflareSignUrl] = useState<string>("")
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

    const sid = loadedSession.id
    const appUrl = getAppUrl()
    const baseRedirect = `${appUrl}/wallet-approval/${sid}`

    // Safe debug logging — no private keys, secrets, or decrypted payloads
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

    // Phantom returns errorCode + errorMessage on any failure (user rejection,
    // technical errors, or expired blockhash).  Distinguish user rejection
    // (4001 / cancel / decline) from technical failures (4200 "method not
    // supported", simulation failures, etc.) so the UI message is accurate.
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
        // 4200 "This method is not supported" is returned when the Universal Link
        // deeplink opens Phantom's web server instead of the app (no user gesture),
        // or when Phantom cannot process the transaction.
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
        // Recoverable — do not mark session as permanently failed on server
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
        // Recoverable — do not mark session as permanently failed on server
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
      // Fire and forget — status patches must not be awaited before the redirect
      // because awaiting breaks the iOS user-gesture context.
      patchSessionStatus(sid, "wallet_connected").catch(() => {})

      const txBase64 = loadedSession.prepared_payload.unsigned_tx_base64
      if (!txBase64) {
        setStatusMessage("Missing prepared transaction data.")
        setPageStatus("failed")
        await patchSessionStatus(sid, "failed", "Missing unsigned_tx_base64")
        return true
      }

      console.debug("[Phantom connect] building signAndSend URL", {
        sessionId: sid,
        hasTx: Boolean(txBase64),
        txLength: txBase64.length,
        redirectBase: baseRedirect,
      })

      // Build the signing deeplink synchronously, then show a button.
      // iOS Universal Links are only intercepted by Phantom when navigation is
      // triggered by a real user gesture (tap).  A programmatic window.location.href
      // set after async operations loses the gesture context and Phantom's web
      // server returns 4200 "This method is not supported" instead of opening the app.
      const signUrl = buildPhantomSignAndSendUrl(
        sid,
        txBase64,
        phantomSession,
        `${baseRedirect}?phantom_action=sign`
      )
      patchSessionStatus(sid, "approval_requested").catch(() => {})
      setPendingPhantomSignUrl(signUrl)
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

      const signature = decryptPhantomSignResponse(sid, searchParams, phantomSession.phPublicKey)
      if (!signature) {
        console.debug("[Phantom sign decrypt failed]", { sessionId: sid, hasData: searchParams.has("data"), hasNonce: searchParams.has("nonce") })
        setStatusMessage("Failed to extract signature from Phantom response.")
        setPageStatus("failed")
        await patchSessionStatus(sid, "failed", "Phantom sign decrypt failed")
        return true
      }

      clearPhantomSession(sid)
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

  const handleSolflareCallback = useCallback(async (
    searchParams: URLSearchParams,
    loadedSession: SessionData
  ) => {
    const action = searchParams.get("solflare_action")
    if (!action) return false

    const sid = loadedSession.id
    const appUrl = getAppUrl()
    const baseRedirect = `${appUrl}/wallet-approval/${sid}`

    // Safe debug logging — no private keys, secrets, or decrypted payloads
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

    // Same distinction as Phantom: 4001 = user rejection, anything else = technical error
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
        // Recoverable — do not mark session as permanently failed on server
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
        // Recoverable — do not mark session as permanently failed on server
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
      // Fire and forget — do not await before showing button (iOS gesture context)
      patchSessionStatus(sid, "wallet_connected").catch(() => {})

      const txBase64 = loadedSession.prepared_payload.unsigned_tx_base64
      if (!txBase64) {
        setStatusMessage("Missing prepared transaction data.")
        setPageStatus("failed")
        await patchSessionStatus(sid, "failed", "Missing unsigned_tx_base64")
        return true
      }

      console.debug("[Solflare connect] building signAndSend URL", {
        sessionId: sid,
        hasTx: Boolean(txBase64),
        txLength: txBase64.length,
        redirectBase: baseRedirect,
      })

      // Same gesture-context pattern as Phantom: store URL, show tap button
      const signUrl = buildSolflareSignAndSendUrl(
        txBase64,
        solflareSession,
        `${baseRedirect}?solflare_action=sign`,
        sid
      )
      patchSessionStatus(sid, "approval_requested").catch(() => {})
      setPendingSolflareSignUrl(signUrl)
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
        // Try to read the server error message for a better hint
        const errBody = await res.json().catch(() => null) as { error?: string } | null
        setStatusMessage(errBody?.error || "Approval session not found. It may have expired or the link may be invalid. Create a new QR from PineTree.")
        setPageStatus("not_found")
        return
      }

      if (res.status === 401) {
        // Diagnostic: the mobile approval endpoint still requires login.
        // After the middleware bypass is deployed this should never happen.
        console.error("[wallet-approval] session load returned 401 — mobile approval endpoint still requires login", { sessionId })
        setStatusMessage(
          "Approval session could not be loaded because the mobile approval endpoint still requires login. " +
          "This approval page must be public-safe by session link."
        )
        setPageStatus("not_found")
        return
      }

      if (!res.ok) {
        // 500 or other server error — surface the real error from the API
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
        // Try to switch to Base before failing hard
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x2105" }],
          })
        } catch {
          throw new Error(
            "Wallet is not on Base network. Switch to Base in your wallet settings and try again."
          )
        }
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
      return
    }

    const connectUrl = buildSolflareConnectUrl(
      `${baseRedirect}?solflare_action=connect`,
      appUrl,
      session.id
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

        {/* Not found / load error */}
        {pageStatus === "not_found" && (
          <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-center">
            <p className="text-sm font-semibold text-red-700">Session not found</p>
            <p className="mt-1 text-xs text-red-600">
              {statusMessage || "This approval link is invalid or has been removed."}
            </p>
          </div>
        )}

        {/* Expired */}
        {pageStatus === "expired" && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
            <p className="text-sm font-semibold text-amber-700">Session Expired</p>
            <p className="mt-1 text-xs text-amber-600">
              Approval session expired. Return to PineTree and create a new QR.
            </p>
          </div>
        )}

        {/* Session info + action */}
        {session && !["loading", "not_found", "expired"].includes(pageStatus as string) && (
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

              {/* Phantom connected — wallet approved PineTree; user must tap to open signing deeplink */}
              {pageStatus === "phantom_connected" && (
                <div>
                  <p className="text-sm font-semibold text-green-700">Phantom connected</p>
                  <p className="mt-1 text-xs leading-5 text-gray-500">
                    Tap below to open Phantom and approve the transaction.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (pendingPhantomSignUrl) window.location.href = pendingPhantomSignUrl
                    }}
                    className="mt-3 w-full rounded-xl bg-[#0052FF] py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.98]"
                  >
                    Approve Transaction in Phantom
                  </button>
                </div>
              )}

              {/* Solflare connected — wallet approved PineTree; user must tap to open signing deeplink */}
              {pageStatus === "solflare_connected" && (
                <div>
                  <p className="text-sm font-semibold text-green-700">Solflare connected</p>
                  <p className="mt-1 text-xs leading-5 text-gray-500">
                    Tap below to open Solflare and approve the transaction.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (pendingSolflareSignUrl) window.location.href = pendingSolflareSignUrl
                    }}
                    className="mt-3 w-full rounded-xl bg-[#0052FF] py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.98]"
                  >
                    Approve Transaction in Solflare
                  </button>
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
                      if (session?.wallet_type === "phantom")  clearPhantomSession(session.id)
                      else if (session?.wallet_type === "solflare") clearSolflareSession(session.id)
                      signingRef.current = false
                      setPendingPhantomSignUrl("")
                      setPendingSolflareSignUrl("")
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
                      if (session?.wallet_type === "phantom")  clearPhantomSession(session.id)
                      else if (session?.wallet_type === "solflare") clearSolflareSession(session.id)
                      signingRef.current = false
                      setPendingPhantomSignUrl("")
                      setPendingSolflareSignUrl("")
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
