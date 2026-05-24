/**
 * PineTree NWC Client
 *
 * Nostr Wallet Connect (NIP-47) protocol implementation.
 * Handles: URI parsing, NIP-04 encryption, Nostr event signing,
 * WebSocket relay communication.
 *
 * Merchant-facing only. Customer payments use standard BOLT11 invoices.
 */

import crypto from "node:crypto"
import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js"
import WebSocket from "ws"

// ─── Types ───────────────────────────────────────────────────────────────────

export type NwcConnection = {
  walletPubkeyHex: string
  relay: string
  clientSecretHex: string
  clientPubkeyHex: string
  lud16?: string
}

export type NwcCapabilities = {
  canMakeInvoice: boolean
  canLookupInvoice: boolean
  canPayInvoice: boolean
  canGetBalance: boolean
  supportedMethods: string[]
  walletAlias?: string
}

export type NwcInvoiceResult = {
  invoice: string
  paymentHash: string
  description?: string
  amountMsat: number
  expiresAt?: number
  createdAt: number
}

export type NwcInvoiceStatus = {
  settled: boolean
  settledAt?: number
  paymentHash: string
  amountMsat?: number
  type: "incoming" | "outgoing"
}

export type NwcPayResult = {
  preimage: string
  feesPaidMsat?: number
}

// ─── NWC URI Parsing ─────────────────────────────────────────────────────────

/**
 * Parse and validate an NWC URI.
 * Format: nostr+walletconnect://<wallet-pubkey>?relay=<url>&secret=<hex>&lud16=<optional>
 */
export function parseNwcUri(uri: string): NwcConnection {
  const raw = String(uri || "").trim()

  if (!raw.startsWith("nostr+walletconnect://")) {
    throw new Error("Invalid NWC URI: must start with nostr+walletconnect://")
  }

  let url: URL
  try {
    url = new URL(raw.replace("nostr+walletconnect://", "https://nwc.invalid/"))
  } catch {
    throw new Error("Invalid NWC URI: malformed URI structure")
  }

  const walletPubkeyHex = url.hostname
  const relay = url.searchParams.get("relay") || ""
  const clientSecretHex = url.searchParams.get("secret") || ""
  const lud16 = url.searchParams.get("lud16") || undefined

  if (!walletPubkeyHex || !/^[0-9a-f]{64}$/i.test(walletPubkeyHex)) {
    throw new Error("Invalid NWC URI: wallet public key must be a 64-char hex string")
  }

  if (!relay || !relay.startsWith("wss://")) {
    throw new Error("Invalid NWC URI: relay must be a secure WebSocket URL (wss://)")
  }

  if (!clientSecretHex || !/^[0-9a-f]{64}$/i.test(clientSecretHex)) {
    throw new Error("Invalid NWC URI: client secret must be a 64-char hex string")
  }

  const clientPubkeyHex = derivePublicKey(clientSecretHex)

  return {
    walletPubkeyHex: walletPubkeyHex.toLowerCase(),
    relay,
    clientSecretHex: clientSecretHex.toLowerCase(),
    clientPubkeyHex,
    lud16
  }
}

export function validateNwcUri(uri: string): { valid: boolean; error?: string } {
  try {
    parseNwcUri(uri)
    return { valid: true }
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : "Invalid NWC URI" }
  }
}

/**
 * Mask the NWC URI secret for safe logging — never log the full URI.
 */
export function maskNwcUri(uri: string): string {
  try {
    const parsed = parseNwcUri(uri)
    return `nostr+walletconnect://${parsed.walletPubkeyHex.slice(0, 8)}...?relay=${parsed.relay}&secret=***MASKED***`
  } catch {
    return "nostr+walletconnect://INVALID"
  }
}

// ─── Crypto Primitives ────────────────────────────────────────────────────────

function derivePublicKey(privkeyHex: string): string {
  const privkeyBytes = hexToBytes(privkeyHex)
  const pubkeyBytes = schnorr.getPublicKey(privkeyBytes)
  return bytesToHex(pubkeyBytes)
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * NIP-04 shared secret: ECDH(privkey, "02" + walletPubkey) → x-coordinate (32 bytes)
 */
function computeSharedSecret(clientSecretHex: string, walletPubkeyHex: string): Buffer {
  const ecdh = crypto.createECDH("secp256k1")
  ecdh.setPrivateKey(Buffer.from(clientSecretHex, "hex"))
  // Nostr uses x-only pubkeys (32 bytes). For ECDH we need the compressed 33-byte form.
  const compressedPubkey = "02" + walletPubkeyHex
  const sharedPoint = ecdh.computeSecret(Buffer.from(compressedPubkey, "hex"))
  // sharedPoint is the x-coordinate (32 bytes) — this IS the NIP-04 shared secret.
  return sharedPoint
}

/**
 * NIP-04 encrypt: AES-256-CBC with random IV.
 * Output format: "<base64-cipher>?iv=<base64-iv>"
 */
function nip04Encrypt(
  plaintext: string,
  clientSecretHex: string,
  walletPubkeyHex: string
): string {
  const sharedSecret = computeSharedSecret(clientSecretHex, walletPubkeyHex)
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv("aes-256-cbc", sharedSecret, iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ])
  return `${ciphertext.toString("base64")}?iv=${iv.toString("base64")}`
}

