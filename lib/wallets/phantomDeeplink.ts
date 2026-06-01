/**
 * Phantom Universal Link v1 deep link helpers.
 *
 * Protocol: X25519 ECDH shared secret + NaCl box encryption (tweetnacl).
 * Encoding: base58 for all keys, nonces, and encrypted payloads (bs58 v4).
 *
 * Nearly identical to lib/solflareDeeplink.ts but targets Phantom's endpoints
 * and uses phantom_encryption_public_key in the connect response.
 *
 * Docs: https://docs.phantom.com/phantom-deeplinks/provider-methods
 */

import nacl from "tweetnacl"
import bs58 from "bs58"

// ── Storage keys (approval-page-scoped, kept separate from Solflare keys) ─────

const KEYPAIR_KEY = "pinetree_ph_keypair"
const SESSION_KEY = "pinetree_ph_session"

// ── Types ─────────────────────────────────────────────────────────────────────

export type PhantomSession = {
  session: string      // opaque session token returned by Phantom connect
  publicKey: string    // user's Solana public key (base58)
  phPublicKey: string  // Phantom's X25519 encryption public key (base58)
}

type StoredKeypair = { publicKey: number[]; secretKey: number[] }

// ── Keypair management ────────────────────────────────────────────────────────

function loadStoredKeypair(): nacl.BoxKeyPair | null {
  try {
    const raw = sessionStorage.getItem(KEYPAIR_KEY)
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

function saveKeypair(kp: nacl.BoxKeyPair): void {
  sessionStorage.setItem(
    KEYPAIR_KEY,
    JSON.stringify({
      publicKey: Array.from(kp.publicKey),
      secretKey: Array.from(kp.secretKey),
    }),
  )
}

export function getDappKeypair(): nacl.BoxKeyPair {
  return loadStoredKeypair() ?? createAndStoreKeypair()
}

export function createAndStoreKeypair(): nacl.BoxKeyPair {
  const kp = nacl.box.keyPair()
  saveKeypair(kp)
  return kp
}

// ── Session management ────────────────────────────────────────────────────────

export function getStoredPhantomSession(): PhantomSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PhantomSession
  } catch {
    return null
  }
}

export function storePhantomSession(session: PhantomSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearPhantomSession(): void {
  sessionStorage.removeItem(SESSION_KEY)
  sessionStorage.removeItem(KEYPAIR_KEY)
}

// ── Shared-secret helper ──────────────────────────────────────────────────────

function sharedSecret(phPublicKey: string): Uint8Array {
  const kp = getDappKeypair()
  return nacl.box.before(bs58.decode(phPublicKey), kp.secretKey)
}

// ── URL builders ──────────────────────────────────────────────────────────────

/**
 * Builds a Phantom UL v1 connect URL.
 * Generates a fresh dapp keypair so each connect attempt uses a new key.
 *
 * @param redirectLink - Full URL Phantom will redirect to after connect,
 *   e.g. https://app.pinetree-payments.com/wallet-approval/abc?phantom_action=connect
 * @param appUrl - Origin of the dapp, displayed by Phantom.
 */
export function buildPhantomConnectUrl(redirectLink: string, appUrl: string): string {
  const kp = createAndStoreKeypair()
  const params = new URLSearchParams({
    dapp_encryption_public_key: bs58.encode(kp.publicKey),
    cluster: "mainnet-beta",
    app_url: appUrl,
    redirect_link: redirectLink,
  })
  return `https://phantom.app/ul/v1/connect?${params.toString()}`
}

/**
 * Builds a Phantom UL v1 signAndSendTransaction URL.
 * The transaction + session are encrypted in the payload.
 *
 * @param transactionBase64 - Base64-encoded serialized Solana transaction.
 * @param session - Active Phantom session from a prior connect.
 * @param redirectLink - Full URL Phantom will redirect to after signing.
 */
export function buildPhantomSignAndSendUrl(
  transactionBase64: string,
  session: PhantomSession,
  redirectLink: string,
): string {
  const kp = getDappKeypair()
  const nonce = nacl.randomBytes(24)
  const secret = sharedSecret(session.phPublicKey)

  // Convert base64 transaction bytes → base58 (Phantom protocol requirement)
  const txBase58 = bs58.encode(Buffer.from(transactionBase64, "base64"))

  const payload = JSON.stringify({ session: session.session, transaction: txBase58 })
  const encrypted = nacl.box.after(new TextEncoder().encode(payload), nonce, secret)

  const params = new URLSearchParams({
    dapp_encryption_public_key: bs58.encode(kp.publicKey),
    nonce: bs58.encode(nonce),
    redirect_link: redirectLink,
    payload: bs58.encode(encrypted),
  })
  return `https://phantom.app/ul/v1/signAndSendTransaction?${params.toString()}`
}

// ── Response decryption ───────────────────────────────────────────────────────

/**
 * Decrypts the Phantom connect response params.
 * Returns a PhantomSession on success, null on failure.
 *
 * Expected params added by Phantom:
 *   phantom_encryption_public_key, nonce, data
 * Decrypted data contains: { public_key, session }
 */
export function decryptPhantomConnectResponse(params: URLSearchParams): PhantomSession | null {
  try {
    const phPublicKey = params.get("phantom_encryption_public_key")
    const data = params.get("data")
    const nonce = params.get("nonce")
    if (!phPublicKey || !data || !nonce) return null

    const secret = sharedSecret(phPublicKey)
    const decrypted = nacl.box.open.after(bs58.decode(data), bs58.decode(nonce), secret)
    if (!decrypted) return null

    const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as {
      public_key?: string
      session: string
    }
    if (!parsed.public_key || !parsed.session) return null

    return { session: parsed.session, publicKey: parsed.public_key, phPublicKey }
  } catch {
    return null
  }
}

/**
 * Decrypts the Phantom signAndSendTransaction response params.
 * Returns the base58-encoded transaction signature, or null on failure.
 *
 * Expected params on success: nonce, data
 * Decrypted data contains: { signature }
 */
export function decryptPhantomSignResponse(
  params: URLSearchParams,
  phPublicKey: string,
): string | null {
  try {
    const data = params.get("data")
    const nonce = params.get("nonce")
    if (data && nonce) {
      const secret = sharedSecret(phPublicKey)
      const decrypted = nacl.box.open.after(bs58.decode(data), bs58.decode(nonce), secret)
      if (decrypted) {
        const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as {
          signature?: string
          txid?: string
        }
        const sig = parsed.signature || parsed.txid
        if (sig) return sig
      }
    }
  } catch { /* fall through */ }

  return params.get("signature") || null
}
