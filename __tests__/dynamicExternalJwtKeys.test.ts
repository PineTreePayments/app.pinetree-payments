import { execFileSync } from "node:child_process"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { GET } from "@/app/.well-known/dynamic-jwks.json/route"

const envKeys = ["DYNAMIC_EXTERNAL_JWT_JWKS_PUBLIC", "DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64", "DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY"] as const
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]])) as Record<(typeof envKeys)[number], string | undefined>

describe("Dynamic external JWT key material", () => {
  beforeEach(() => {
    delete process.env.DYNAMIC_EXTERNAL_JWT_JWKS_PUBLIC
    delete process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64
    delete process.env.DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY
  })

  afterEach(() => {
    for (const key of envKeys) {
      const original = originalEnv[key]
      if (original === undefined) delete process.env[key]
      else process.env[key] = original
    }
  })

  it("key generation script outputs required setup fields", () => {
    const output = execFileSync("node", ["scripts/generate-dynamic-external-jwt-keys.mjs", "--json"], {
      cwd: process.cwd(),
      encoding: "utf8",
    })
    const parsed = JSON.parse(output) as {
      kid: string
      issuer: string
      audience: string
      jwksUrl: string
      signingKeyB64: string
      jwks: { keys: Array<Record<string, unknown>> }
    }

    expect(parsed.kid).toMatch(/^pinetree-dynamic-/)
    expect(parsed.issuer).toBeTruthy()
    expect(parsed.audience).toBe("dynamic")
    expect(parsed.jwksUrl).toContain("/.well-known/dynamic-jwks.json")
    expect(Buffer.from(parsed.signingKeyB64, "base64").toString("utf8")).toContain("BEGIN PRIVATE KEY")
    expect(parsed.jwks.keys[0]).toMatchObject({
      kid: parsed.kid,
      alg: "RS256",
      use: "sig",
      kty: "RSA",
    })
    expect(JSON.stringify(parsed.jwks)).not.toContain("PRIVATE KEY")
    expect(JSON.stringify(parsed.jwks)).not.toContain(parsed.signingKeyB64)
    expect(JSON.stringify(parsed.jwks)).not.toContain('"d"')
  })

  it("JWKS endpoint returns public key only and safe cache headers", async () => {
    process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64 = Buffer.from(
      "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
      "utf8"
    ).toString("base64")
    process.env.DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nlegacy-secret\n-----END PRIVATE KEY-----"
    process.env.DYNAMIC_EXTERNAL_JWT_JWKS_PUBLIC = JSON.stringify({
      keys: [{
        kty: "RSA",
        kid: "pinetree-test-kid",
        alg: "RS256",
        use: "sig",
        n: "public-modulus",
        e: "AQAB",
      }],
    })

    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toContain("public")
    const json = await res.json()
    const serialized = JSON.stringify(json)

    expect(json.keys[0].kid).toBe("pinetree-test-kid")
    expect(serialized).toContain("public-modulus")
    expect(serialized).not.toContain("PRIVATE KEY")
    expect(serialized).not.toContain("secret")
    expect(serialized).not.toContain(process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64)
    expect(serialized).not.toContain('"d"')
  })

  it("JWKS endpoint fails clearly when public JWKS env is missing", async () => {
    const res = await GET()
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: "dynamic_external_jwt_jwks_missing" })
  })
})