/**
 * NIP-04 decrypt: parse "<base64-cipher>?iv=<base64-iv>" and decrypt.
 */
function nip04Decrypt(
  ciphertext: string,
  clientSecretHex: string,
  walletPubkeyHex: string
): string {
  const [cipherBase64, ivPart] = ciphertext.split("?iv=")
  if (!cipherBase64 || !ivPart) {
    throw new Error("Invalid NIP-04 ciphertext format")
  }

  const sharedSecret = computeSharedSecret(clientSecretHex, walletPubkeyHex)
  const iv = Buffer.from(ivPart, "base64")
  const cipherBuf = Buffer.from(cipherBase64, "base64")
  const decipher = crypto.createDecipheriv("aes-256-cbc", sharedSecret, iv)
  const plaintext = Buffer.concat([decipher.update(cipherBuf), decipher.final()])
  return plaintext.toString("utf8")
}

// ─── Nostr Event Creation and Signing ────────────────────────────────────────

type NostrEvent = {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

/**
 * Create a signed NIP-47 request event (kind 23194).
 * The content is NIP-04 encrypted JSON of the NWC request.
 */
function createNwcRequestEvent(
  method: string,
  params: Record<string, unknown>,
  conn: NwcConnection
): NostrEvent {
  const plaintext = JSON.stringify({ method, params })
  const encryptedContent = nip04Encrypt(plaintext, conn.clientSecretHex, conn.walletPubkeyHex)

  const created_at = Math.floor(Date.now() / 1000)
  const tags = [["p", conn.walletPubkeyHex]]
  const kind = 23194

  // Canonical serialization for event ID (NIP-01)
  const serialized = JSON.stringify([
    0,
    conn.clientPubkeyHex,
    created_at,
    kind,
    tags,
    encryptedContent
  ])

  const eventId = crypto.createHash("sha256").update(serialized).digest()
  const privkeyBytes = hexToBytes(conn.clientSecretHex)
  const sig = schnorr.sign(eventId, privkeyBytes)

  return {
    id: bytesToHex(eventId),
    pubkey: conn.clientPubkeyHex,
    created_at,
    kind,
    tags,
    content: encryptedContent,
    sig: bytesToHex(sig)
  }
}

// ─── WebSocket Relay Communication ───────────────────────────────────────────

const NWC_REQUEST_TIMEOUT_MS = 12_000

type NwcRawResponse = {
  result_type: string
  error?: { code: string; message: string }
  result?: Record<string, unknown>
}

/**
 * Send an NWC request to the relay and await the response.
 * Handles connection, subscription, event filtering, and cleanup.
 */
async function sendNwcRequest(
  method: string,
  params: Record<string, unknown>,
  conn: NwcConnection
): Promise<NwcRawResponse> {
  const event = createNwcRequestEvent(method, params, conn)

  return new Promise<NwcRawResponse>((resolve, reject) => {
    let settled = false
    const ws = new WebSocket(conn.relay)
    const subscriptionId = `pt-${Date.now()}`

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true
        ws.close()
        reject(new Error(`NWC request timeout after ${NWC_REQUEST_TIMEOUT_MS}ms (method: ${method})`))
      }
    }, NWC_REQUEST_TIMEOUT_MS)

    function done(result: NwcRawResponse | Error) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      try { ws.close() } catch { /* ignore */ }
      if (result instanceof Error) reject(result)
      else resolve(result)
    }

    ws.on("error", (err) => done(new Error(`NWC relay connection error: ${err.message}`)))

    ws.on("open", () => {
      // Subscribe to response events (kind 23195) tagged with our request event ID
      const subReq = JSON.stringify([
        "REQ",
        subscriptionId,
        {
          kinds: [23195],
          authors: [conn.walletPubkeyHex],
          "#e": [event.id]
        }
      ])
      ws.send(subReq)

      // Publish the request event
      const publishReq = JSON.stringify(["EVENT", event])
      ws.send(publishReq)
    })

    ws.on("message", (data: Buffer) => {
      let msg: unknown
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return
      }

      if (!Array.isArray(msg)) return

      const [type, , payload] = msg as [string, string, Record<string, unknown>]

      if (type !== "EVENT") return
      if (!payload || typeof payload !== "object") return

      const responseEvent = payload as {
        kind?: number
        content?: string
        tags?: string[][]
        pubkey?: string
      }

      // Verify it's the expected response kind from the wallet
      if (responseEvent.kind !== 23195) return
      if (responseEvent.pubkey !== conn.walletPubkeyHex) return

      // Verify it references our request event
      const referencedEvent = responseEvent.tags?.find(
        (tag) => tag[0] === "e" && tag[1] === event.id
      )
      if (!referencedEvent) return

      try {
        const decrypted = nip04Decrypt(
          responseEvent.content || "",
          conn.clientSecretHex,
          conn.walletPubkeyHex
        )
        const parsed = JSON.parse(decrypted) as NwcRawResponse
        done(parsed)
      } catch (err) {
        done(new Error(`Failed to decrypt NWC response: ${err instanceof Error ? err.message : String(err)}`))
      }
    })

    ws.on("close", () => {
      if (!settled) {
        done(new Error("NWC relay closed connection before response"))
      }
    })
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Test the NWC connection and return supported capabilities.
 * Calls the NWC `get_info` method.
 */
