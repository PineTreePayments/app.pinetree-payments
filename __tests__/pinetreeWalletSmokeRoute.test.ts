import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { exportPKCS8, generateKeyPair } from "jose"

const adminId = "9b2f7c40-6f21-4f0e-a2ce-1f19ab7d20aa"

const mocks = vi.hoisted(() => ({
  requireAdminFromRequest: vi.fn(),
  getRouteErrorStatus: vi.fn(),
  getPineTreeWalletProfile: vi.fn(),
  getMerchantLightningProfile: vi.fn(),
  getMerchantById: vi.fn(),
}))

vi.mock("@/lib/api/adminAuth", () => ({
  requireAdminFromRequest: mocks.requireAdminFromRequest,
  getRouteErrorStatus: mocks.getRouteErrorStatus,
}))

vi.mock("@/database/pineTreeWalletProfiles", () => ({
  getPineTreeWalletProfile: mocks.getPineTreeWalletProfile,
}))

vi.mock("@/database/merchantLightningProfiles", () => ({
  getMerchantLightningProfile: mocks.getMerchantLightningProfile,
}))

vi.mock("@/database/merchants", () => ({
  getMerchantById: mocks.getMerchantById,
}))

function request(query = "") {
  return new NextRequest(`https://app.test/api/debug/pinetree-wallet/smoke${query}`, { method: "GET" })
}

const readyProfile = {
  id: "profile-1",
  merchant_id: adminId,
  merchant_email: "merchant@example.com",
  dynamic_email: "merchant@example.com",
  dynamic_user_id: "dyn_1234567890",
  base_address: "0x1234567890abcdef1234567890abcdef12345678",
  solana_address: "5FHwkrdxntdK24hgQU8qgBjn35Y1zwhz1GZwCiK1HL7v",
  status: "ready",
}

const lightningProfile = {
  id: "lightning-1",
  merchant_id: adminId,
  status: "pending",
  speed_account_id: "acct_secret_id",
  btc_address: "lnbc1secretinvoiceaddress",
}

const envKeys = [
  "NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE",
  "DYNAMIC_EXTERNAL_JWT_ISSUER",
  "DYNAMIC_EXTERNAL_JWT_AUDIENCE",
  "DYNAMIC_EXTERNAL_JWT_AUDIENCE_OVERRIDE",
  "DYNAMIC_EXTERNAL_JWT_KID",
  "DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64",
  "DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY",
  "NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID",
  "NEXT_PUBLIC_APP_URL",
] as const
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]])) as Record<(typeof envKeys)[number], string | undefined>

