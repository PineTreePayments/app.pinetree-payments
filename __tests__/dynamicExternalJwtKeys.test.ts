import { execFileSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { exportPKCS8, generateKeyPair } from "jose"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { GET } from "@/app/.well-known/dynamic-jwks.json/route"

const envKeys = ["DYNAMIC_EXTERNAL_JWT_KID", "DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64", "DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY"] as const
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]])) as Record<(typeof envKeys)[number], string | undefined>

function execNodeAllowFailure(args: string[], env: NodeJS.ProcessEnv) {
  try {
    return execFileSync("node", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    })
  } catch (error) {
    const output = (error as { stdout?: Buffer | string }).stdout
    return Buffer.isBuffer(output) ? output.toString("utf8") : String(output || "")
  }
}

describe("Dynamic external JWT key material", () => {
  beforeEach(() => {
    delete process.env.DYNAMIC_EXTERNAL_JWT_KID
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

    expect(output).not.toContain("JWKS_PUBLIC")
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

  async function createTestEnv(overrides: Record<string, string> = {}) {
    const keys = await generateKeyPair("RS256", { extractable: true })
    const privateKeyPem = await exportPKCS8(keys.privateKey)
    const signingKeyB64 = Buffer.from(privateKeyPem, "utf8").toString("base64")
    // NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID is set to an empty string rather than
    // deleted: the script's own loadEnvFiles() re-populates any key that's absent
    // from process.env by reading the real repo .env.local, so deleting it here
    // would silently reintroduce whatever value happens to be in that file on this
    // machine. An empty string keeps the key present (skipping the file loader)
    // while still reading as "not configured" to resolveConfiguredAudience().
    const env = { ...process.env, NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID: "" }
    return {
      signingKeyB64,
      env: {
        ...env,
        DYNAMIC_EXTERNAL_JWT_ENABLED: "true",
        DYNAMIC_EXTERNAL_JWT_ISSUER: "https://app.pinetree-payments.com",
        DYNAMIC_EXTERNAL_JWT_AUDIENCE: "dynamic",
        DYNAMIC_EXTERNAL_JWT_KID: "pinetree-test-kid",
        DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64: signingKeyB64,
        ...overrides,
      },
    }
  }

  it("dynamic:jwt:test script validates configured keypair without printing secrets", async () => {
    const { env, signingKeyB64 } = await createTestEnv()
    const output = execFileSync("node", [path.join(process.cwd(), "scripts/test-dynamic-external-jwt.mjs")], {
      cwd: os.tmpdir(),
      encoding: "utf8",
      env,
    })
    const parsed = JSON.parse(output) as {
      ok: boolean
      decodedHeader: Record<string, unknown>
      decodedPayload: Record<string, unknown>
      checks: Array<{ name: string; pass: boolean }>
    }

    expect(parsed.ok).toBe(true)
    expect(parsed.decodedHeader).toMatchObject({ alg: "RS256", kid: "pinetree-test-kid" })
    expect(parsed.decodedPayload).toMatchObject({
      iss: "https://app.pinetree-payments.com",
      aud: "dynamic",
      sub: "pinetree-dynamic-test-merchant",
      email: "dynamic-jwt-test@pinetree-payments.com",
      emailVerified: true,
      email_verified: true,
    })
    expect(parsed.checks.every((check) => check.pass)).toBe(true)
    expect(output).not.toContain(signingKeyB64)
    expect(output).not.toContain("BEGIN PRIVATE KEY")
    expect(output).not.toContain("PRIVATE KEY")
  })

  it("dynamic:jwt:test falls back to NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID and warns when DYNAMIC_EXTERNAL_JWT_AUDIENCE is still the placeholder 'dynamic'", async () => {
    const { env } = await createTestEnv({
      NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID: "ea6b03bc-04c8-43b0-9b21-98248857d020",
    })
    const output = execFileSync("node", [path.join(process.cwd(), "scripts/test-dynamic-external-jwt.mjs")], {
      cwd: os.tmpdir(),
      encoding: "utf8",
      env,
    })
    const parsed = JSON.parse(output) as {
      ok: boolean
      decodedPayload: Record<string, unknown>
      warnings: string[]
      audienceChecklist: {
        DYNAMIC_EXTERNAL_JWT_AUDIENCE: string | null
        NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID: string | null
        isPlaceholderValue: boolean
        resolvedAudienceSentInJwt: string | null
      }
    }

    expect(parsed.ok).toBe(true)
    expect(parsed.decodedPayload.aud).toBe("ea6b03bc-04c8-43b0-9b21-98248857d020")
    expect(parsed.audienceChecklist).toMatchObject({
      DYNAMIC_EXTERNAL_JWT_AUDIENCE: "dynamic",
      NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID: "ea6b03bc-04c8-43b0-9b21-98248857d020",
      isPlaceholderValue: true,
      resolvedAudienceSentInJwt: "ea6b03bc-04c8-43b0-9b21-98248857d020",
    })
    expect(parsed.warnings.some((warning) => warning.includes("placeholder"))).toBe(true)
  })

  it("dynamic:jwt:test --debug-env masks secrets and reports repo env paths", async () => {
    const { env, signingKeyB64 } = await createTestEnv()
    const output = execFileSync("node", ["scripts/test-dynamic-external-jwt.mjs", "--debug-env"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env,
    })
    const parsed = JSON.parse(output) as {
      ok: boolean
      debugEnv: {
        repoRoot: string
        envLocalPath: string
        enabledValue: boolean
        signingKeyConfigured: boolean
        signingKeyLength: number
        jwksDerivationSucceeded: boolean
        jwksKidMatchesEnvKid: boolean
      }
    }

    expect(parsed.ok).toBe(true)
    expect(parsed.debugEnv.repoRoot.replace(/\\/g, "/")).toBe(process.cwd().replace(/\\/g, "/"))
    expect(parsed.debugEnv.envLocalPath.replace(/\\/g, "/")).toBe(path.join(process.cwd(), ".env.local").replace(/\\/g, "/"))
    expect(parsed.debugEnv.enabledValue).toBe(true)
    expect(parsed.debugEnv.signingKeyConfigured).toBe(true)
    expect(parsed.debugEnv.signingKeyLength).toBe(signingKeyB64.length)
    expect(parsed.debugEnv.jwksDerivationSucceeded).toBe(true)
    expect(parsed.debugEnv.jwksKidMatchesEnvKid).toBe(true)
    expect(output).not.toContain(signingKeyB64)
    expect(output).not.toContain("jwksPublicConfigured")
    expect(output).not.toContain("BEGIN PRIVATE KEY")
  })

  it("dynamic:jwt:test recognizes missing enabled and invalid signing key clearly", async () => {
    const missingEnabled = await createTestEnv({ DYNAMIC_EXTERNAL_JWT_ENABLED: "" })
    const missingOutput = execNodeAllowFailure(["scripts/test-dynamic-external-jwt.mjs"], missingEnabled.env)
    expect(JSON.parse(missingOutput)).toMatchObject({
      ok: false,
      code: "dynamic_external_jwt_not_enabled",
    })

    const invalidKey = await createTestEnv({ DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64: "not-a-real-base64-key" })
    const invalidKeyOutput = execNodeAllowFailure(["scripts/test-dynamic-external-jwt.mjs"], invalidKey.env)
    expect(JSON.parse(invalidKeyOutput)).toMatchObject({
      ok: false,
      code: "dynamic_external_jwt_signing_key_invalid",
    })
  })

  it("dynamic:jwt:test fails clearly when kid is missing", async () => {
    const mismatched = await createTestEnv({ DYNAMIC_EXTERNAL_JWT_KID: "" })
    const output = execNodeAllowFailure(["scripts/test-dynamic-external-jwt.mjs"], mismatched.env)
    expect(JSON.parse(output)).toMatchObject({
      ok: false,
      code: "dynamic_external_jwt_kid_missing",
    })
  })

  it("JWKS endpoint derives public key from signing key and returns safe cache headers", async () => {
    const { env, signingKeyB64 } = await createTestEnv()
    process.env.DYNAMIC_EXTERNAL_JWT_KID = env.DYNAMIC_EXTERNAL_JWT_KID
    process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64 = signingKeyB64

    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("public, max-age=300, must-revalidate")
    const json = await res.json()
    const serialized = JSON.stringify(json)

    expect(json.keys[0].kid).toBe("pinetree-test-kid")
    expect(serialized).not.toContain("PRIVATE KEY")
    expect(serialized).not.toContain(signingKeyB64)
    expect(serialized).not.toContain('"d"')
    expect(json.keys[0]).toMatchObject({
      alg: "RS256",
      use: "sig",
      kty: "RSA",
    })
  })

  it("JWKS endpoint fails clearly when signing key or kid is missing", async () => {
    const res = await GET()
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: "dynamic_external_jwt_kid_missing" })

    process.env.DYNAMIC_EXTERNAL_JWT_KID = "pinetree-test-kid"
    const missingKey = await GET()
    expect(missingKey.status).toBe(503)
    await expect(missingKey.json()).resolves.toEqual({ error: "dynamic_external_jwt_signing_key_missing" })
  })

  it("JWKS endpoint fails clearly when signing key is invalid", async () => {
    process.env.DYNAMIC_EXTERNAL_JWT_KID = "pinetree-test-kid"
    process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64 = "not-a-real-base64-key"

    const res = await GET()
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: "dynamic_external_jwt_signing_key_invalid" })
  })
})