export async function testNwcConnection(uri: string): Promise<NwcCapabilities> {
  const conn = parseNwcUri(uri)
  const response = await sendNwcRequest("get_info", {}, conn)

  if (response.error) {
    throw new Error(`NWC get_info error [${response.error.code}]: ${response.error.message}`)
  }

  const result = response.result || {}
  const methods = Array.isArray(result.methods) ? (result.methods as string[]) : []

  return {
    canMakeInvoice: methods.includes("make_invoice"),
    canLookupInvoice: methods.includes("lookup_invoice"),
    canPayInvoice: methods.includes("pay_invoice"),
    canGetBalance: methods.includes("get_balance"),
    supportedMethods: methods,
    walletAlias: typeof result.alias === "string" ? result.alias : undefined
  }
}

/**
 * Create a Lightning invoice via the merchant's NWC wallet.
 * amountMsat: amount in millisatoshis.
 */
export async function makeNwcInvoice(
  uri: string,
  amountMsat: number,
  description: string,
  expirySeconds = 3600
): Promise<NwcInvoiceResult> {
  const conn = parseNwcUri(uri)
  const response = await sendNwcRequest(
    "make_invoice",
    { amount: amountMsat, description, expiry: expirySeconds },
    conn
  )

  if (response.error) {
    throw new Error(`NWC make_invoice error [${response.error.code}]: ${response.error.message}`)
  }

  const result = response.result || {}

  const invoice = String(result.invoice || "")
  const paymentHash = String(result.payment_hash || "")

  if (!invoice || !paymentHash) {
    throw new Error("NWC make_invoice returned incomplete result (missing invoice or payment_hash)")
  }

  return {
    invoice,
    paymentHash,
    description: typeof result.description === "string" ? result.description : undefined,
    amountMsat: typeof result.amount === "number" ? result.amount : amountMsat,
    expiresAt: typeof result.expiry === "number"
      ? Math.floor(Date.now() / 1000) + result.expiry
      : undefined,
    createdAt: typeof result.created_at === "number" ? result.created_at : Math.floor(Date.now() / 1000)
  }
}

/**
 * Look up the status of a Lightning invoice by payment hash.
 */
export async function lookupNwcInvoice(
  uri: string,
  paymentHash: string
): Promise<NwcInvoiceStatus> {
  const conn = parseNwcUri(uri)
  const response = await sendNwcRequest("lookup_invoice", { payment_hash: paymentHash }, conn)

  if (response.error) {
    throw new Error(`NWC lookup_invoice error [${response.error.code}]: ${response.error.message}`)
  }

  const result = response.result || {}

  return {
    settled: typeof result.settled_at === "number" && result.settled_at > 0,
    settledAt: typeof result.settled_at === "number" ? result.settled_at : undefined,
    paymentHash: String(result.payment_hash || paymentHash),
    amountMsat: typeof result.amount === "number" ? result.amount : undefined,
    type: result.type === "outgoing" ? "outgoing" : "incoming"
  }
}

/**
 * Pay a Lightning invoice from the merchant's NWC wallet.
 * Used by PineTree to collect platform fees from the merchant wallet.
 */
export async function payNwcInvoice(
  uri: string,
  bolt11: string
): Promise<NwcPayResult> {
  const conn = parseNwcUri(uri)
  const response = await sendNwcRequest("pay_invoice", { invoice: bolt11 }, conn)

  if (response.error) {
    throw new Error(`NWC pay_invoice error [${response.error.code}]: ${response.error.message}`)
  }

  const result = response.result || {}
  const preimage = String(result.preimage || "")

  if (!preimage) {
    throw new Error("NWC pay_invoice returned no preimage — payment status unknown")
  }

  return {
    preimage,
    feesPaidMsat: typeof result.fees_paid === "number" ? result.fees_paid : undefined
  }
}