describe("GET /api/debug/pinetree-wallet/smoke", () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv("NODE_ENV", "test")
    vi.spyOn(console, "info").mockImplementation(() => undefined)

    const keys = await generateKeyPair("RS256", { extractable: true })
    const privateKeyPem = await exportPKCS8(keys.privateKey)
    process.env.NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE = "external_jwt"
    process.env.DYNAMIC_EXTERNAL_JWT_ISSUER = "https://app.pinetree-payments.com"
    process.env.NEXT_PUBLIC_APP_URL = "https://app.pinetree-payments.com"
    process.env.DYNAMIC_EXTERNAL_JWT_KID = "pinetree-test-kid"
    process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64 = Buffer.from(privateKeyPem, "utf8").toString("base64")
    process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID = "test-environment-id"
    delete process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE
    delete process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE_OVERRIDE
    delete process.env.DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY

    mocks.requireAdminFromRequest.mockResolvedValue(adminId)
    mocks.getRouteErrorStatus.mockReturnValue(500)
    mocks.getPineTreeWalletProfile.mockResolvedValue(readyProfile)
    mocks.getMerchantLightningProfile.mockResolvedValue(lightningProfile)
    mocks.getMerchantById.mockResolvedValue({ id: adminId, email: "merchant@example.com" })

    // No real network in tests: JWKS check and Dynamic settings/signin probes
    // are answered by this stub.
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/.well-known/dynamic-jwks.json")) {
        return new Response(JSON.stringify({ keys: [{ kid: "pinetree-test-kid" }] }), { status: 200 })
      }
      if (url.includes("/settings")) {
        return new Response(
          JSON.stringify({ environmentName: "sandbox", security: { externalAuth: { enabled: true } } }),
          { status: 200 }
        )
      }
      if (url.includes("/externalAuth/signin")) {
        return new Response(
          JSON.stringify({
            jwt: "a.b.c",
            user: {
              newUser: false,
              verifiedCredentials: [
                { format: "email", email: "merchant@example.com" },
                { format: "externalUser", public_identifier: adminId },
                { format: "blockchain", chain: "eip155", address: "0x1234567890abcdef1234567890abcdef12345678" },
                { format: "blockchain", chain: "solana", address: "5FHwkrdxntdK24hgQU8qgBjn35Y1zwhz1GZwCiK1HL7v" },
              ],
            },
          }),
          { status: 200 }
        )
      }
      return new Response("{}", { status: 404 })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const key of envKeys) {
      const original = originalEnv[key]
      if (original === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = original
      }
    }
  })

  it("requires an authenticated admin", async () => {
    mocks.requireAdminFromRequest.mockRejectedValue(Object.assign(new Error("Missing bearer token"), { status: 401 }))
    mocks.getRouteErrorStatus.mockReturnValue(401)

    const { GET } = await import("@/app/api/debug/pinetree-wallet/smoke/route")
    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(mocks.getPineTreeWalletProfile).not.toHaveBeenCalled()
  })

  it("reports the full provisioning contract state without the signin probe by default", async () => {
    const { GET } = await import("@/app/api/debug/pinetree-wallet/smoke/route")
    const response = await GET(request(`?merchant_id=${adminId}`))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      supabaseAuthOk: true,
      dynamicAuthMode: "external_jwt",
      externalJwtEnabled: true,
      dynamicJwtGeneratedOk: true,
      claims: {
        issuerMatch: true,
        audienceMatch: true,
        subjectPresent: true,
        environmentIdPresent: true,
      },
      jwksLoaded: true,
      jwksKidFound: true,
      dynamicExternalAuthEnabled: true,
      dynamicEnvironmentName: "sandbox",
      profileExists: true,
      profileStatus: "ready",
      profileHasBaseAddress: true,
      profileHasSolanaAddress: true,
      lightningStatus: "pending",
    })
    // Signin probe is opt-in; no Dynamic user should be touched by default.
    expect(body).not.toHaveProperty("dynamicJwtAcceptedOk")
    const signinCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/externalAuth/signin"))
    expect(signinCalls).toHaveLength(0)
  })

  it("verifies Dynamic accepts the signed JWT and reports embedded user/wallet existence with ?probe=1", async () => {
    const { GET } = await import("@/app/api/debug/pinetree-wallet/smoke/route")
    const response = await GET(request(`?merchant_id=${adminId}&probe=1`))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      dynamicJwtAcceptedOk: true,
      dynamicEmbeddedUserExists: true,
      baseWalletExists: true,
      solanaWalletExists: true,
      dynamicRejectionCode: null,
    })
  })

  it("surfaces Dynamic's rejection reason when the JWT is refused", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes("/externalAuth/signin")) {
        return new Response(
          JSON.stringify({
            code: "invalid_external_auth",
            error: "JWT is invalid",
            payload: { additionalMessages: ["Audience (aud) does not match"] },
          }),
          { status: 422 }
        )
      }
      if (url.includes("/.well-known/dynamic-jwks.json")) {
        return new Response(JSON.stringify({ keys: [{ kid: "pinetree-test-kid" }] }), { status: 200 })
      }
      return new Response("{}", { status: 404 })
    })

    const { GET } = await import("@/app/api/debug/pinetree-wallet/smoke/route")
    const response = await GET(request(`?probe=1`))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      dynamicJwtAcceptedOk: false,
      dynamicRejectionCode: "invalid_external_auth",
      dynamicRejectionMessages: ["Audience (aud) does not match"],
    })
  })

  it("reports missing profiles as null statuses", async () => {
    mocks.getPineTreeWalletProfile.mockResolvedValue(null)
    mocks.getMerchantLightningProfile.mockResolvedValue(null)

    const { GET } = await import("@/app/api/debug/pinetree-wallet/smoke/route")
    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.profileExists).toBe(false)
    expect(body.profileStatus).toBeNull()
    expect(body.profileHasBaseAddress).toBe(false)
    expect(body.profileHasSolanaAddress).toBe(false)
    expect(body.lightningStatus).toBeNull()
  })

  it("never leaks emails, wallet addresses, Dynamic IDs, JWTs, Speed fields, or secrets", async () => {
    const { GET } = await import("@/app/api/debug/pinetree-wallet/smoke/route")
    const response = await GET(request("?probe=1"))
    const raw = JSON.stringify(await response.json())

    expect(raw).not.toContain("merchant@example.com")
    expect(raw).not.toContain("@")
    expect(raw).not.toContain("0x1234567890abcdef")
    expect(raw).not.toContain("5FHwkrdxntdK24hgQU8qgBjn35Y1zwhz1GZwCiK1HL7v")
    expect(raw).not.toContain("dyn_1234567890")
    expect(raw).not.toContain("acct_secret_id")
    expect(raw).not.toContain("lnbc1")
    expect(raw).not.toContain("a.b.c")
    expect(raw).not.toContain("BEGIN PRIVATE KEY")
    expect(raw.toLowerCase()).not.toContain("password")
    expect(raw).not.toContain(process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64)
  })

  it("is disabled in production unless explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("PINETREE_WALLET_DEBUG_SMOKE_ENABLED", "false")
    vi.stubEnv("NEXT_PUBLIC_WALLET_DEBUG_EVENTS", "false")

    const { GET } = await import("@/app/api/debug/pinetree-wallet/smoke/route")
    const response = await GET(request())

    expect(response.status).toBe(404)
    expect(mocks.requireAdminFromRequest).not.toHaveBeenCalled()
  })

  it("stays available in production when PINETREE_WALLET_DEBUG_SMOKE_ENABLED is true", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("PINETREE_WALLET_DEBUG_SMOKE_ENABLED", "true")

    const { GET } = await import("@/app/api/debug/pinetree-wallet/smoke/route")
    const response = await GET(request())

    expect(response.status).toBe(200)
  })
})
