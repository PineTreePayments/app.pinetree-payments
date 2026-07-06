import { exportPKCS8, exportJWK, generateKeyPair, jwtVerify } from "jose"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/wallets/dynamic/external-jwt/route"
import { getMerchantById } from "@/database/merchants"

const { getUser, createClient } = vi.hoisted(() => {
  const getUser = vi.fn()
  const createClient = vi.fn(() => ({
    auth: { getUser },
  }))
  return { getUser, createClient }
})

vi.mock("@supabase/supabase-js", () => ({
  createClient,
}))

vi.mock("@/database/merchants", () => ({
  getMerchantById: vi.fn(),
}))

const envKeys = [
  "NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE",
  "DYNAMIC_EXTERNAL_JWT_ENABLED",
  "DYNAMIC_EXTERNAL_JWT_ISSUER",
  "DYNAMIC_EXTERNAL_JWT_AUDIENCE",
  "DYNAMIC_EXTERNAL_JWT_SECRET",
  "DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY",
  "DYNAMIC_EXTERNAL_JWT_KID",
  "DYNAMIC_EXTERNAL_JWT_JWKS_PUBLIC",
  "DYNAMIC_EXTERNAL_JWT_KEY_ID",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
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
    const publicJwk = await exportJWK(keys.publicKey)
    const privateKeyPem = await exportPKCS8(keys.privateKey)
    process.env.NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE = "external_jwt"
    process.env.DYNAMIC_EXTERNAL_JWT_ENABLED = "true"
    process.env.DYNAMIC_EXTERNAL_JWT_ISSUER = "pinetree"
    process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE = "dynamic"
    process.env.DYNAMIC_EXTERNAL_JWT_KID = "pinetree-test-kid"
    process.env.DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY = privateKeyPem
    process.env.DYNAMIC_EXTERNAL_JWT_JWKS_PUBLIC = JSON.stringify({
      keys: [{ ...publicJwk, kid: "pinetree-test-kid", alg: "RS256", use: "sig" }],
    })
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test"
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key"
    delete process.env.DYNAMIC_EXTERNAL_JWT_KEY_ID
    getUser.mockResolvedValue({
      data: { user: { id: "merchant-1", email: "session@example.com" } },
      error: null,
    })
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
    const res = await POST(request({ email: "attacker@example.com" }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      externalJwt: string
      externalUserId: string
      expiresAt: string
      email?: string
      diagnostics?: {
        enabled: boolean
        issuer: string
        audienceConfigured: boolean
        kidConfigured: boolean
        privateKeyConfigured: boolean
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
      issuer: "pinetree",
      audienceConfigured: true,
      kidConfigured: true,
      privateKeyConfigured: true,
    })
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

  it("makes Dynamic BYOA feature failures explicit", async () => {
    process.env.DYNAMIC_EXTERNAL_JWT_ENABLED = "false"

    const res = await POST(request())
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: "dynamic_external_jwt_not_enabled" })
  })

  it("requires server-only private key and configured kid before issuing tokens", async () => {
    delete process.env.DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY

    const res = await POST(request())
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: "dynamic_external_jwt_private_key_missing" })

    process.env.DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY = "not-a-real-key"
    delete process.env.DYNAMIC_EXTERNAL_JWT_KID
    const missingKid = await POST(request())
    expect(missingKid.status).toBe(503)
    await expect(missingKid.json()).resolves.toEqual({ error: "dynamic_external_jwt_kid_missing" })
  })
})
