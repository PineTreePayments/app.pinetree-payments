/**
 * Solflare Universal Link v1 deep link helpers.
 *
 * Protocol: X25519 ECDH shared secret + NaCl box encryption (tweetnacl).
 * Encoding: base58 for all keys, nonces, and encrypted payloads (bs58 v4).
 *
 * When sessionId is provided, storage uses session-scoped localStorage keys
 * (pinetree_sf_keypair_{sessionId} / pinetree_sf_session_{sessionId}) so the
 * keypair survives iOS Safari app-switch redirects.
 *
 * When sessionId is omitted, the original sessionStorage behaviour is
 * preserved for backward compatibility with other callers (PayClient etc.).
 *
 * Docs: https://docs.solflare.com/solflare/technical/deeplinks
 */

import nacl from "tweetnacl"
import bs58 from "bs58"

// ── Storage keys (no-sessionId path, original behaviour) ─────────────────────

const KEYPAIR_KEY = "pinetree_sf_keypair"
const SESSION_KEY = "pinetree_sf_session"
const PENDING_PID_KEY = "pinetree_sf_pending_pid"

// ── Types ─────────────────────────────────────────────────────────────────────

export type SolflareSession = {
  session: string     // opaque session token returned by Solflare connect
  publicKey: string   // user's Solana public key (base58)
  sfPublicKey: string // Solflare's X25519 encryption public key (base58)
}

type StoredKeypair = { publicKey: number[]; secretKey: number[] }

// ── Keypair management ────────────────────────────────────────────────────────

function loadStoredKeypair(sessionId?: string): nacl.BoxKeyPair | null {
  try {
    const storage = sessionId ? localStorage : sessionStorage
    const key = sessionId ? `pinetree_sf_keypair_${sessionId}` : KEYPAIR_KEY
    const raw = storage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredKeypair
    return {
      publicKey: new Uint8Array(parsed.publicKey),
      secretKey: new Uint8Array(parsed.secretKey),
    }
  } catch {
    return null
  }
}

function saveKeypair(kp: nacl.BoxKeyPair, sessionId?: string): void {
  const storage = sessionId ? localStorage : sessionStorage
  const key = sessionId ? `pinetree_sf_keypair_${sessionId}` : KEYPAIR_KEY
  storage.setItem(
    key,
    JSON.stringify({
      publicKey: Array.from(kp.publicKey),
      secretKey: Array.from(kp.secretKey),
    }),
  )
}

/**
 * Returns the stored dapp X25519 keypair, or creates a new one.
 * When sessionId is provided, uses localStorage (survives iOS app-switch).
 */
export function getDappKeypair(sessionId?: string): nacl.BoxKeyPair {
  return loadStoredKeypair(sessionId) ?? createAndStoreKeypair(sessionId)
}

/**
 * Generates a fresh dapp keypair and persists it.
 * Call once per connect attempt so each session starts clean.
 */
export function createAndStoreKeypair(sessionId?: string): nacl.BoxKeyPair {
  const kp = nacl.box.keyPair()
  saveKeypair(kp, sessionId)
  return kp
}

// ── Session management ────────────────────────────────────────────────────────

export function getStoredSession(sessionId?: string): SolflareSession | null {
  try {
    const storage = sessionId ? localStorage : sessionStorage
    const key = sessionId ? `pinetree_sf_session_${sessionId}` : SESSION_KEY
    const raw = storage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as SolflareSession
  } catch {
    return null
  }
}

export function storeSession(session: SolflareSession, sessionId?: string): void {
  if (sessionId) {
    localStorage.setItem(`pinetree_sf_session_${sessionId}`, JSON.stringify(session))
  } else {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  }
}

export function clearSolflareSession(sessionId?: string): void {
  if (sessionId) {
    localStorage.removeItem(`pinetree_sf_keypair_${sessionId}`)
    localStorage.removeItem(`pinetree_sf_session_${sessionId}`)
  } else {
    sessionStorage.removeItem(SESSION_KEY)
    sessionStorage.removeItem(KEYPAIR_KEY)
    sessionStorage.removeItem(PENDING_PID_KEY)
  }
}

// ── Pending payment ID (bridged across the connect redirect) ──────────────────

export function storePendingPaymentId(id: string): void {
  sessionStorage.setItem(PENDING_PID_KEY, id)
}

/** Returns and removes the stored pending payment ID. */
export function consumePendingPaymentId(): string | null {
  const id = sessionStorage.getItem(PENDING_PID_KEY)
  if (id) sessionStorage.removeItem(PENDING_PID_KEY)
  return id
}

// ── Shared-secret helper ──────────────────────────────────────────────────────

function sharedSecret(sfPublicKey: string, sessionId?: string): Uint8Array {
  const kp = getDappKeypair(sessionId)
  return nacl.box.before(bs58.decode(sfPublicKey), kp.secretKey)
}

