import nacl from "tweetnacl"
import bs58 from "bs58"

export type ServerSolflareSession = {
  session: string
  publicKey: string
  sfPublicKey: string
}

type ConnectDecryptInput = {
  solflareEncryptionPublicKey: string
  nonce: string
  data: string
  dappSecretKey: number[]
}

type SignDecryptInput = {
  solflareEncryptionPublicKey: string
  nonce?: string | null
  data?: string | null
  rawSignature?: string | null
  dappSecretKey: number[]
}

function toSecretKey(secretKey: number[]): Uint8Array {
  return new Uint8Array(secretKey)
}

export function createServerSolflareKeypair(): {
  publicKey: string
  secretKey: number[]
} {
  const keypair = nacl.box.keyPair()
  return {
    publicKey: bs58.encode(keypair.publicKey),
    secretKey: Array.from(keypair.secretKey),
  }
}

export function buildServerConnectUrl(input: {
  redirectLink: string
  appUrl: string
  dappPublicKey: string
}): string {
  const params = new URLSearchParams({
    dapp_encryption_public_key: input.dappPublicKey,
    cluster: "mainnet-beta",
    app_url: input.appUrl,
    redirect_link: input.redirectLink,
  })

  return `https://solflare.com/ul/v1/connect?${params.toString()}`
}

export function decryptServerConnectResponse(
  input: ConnectDecryptInput,
): ServerSolflareSession | null {
  try {
    const secret = nacl.box.before(
      bs58.decode(input.solflareEncryptionPublicKey),
      toSecretKey(input.dappSecretKey),
    )
    const decrypted = nacl.box.open.after(
      bs58.decode(input.data),
      bs58.decode(input.nonce),
      secret,
    )

    if (!decrypted) return null

    const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as {
      public_key?: string
      publicKey?: string
      session?: string
    }
    const publicKey = parsed.public_key || parsed.publicKey
    if (!publicKey || !parsed.session) return null

    return {
      publicKey,
      session: parsed.session,
      sfPublicKey: input.solflareEncryptionPublicKey,
    }
  } catch {
    return null
  }
}

export function buildServerSignAndSendUrl(input: {
  transactionBase64: string
  session: string
  solflareEncryptionPublicKey: string
  dappPublicKey: string
  dappSecretKey: number[]
  redirectLink: string
}): string {
  const nonce = nacl.randomBytes(24)
  const secret = nacl.box.before(
    bs58.decode(input.solflareEncryptionPublicKey),
    toSecretKey(input.dappSecretKey),
  )
  const transaction = bs58.encode(Buffer.from(input.transactionBase64, "base64"))
  const payload = JSON.stringify({ session: input.session, transaction })
  const encrypted = nacl.box.after(new TextEncoder().encode(payload), nonce, secret)

  const params = new URLSearchParams({
    dapp_encryption_public_key: input.dappPublicKey,
    nonce: bs58.encode(nonce),
    redirect_link: input.redirectLink,
    payload: bs58.encode(encrypted),
  })

  return `https://solflare.com/ul/v1/signAndSendTransaction?${params.toString()}`
}

export function decryptServerSignResponse(input: SignDecryptInput): string | null {
  try {
    if (input.data && input.nonce) {
      const secret = nacl.box.before(
        bs58.decode(input.solflareEncryptionPublicKey),
        toSecretKey(input.dappSecretKey),
      )
      const decrypted = nacl.box.open.after(
        bs58.decode(input.data),
        bs58.decode(input.nonce),
        secret,
      )

      if (decrypted) {
        const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as {
          signature?: string
          txid?: string
          transaction_signature?: string
        }
        const signature = parsed.signature || parsed.txid || parsed.transaction_signature
        if (signature) return signature
      }
    }
  } catch {
    // Fall through to raw signature fallback.
  }

  return input.rawSignature || null
}