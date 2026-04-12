import {
  deleteWalletConnectSession,
  getWalletConnectSessionById,
  upsertWalletConnectSession
} from "@/database/walletConnectSessions"

export function generateWalletConnectSessionQrEngine(input: { sessionId: string }) {
  const sessionId = String(input.sessionId || "").trim()
  if (!sessionId) {
    throw new Error("Missing session_id")
  }

  const projectId = String(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "").trim()
  if (!projectId) {
    throw new Error("Missing WalletConnect Project ID")
  }

  const symKey = crypto.randomUUID()
  const uri = `wc:${sessionId}@2?relay-protocol=irn&symKey=${symKey}&projectId=${projectId}`
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(uri)}`

  return {
    session_id: sessionId,
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
