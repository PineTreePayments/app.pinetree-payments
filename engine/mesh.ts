// Server-side Mesh Connect API integration.
// MESH_CLIENT_SECRET must NEVER be exposed to the browser.
// Only call these functions from API routes (server-side only).
//
// Mesh is used for exchange connection and deposit-address import only.
// Mesh managed transfers are not enabled.

const MESH_CLIENT_ID = process.env.MESH_CLIENT_ID || ""
const MESH_CLIENT_SECRET = process.env.MESH_CLIENT_SECRET || ""
const MESH_API_BASE_URL = (process.env.MESH_API_BASE_URL || "https://integration-api.meshconnect.com").replace(/\/$/, "")

export function isMeshConfigured(): boolean {
  return Boolean(MESH_CLIENT_ID && MESH_CLIENT_SECRET)
}

// Returns the public client ID safe to send to the browser (no secret).
export function getMeshClientId(): string {
  return MESH_CLIENT_ID
}

function requireMeshConfig(): { clientId: string; clientSecret: string; baseUrl: string } {
  if (!MESH_CLIENT_ID || !MESH_CLIENT_SECRET) {
    throw Object.assign(
      new Error("Mesh is not configured on this server. Set MESH_CLIENT_ID and MESH_CLIENT_SECRET."),
      { status: 503 }
    )
  }
  return { clientId: MESH_CLIENT_ID, clientSecret: MESH_CLIENT_SECRET, baseUrl: MESH_API_BASE_URL }
}

function meshHeaders(withContentType = true): Record<string, string> {
  const { clientId, clientSecret } = requireMeshConfig()
  const headers: Record<string, string> = {
    "X-Client-Id": clientId,
    "X-Client-Secret": clientSecret,
    Accept: "application/json"
  }
  if (withContentType) headers["Content-Type"] = "application/json"
  return headers
}

// POST /api/v1/linktoken
// Creates a Mesh Link token used to initialize the Mesh Link UI on the client.
// https://docs.meshconnect.com/reference/post_api-v1-linktoken
export async function createMeshLinkToken(merchantId: string): Promise<string> {
  const { baseUrl } = requireMeshConfig()

  const res = await fetch(`${baseUrl}/api/v1/linktoken`, {
    method: "POST",
    headers: meshHeaders(),
    body: JSON.stringify({
      userId: merchantId,
      restrictMultipleAccounts: false
    })
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Mesh link token request failed (${res.status}): ${text}`)
  }

  const data = (await res.json()) as { content?: { linkToken?: string } }
  const token = data?.content?.linkToken
  if (!token) {
    throw new Error("Mesh API did not return a link token in content.linkToken")
  }
  return token
}

// Map PineTree network names to Mesh network IDs.
// Adjust these values if the Mesh API returns 400 for a networkId.
const MESH_NETWORK_ID: Record<string, string> = {
  solana: "solana",
  base: "base"
}

export type MeshDepositAddress = {
  address: string
  symbol: string
  networkId: string
  memo: string | null
  tag: string | null
}

// GET /api/v1/holdings/depositAddresses
// Returns deposit addresses for a connected exchange account.
// authToken is the short-lived access token from the Mesh SDK onIntegrationConnected callback.
// https://docs.meshconnect.com/reference/get_api-v1-holdings-depositaddresses
export async function getMeshDepositAddresses(
  authToken: string,
  symbol: string,
  network: string
): Promise<MeshDepositAddress[]> {
  const { baseUrl } = requireMeshConfig()
  const meshNetworkId = MESH_NETWORK_ID[network.toLowerCase()] || network
  const params = new URLSearchParams({ symbol: symbol.toUpperCase(), networkId: meshNetworkId })

  const res = await fetch(`${baseUrl}/api/v1/holdings/depositAddresses?${params}`, {
    headers: {
      ...meshHeaders(false),
      Authorization: `Bearer ${authToken}`
    }
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Mesh deposit address request failed (${res.status}): ${text}`)
  }

  const data = (await res.json()) as {
    content?: {
      depositAddresses?: Array<{
        id?: string
        address?: string
        symbol?: string
        networkId?: string
        memo?: string | null
        tag?: string | null
      }>
    }
  }

  return (data?.content?.depositAddresses || [])
    .map((a) => ({
      address: String(a.address || "").trim(),
      symbol: String(a.symbol || symbol).trim().toUpperCase(),
      networkId: String(a.networkId || meshNetworkId).trim(),
      memo: a.memo ? String(a.memo).trim() : null,
      tag: a.tag ? String(a.tag).trim() : null
    }))
    .filter((a) => a.address.length > 0)
}
