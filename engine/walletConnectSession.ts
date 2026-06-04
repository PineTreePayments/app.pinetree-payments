import {
  deleteWalletConnectSession,
  getWalletConnectSessionById,
  upsertWalletConnectSession
} from "@/database/walletConnectSessions"

function getWalletSetupPath(provider: string) {
  if (provider === "solana") return "/solana-return"
  if (provider === "base") return "/base-wallet-setup"
  throw new Error("Unsupported wallet setup provider")
}

function buildWalletSetupDeepLink(input: {
  provider: string
  walletType: string
  setupUrl: string
}) {
  if (input.provider === "solana") {
    if (input.walletType === "PHANTOM") {
      return `https://phantom.app/ul/browse/${encodeURIComponent(input.setupUrl)}`
    }

    if (input.walletType === "SOLFLARE") {
      return `https://solflare.com/ul/v1/browse/${encodeURIComponent(input.setupUrl)}`
    }

    throw new Error("Unsupported Solana wallet type")
  }

  if (input.provider === "base") {
    if (input.walletType === "METAMASK") {
      return `metamask://dapp?url=${encodeURIComponent(input.setupUrl)}`
    }

    if (input.walletType === "TRUST") {
      return `trust://dapp?url=${encodeURIComponent(input.setupUrl)}`
    }

    if (input.walletType === "BASEAPP") {
      return `cbwallet://dapp?url=${encodeURIComponent(input.setupUrl)}`
    }

    throw new Error("Unsupported Base wallet type")
  }

  throw new Error("Unsupported wallet setup provider")
}

export function generateWalletConnectSessionQrEngine(input: {
  sessionId: string
  provider: string
  walletType: string
  origin: string
  returnTo?: string | null
}) {
  const sessionId = String(input.sessionId || "").trim()
  if (!sessionId) {
    throw new Error("Missing session_id")
  }

  const provider = String(input.provider || "").trim().toLowerCase()
  const walletType = String(input.walletType || "").trim().toUpperCase()
  const origin = String(input.origin || "").trim()

  if (!origin) throw new Error("Missing origin")

  const setupUrl = new URL(`${origin}${getWalletSetupPath(provider)}`)
  setupUrl.searchParams.set("provider", provider)
  setupUrl.searchParams.set("wallet_type", walletType)
  setupUrl.searchParams.set("session_id", sessionId)
  setupUrl.searchParams.set("return_to", input.returnTo || `${origin}/dashboard/providers`)

  const uri = buildWalletSetupDeepLink({
    provider,
    walletType,
    setupUrl: setupUrl.toString()
  })
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(uri)}`

  return {
    session_id: sessionId,
    setup_url: setupUrl.toString(),
    uri,
    qr
  }
}

export async function getWalletConnectSessionEngine(input: { sessionId: string }) {
  return getWalletConnectSessionById(input.sessionId)
}

export async function upsertWalletConnectSessionEngine(input: {
  session_id: string
  merchant_id?: string | null
  provider: string
  wallet_type?: string | null
  wallet_address?: string | null
  status?: string
}) {
  return upsertWalletConnectSession({
    ...input,
    updated_at: new Date().toISOString()
  })
}

export async function deleteWalletConnectSessionEngine(input: { session_id: string }) {
  await deleteWalletConnectSession(input.session_id)
  return { ok: true }
}