// ── URL builders ──────────────────────────────────────────────────────────────

/**
 * Builds a Solflare UL v1 connect URL.
 * Generates a fresh dapp keypair so each connect attempt uses a new key.
 *
 * @param redirectLink - Full URL Solflare will redirect to after connect,
 *   e.g. https://example.com/pay?intent=abc&solflare_action=connect_callback
 * @param appUrl       - Origin of the dapp, used by Solflare to display dapp metadata.
 * @param sessionId    - When provided, keypair is stored in session-scoped localStorage.
 */
export function buildConnectUrl(
  redirectLink: string,
  appUrl: string,
  sessionId?: string,
): string {
  const kp = createAndStoreKeypair(sessionId)
  const params = new URLSearchParams({
    dapp_encryption_public_key: bs58.encode(kp.publicKey),
    cluster: "mainnet-beta",
    app_url: appUrl,
    redirect_link: redirectLink,
  })
  return `https://solflare.com/ul/v1/connect?${params.toString()}`
}

/**
 * Builds a Solflare UL v1 signAndSendTransaction URL.
 * The transaction + session are encrypted in the payload.
 *
 * @param transactionBase64 - Base64-encoded serialized Solana transaction.
 * @param session           - Active Solflare session from a prior connect.
 * @param redirectLink      - Full URL Solflare will redirect to after signing.
 * @param sessionId         - When provided, reads keypair from session-scoped localStorage.
 */
export function buildSignAndSendUrl(
  transactionBase64: string,
  session: SolflareSession,
  redirectLink: string,
  sessionId?: string,
): string {
  const kp = getDappKeypair(sessionId)
  const nonce = nacl.randomBytes(24)
  const secret = sharedSecret(session.sfPublicKey, sessionId)

  // Convert base64 transaction bytes → base58 (Solflare protocol requirement)
  const txBase58 = bs58.encode(Buffer.from(transactionBase64, "base64"))

  const payload = JSON.stringify({ session: session.session, transaction: txBase58 })
  const encrypted = nacl.box.after(new TextEncoder().encode(payload), nonce, secret)

  const params = new URLSearchParams({
    dapp_encryption_public_key: bs58.encode(kp.publicKey),
    nonce: bs58.encode(nonce),
    redirect_link: redirectLink,
    payload: bs58.encode(encrypted),
  })
  return `https://solflare.com/ul/v1/signAndSendTransaction?${params.toString()}`
}

// ── Response decryption ───────────────────────────────────────────────────────

/**
 * Decrypts the Solflare connect response params.
 * Returns a SolflareSession on success, null on failure.
 *
 * Expected params added by Solflare:
 *   solflare_encryption_public_key, nonce, data
 * Decrypted data contains: { public_key, session }
 *
 * @param sessionId - When provided, reads keypair from session-scoped localStorage.
 */
export function decryptConnectResponse(
  params: URLSearchParams,
  sessionId?: string,
): SolflareSession | null {
  try {
    const sfPublicKey = params.get("solflare_encryption_public_key")
    const data = params.get("data")
    const nonce = params.get("nonce")
    if (!sfPublicKey || !data || !nonce) return null

    const secret = sharedSecret(sfPublicKey, sessionId)
    const decrypted = nacl.box.open.after(bs58.decode(data), bs58.decode(nonce), secret)
    if (!decrypted) return null

    const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as {
      public_key?: string
      publicKey?: string
      session: string
    }
    // Solflare may return either field name depending on version
    const userPublicKey = parsed.public_key || parsed.publicKey
    if (!userPublicKey || !parsed.session) return null

    return { session: parsed.session, publicKey: userPublicKey, sfPublicKey }
  } catch {
    return null
  }
}

/**
 * Decrypts the Solflare signAndSendTransaction response params.
 * Returns the base58-encoded transaction signature, or null on failure.
 *
 * Expected params added by Solflare on success: nonce, data
 * Decrypted data contains: { signature }
 * Falls back to reading the unencrypted `signature` param if decryption fails.
 *
 * @param sessionId - When provided, reads keypair from session-scoped localStorage.
 */
export function decryptSignResponse(
  params: URLSearchParams,
  sfPublicKey: string,
  sessionId?: string,
): string | null {
  try {
    const data = params.get("data")
    const nonce = params.get("nonce")
    if (data && nonce) {
      const secret = sharedSecret(sfPublicKey, sessionId)
      const decrypted = nacl.box.open.after(bs58.decode(data), bs58.decode(nonce), secret)
      if (decrypted) {
        const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as {
          signature?: string
          txid?: string
          transaction_signature?: string
        }
        const sig = parsed.signature || parsed.txid || parsed.transaction_signature
        if (sig) return sig
      }
    }
  } catch { /* fall through to unencrypted fallback */ }

  // Some Solflare responses include signature unencrypted as a convenience
  return params.get("signature") || null
}
