import { exportPKCS8, generateKeyPair, importJWK, jwtVerify } from "jose"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { GET, POST } from "@/app/api/wallets/dynamic/external-jwt/route"
import { GET as GET_JWKS } from "@/app/.well-known/dynamic-jwks.json/route"
import { getMerchantById } from "@/database/merchants"

const { getUser, createClient, requireMerchantIdFromRequest } = vi.hoisted(() => {
  const getUser = vi.fn()
  const createClient = vi.fn(() => ({
    auth: { getUser },
  }))
  const requireMerchantIdFromRequest = vi.fn()
  return { getUser, createClient, requireMerchantIdFromRequest }
})

vi.mock("@supabase/supabase-js", () => ({
  createClient,
}))

vi.mock("@/database/merchants", () => ({
  getMerchantById: vi.fn(),
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantIdFromRequest,
}))

const envKeys = [
  "NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE",
  "DYNAMIC_EXTERNAL_JWT_ENABLED",
  "DYNAMIC_EXTERNAL_JWT_ISSUER",
  "DYNAMIC_EXTERNAL_JWT_AUDIENCE",
  "DYNAMIC_EXTERNAL_JWT_SECRET",
  "DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64",
  "DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY",
  "DYNAMIC_EXTERNAL_JWT_KID",
  "DYNAMIC_EXTERNAL_JWT_KEY_ID",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID",
] as const
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]])) as Record<(typeof envKeys)[number], string | undefined>

function request(body: Record<string, unknown> = {}, token = "supabase-token") {
  return new NextRequest("https://app.test/api/wallets/dynamic/external-jwt", {
    method: "POST",
    headers: token
      ? {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        }
      : {
          "Content-Type": "application/json",
        },
    body: JSON.stringify(body),
  })
}

describe("Dynamic external JWT route", () => {
  let publicKey: Awaited<ReturnType<typeof generateKeyPair>>["publicKey"]

  beforeEach(async () => {
    vi.clearAllMocks()
    const keys = await generateKeyPair("RS256", { extractable: true })
    publicKey = keys.publicKey
    const privateKeyPem = await exportPKCS8(keys.privateKey)
    process.env.NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE = "external_jwt"
    process.env.DYNAMIC_EXTERNAL_JWT_ENABLED = "true"
    process.env.DYNAMIC_EXTERNAL_JWT_ISSUER = "pinetree"
    process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE = "dynamic"
    process.env.DYNAMIC_EXTERNAL_JWT_KID = "pinetree-test-kid"
    process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64 = Buffer.from(privateKeyPem, "utf8").toString("base64")
    delete process.env.DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test"
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key"
    delete process.env.DYNAMIC_EXTERNAL_JWT_KEY_ID
    delete process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID
    getUser.mockResolvedValue({
      data: { user: { id: "merchant-1", email: "session@example.com" } },
      error: null,
    })
    requireMerchantIdFromRequest.mockResolvedValue("merchant-1")
    vi.mocked(getMerchantById).mockResolvedValue({
      id: "merchant-1",
      business_name: "PineTree Merchant",
      email: "merchant@example.com",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      status: "active",
    })
  })

  afterEach(() => {
    for (const key of envKeys) {
      const original = originalEnv[key]
      if (original === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = original
      }
    }
  })

  it("requires PineTree Supabase auth and rejects merchant API keys", async () => {
    const missing = await POST(request({}, ""))
    expect(missing.status).toBe(401)

    const apiKey = await POST(request({}, "pt_live_abc"))
    expect(apiKey.status).toBe(401)
    expect(createClient).not.toHaveBeenCalled()
  })

  it("uses PineTree merchant email, not client email, and emits a short-lived JWT payload", async () => {
    const res = await POST(request({ email: "attacker@example.com", walletDebug: true }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      externalJwt: string
      externalUserId: string
      expiresAt: string
      email?: string
      diagnostics?: {
        enabled: boolean
        issuerConfigured: boolean
        audienceConfigured: boolean
        kidConfigured: boolean
        signingKeyConfigured: boolean
        jwksDerivedFromSigningKey: boolean
        merchantResolved: boolean
      }
    }

    expect(json.externalJwt).toBeTruthy()
    expect(json.externalUserId).toBe("merchant-1")
    expect(json.email).toBeUndefined()

    const verified = await jwtVerify(
      json.externalJwt,
      publicKey,
      {
        issuer: "pinetree",
        audience: "dynamic",
        subject: "merchant-1",
      }
    )

    expect(verified.payload.email).toBe("merchant@example.com")
    expect(verified.payload.email).not.toBe("attacker@example.com")
    expect(verified.payload.emailVerified).toBe(true)
    expect(verified.payload.merchant_id).toBe("merchant-1")
    expect(verified.payload.jti).toEqual(expect.any(String))
    expect(verified.protectedHeader.alg).toBe("RS256")
    expect(verified.protectedHeader.kid).toBe("pinetree-test-kid")
    expect(Number(verified.payload.exp) - Number(verified.payload.iat)).toBeLessThanOrEqual(300)
    expect(new Date(json.expiresAt).getTime()).toBeGreaterThan(Date.now())
    expect(json.diagnostics).toMatchObject({
      enabled: true,
      issuerConfigured: true,
      audienceConfigured: true,
      kidConfigured: true,
      signingKeyConfigured: true,
      jwksDerivedFromSigningKey: true,
      merchantResolved: true,
    })
    expect(json.diagnostics).not.toHaveProperty("issuer")
    expect(json.diagnostics).not.toHaveProperty("jwksUrl")
    expect(json.diagnostics).not.toHaveProperty("jwksPublicConfigured")
  })

  it("route-generated JWT verifies against the derived public JWKS", async () => {
    const res = await POST(request({ walletDebug: true }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { externalJwt: string; externalUserId: string }
    const jwksRes = await GET_JWKS()
    expect(jwksRes.status).toBe(200)
    const jwks = await jwksRes.json() as { keys: Array<Record<string, unknown>> }
    const jwk = jwks.keys.find((key) => key.kid === "pinetree-test-kid")
    expect(jwk).toBeTruthy()
    const verificationKey = await importJWK(jwk!, "RS256")

    const verified = await jwtVerify(json.externalJwt, verificationKey, {
      issuer: "pinetree",
      audience: "dynamic",
      subject: "merchant-1",
    })

    expect(json.externalUserId).toBe(verified.payload.sub)
  })

  it("logs safe route diagnostics only", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)

    const res = await POST(request({ walletDebug: true }))
    expect(res.status).toBe(200)

    const routeLog = info.mock.calls.findLast((call) => call[0] === "[pinetree-dynamic-auth] external_jwt_route")
    expect(routeLog?.[1]).toMatchObject({
      enabled: true,
      issuerConfigured: true,
      audienceConfigured: true,
      kidConfigured: true,
      signingKeyConfigured: true,
      jwksDerivedFromSigningKey: true,
      userPresent: true,
      merchantResolved: true,
      status: "issued",
    })
    const serialized = JSON.stringify(routeLog?.[1])
    expect(serialized).not.toContain("merchant-1")
    expect(serialized).not.toContain("merchant@example.com")
    expect(serialized).not.toContain("BEGIN PRIVATE KEY")
    expect(serialized).not.toContain(process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64)
    expect(serialized).not.toContain("jwksPublicConfigured")

    info.mockRestore()
  })

  it("decodes the base64 PEM signing key before signing", async () => {
    const res = await POST(request({ walletDebug: true }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { externalJwt: string }

    await expect(
      jwtVerify(json.externalJwt, publicKey, {
        issuer: "pinetree",
        audience: "dynamic",
        subject: "merchant-1",
      })
    ).resolves.toBeTruthy()
  })

  it("temporarily supports the legacy raw private key env fallback", async () => {
    const legacyKeys = await generateKeyPair("RS256", { extractable: true })
    publicKey = legacyKeys.publicKey
    const privateKeyPem = await exportPKCS8(legacyKeys.privateKey)
    delete process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64
    process.env.DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY = privateKeyPem

    const res = await POST(request())
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      externalJwt: string
      diagnostics?: { signingKeyConfigured: boolean }
    }
    expect(json.diagnostics?.signingKeyConfigured).toBe(true)
    await expect(
      jwtVerify(json.externalJwt, publicKey, {
        issuer: "pinetree",
        audience: "dynamic",
        subject: "merchant-1",
      })
    ).resolves.toBeTruthy()
  })

  it("omits audience when no audience is configured", async () => {
    process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE = ""

    const res = await POST(request())
    expect(res.status).toBe(200)
    const json = (await res.json()) as { externalJwt: string; externalUserId: string }
    const verified = await jwtVerify(json.externalJwt, publicKey, {
      issuer: "pinetree",
      subject: "merchant-1",
    })

    expect(json.externalUserId).toBe(verified.payload.sub)
    expect(verified.payload.aud).toBeUndefined()
  })

  it("falls back to NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID when DYNAMIC_EXTERNAL_JWT_AUDIENCE is unset", async () => {
    process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE = ""
    process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID = "ea6b03bc-04c8-43b0-9b21-98248857d020"

    const res = await POST(request())
    expect(res.status).toBe(200)
    const json = (await res.json()) as { externalJwt: string }
    const verified = await jwtVerify(json.externalJwt, publicKey, {
      issuer: "pinetree",
      audience: "ea6b03bc-04c8-43b0-9b21-98248857d020",
      subject: "merchant-1",
    })

    expect(verified.payload.aud).toBe("ea6b03bc-04c8-43b0-9b21-98248857d020")
  })

  it("falls back to NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID when DYNAMIC_EXTERNAL_JWT_AUDIENCE is still the placeholder value 'dynamic'", async () => {
    process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE = "dynamic"
    process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID = "ea6b03bc-04c8-43b0-9b21-98248857d020"

    const res = await POST(request())
    expect(res.status).toBe(200)
    const json = (await res.json()) as { externalJwt: string }
    const verified = await jwtVerify(json.externalJwt, publicKey, {
      issuer: "pinetree",
      audience: "ea6b03bc-04c8-43b0-9b21-98248857d020",
      subject: "merchant-1",
    })

    expect(verified.payload.aud).toBe("ea6b03bc-04c8-43b0-9b21-98248857d020")
  })

  it("keeps an explicitly configured non-placeholder audience unchanged even when NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID is set", async () => {
    process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE = "custom-confirmed-audience"
    process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID = "ea6b03bc-04c8-43b0-9b21-98248857d020"

    const res = await POST(request())
    expect(res.status).toBe(200)
    const json = (await res.json()) as { externalJwt: string }
    const verified = await jwtVerify(json.externalJwt, publicKey, {
      issuer: "pinetree",
      audience: "custom-confirmed-audience",
      subject: "merchant-1",
    })

    expect(verified.payload.aud).toBe("custom-confirmed-audience")
  })

  it("includes both the documented emailVerified claim and the standard email_verified claim", async () => {
    const res = await POST(request())
    expect(res.status).toBe(200)
    const json = (await res.json()) as { externalJwt: string }
    const verified = await jwtVerify(json.externalJwt, publicKey, {
      issuer: "pinetree",
      audience: "dynamic",
      subject: "merchant-1",
    })

    expect(verified.payload.emailVerified).toBe(true)
    expect(verified.payload.email_verified).toBe(true)
  })

  it("logs dynamic_jwt_claims_config_check with booleans only, never raw claim values", async () => {
    process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID = "ea6b03bc-04c8-43b0-9b21-98248857d020"
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined)

    const res = await POST(request())
    expect(res.status).toBe(200)

    const configCheckLog = info.mock.calls.findLast((call) => call[0] === "[pinetree-wallets] dynamic_jwt_claims_config_check")
    expect(configCheckLog?.[1]).toEqual({
      issuerPresent: true,
      audiencePresent: true,
      audienceMatchesDynamicEnv: true,
      kidPresent: true,
      algRs256: true,
      subjectPresent: true,
      emailPresent: true,
    })
    const serialized = JSON.stringify(configCheckLog?.[1])
    expect(serialized).not.toContain("merchant-1")
    expect(serialized).not.toContain("merchant@example.com")
    expect(serialized).not.toContain("pinetree")

    info.mockRestore()
  })

  it("makes Dynamic BYOA feature failures explicit", async () => {
    process.env.DYNAMIC_EXTERNAL_JWT_ENABLED = "false"

    const res = await POST(request())
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      error: "dynamic_external_jwt_not_enabled",
      diagnostics: {
        enabled: false,
        merchantResolved: false,
      },
    })
  })

  it("requires server-only signing key and configured kid before issuing tokens", async () => {
    delete process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64
    delete process.env.DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY

    const res = await POST(request())
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      error: "dynamic_external_jwt_signing_key_missing",
      diagnostics: {
        signingKeyConfigured: false,
        merchantResolved: true,
      },
    })

    delete process.env.DYNAMIC_EXTERNAL_JWT_KID
    const missingKid = await POST(request())
    expect(missingKid.status).toBe(503)
    await expect(missingKid.json()).resolves.toMatchObject({
      error: "dynamic_external_jwt_kid_missing",
      diagnostics: {
        kidConfigured: false,
        signingKeyConfigured: false,
        merchantResolved: true,
      },
    })
  })

  it("fails clearly when the base64 signing key is invalid", async () => {
    process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64 = "not-a-real-base64-key"

    const res = await POST(request())
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({
      error: "dynamic_external_jwt_signing_key_invalid",
      diagnostics: {
        signingKeyConfigured: true,
        merchantResolved: true,
      },
    })
  })

  it("GET returns safe diagnostics only and never issues a token", async () => {
    const res = await GET(request())
    expect(res.status).toBe(200)
    const json = await res.json() as Record<string, unknown>

    expect(json).toMatchObject({
      diagnostics: {
        enabled: true,
        issuerConfigured: true,
        audienceConfigured: true,
        kidConfigured: true,
        signingKeyConfigured: true,
        merchantResolved: true,
      },
    })
    expect(json).not.toHaveProperty("externalJwt")
    expect(json).not.toHaveProperty("externalUserId")
    expect(JSON.stringify(json)).not.toContain("merchant@example.com")
    expect(JSON.stringify(json)).not.toContain("BEGIN PRIVATE KEY")
  })
})
