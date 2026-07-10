import fs from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SignJWT, exportJWK, exportPKCS8, generateKeyPair } from "jose"
import {
  dynamicSessionBoundToMerchant,
  getDynamicExternalUserId,
} from "@/lib/wallets/dynamicExternalIdentity"
import { analyzePineTreeDynamicExternalJwtContract } from "@/lib/pinetreeDynamicAuth"
import {
  runDynamicExternalJwtContractCheck,
  signDynamicExternalJwt,
  verifySignedDynamicExternalJwtAgainstJwks,
} from "@/lib/api/dynamicExternalJwt"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

const merchantId = "71478b11-ed12-4dbf-8466-52807995bac0"

describe("Dynamic external identity mapping", () => {
  it("extracts the externalUser credential public identifier (both casings)", () => {
    expect(getDynamicExternalUserId({
      verifiedCredentials: [
        { format: "email", publicIdentifier: "merchant@example.com" },
        { format: "externalUser", publicIdentifier: merchantId },
      ],
    })).toBe(merchantId)
    expect(getDynamicExternalUserId({
      verifiedCredentials: [
        { format: "externalUser", public_identifier: merchantId },
      ],
    })).toBe(merchantId)
  })

  it("binds a session to the merchant only on an exact externalUser match", () => {
    const user = {
      verifiedCredentials: [{ format: "externalUser", publicIdentifier: merchantId }],
    }
    expect(dynamicSessionBoundToMerchant(user, merchantId)).toBe(true)
    expect(dynamicSessionBoundToMerchant(user, "someone-else")).toBe(false)
    expect(dynamicSessionBoundToMerchant(user, null)).toBe(false)
    expect(dynamicSessionBoundToMerchant(user, "")).toBe(false)
  })

  it("never binds from emails, missing credentials, or malformed users", () => {
    expect(getDynamicExternalUserId(null)).toBeNull()
    expect(getDynamicExternalUserId({})).toBeNull()
    expect(getDynamicExternalUserId({ verifiedCredentials: "not-an-array" })).toBeNull()
    expect(getDynamicExternalUserId({
      verifiedCredentials: [{ format: "email", publicIdentifier: merchantId }],
    })).toBeNull()
    expect(dynamicSessionBoundToMerchant({ verifiedCredentials: [] }, merchantId)).toBe(false)
  })
})

async function signTestJwt(options: {
  kid?: string
  issuer?: string
  audience?: string
}) {
  const keys = await generateKeyPair("RS256")
  let jwt = new SignJWT({ email: "merchant@example.com" })
    .setProtectedHeader({ alg: "RS256", ...(options.kid ? { kid: options.kid } : {}) })
    .setSubject(merchantId)
    .setIssuedAt()
    .setExpirationTime("5m")
  if (options.issuer) jwt = jwt.setIssuer(options.issuer)
  if (options.audience) jwt = jwt.setAudience(options.audience)
  return jwt.sign(keys.privateKey)
}

describe("analyzePineTreeDynamicExternalJwtContract (client-side JWT contract analysis)", () => {
  const env = { NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID: "test-environment-id" }

  it("reports full contract match for a correctly signed token", async () => {
    const jwt = await signTestJwt({
      kid: "pinetree-test-kid",
      issuer: "https://app.pinetree-payments.com",
      audience: "test-environment-id",
    })
    expect(analyzePineTreeDynamicExternalJwtContract(jwt, env)).toEqual({
      headerKid: "pinetree-test-kid",
      algorithm: "RS256",
      issuerMatch: true,
      audienceMatch: true,
      environmentIdPresent: true,
      subjectPresent: true,
      externalUserIdPresent: false,
      externalUserIdMatchesSubject: false,
    })
  })

  it("flags an audience that does not equal the environment ID - the exact production rejection", async () => {
    const jwt = await signTestJwt({
      kid: "pinetree-test-kid",
      issuer: "https://app.pinetree-payments.com",
      audience: "dynamic",
    })
    const analysis = analyzePineTreeDynamicExternalJwtContract(jwt, env)
    expect(analysis.audienceMatch).toBe(false)
    expect(analysis.issuerMatch).toBe(true)
  })

  it("flags an issuer that diverges from the canonical dashboard value", async () => {
    const jwt = await signTestJwt({
      kid: "pinetree-test-kid",
      issuer: "https://app.pinetree-payments.com/", // trailing slash = mismatch
      audience: "test-environment-id",
    })
    expect(analyzePineTreeDynamicExternalJwtContract(jwt, env).issuerMatch).toBe(false)
  })

  it("accepts an audience array containing the environment ID", async () => {
    const keys = await generateKeyPair("RS256")
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "k" })
      .setIssuer("https://app.pinetree-payments.com")
      .setSubject(merchantId)
      .setAudience(["other", "test-environment-id"])
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(keys.privateKey)
    expect(analyzePineTreeDynamicExternalJwtContract(jwt, env).audienceMatch).toBe(true)
  })

  it("handles malformed tokens and a missing environment ID without throwing", () => {
    expect(analyzePineTreeDynamicExternalJwtContract("not-a-jwt", env)).toEqual({
      headerKid: null,
      algorithm: null,
      issuerMatch: false,
      audienceMatch: false,
      environmentIdPresent: true,
      subjectPresent: false,
      externalUserIdPresent: false,
      externalUserIdMatchesSubject: false,
    })
    expect(analyzePineTreeDynamicExternalJwtContract("a.b.c", {}).environmentIdPresent).toBe(false)
  })

  it("proves the route externalUserId exactly matches the JWT subject without returning either value", async () => {
    const jwt = await signTestJwt({
      kid: "pinetree-test-kid",
      issuer: "https://app.pinetree-payments.com",
      audience: "test-environment-id",
    })
    const analysis = analyzePineTreeDynamicExternalJwtContract(jwt, env, merchantId)
    expect(analysis.externalUserIdPresent).toBe(true)
    expect(analysis.externalUserIdMatchesSubject).toBe(true)
    const serialized = JSON.stringify(analysis)
    expect(serialized).not.toContain(merchantId)
    expect(serialized).not.toContain("merchant@example.com")
  })

  it("flags a route externalUserId that does not match JWT sub before Dynamic is called", async () => {
    const jwt = await signTestJwt({
      kid: "pinetree-test-kid",
      issuer: "https://app.pinetree-payments.com",
      audience: "test-environment-id",
    })
    const analysis = analyzePineTreeDynamicExternalJwtContract(jwt, env, "different-external-user")
    expect(analysis.externalUserIdPresent).toBe(true)
    expect(analysis.externalUserIdMatchesSubject).toBe(false)
  })

  it("returns comparison booleans plus public header fields only - never claim values", async () => {
    const jwt = await signTestJwt({
      kid: "pinetree-test-kid",
      issuer: "https://app.pinetree-payments.com",
      audience: "test-environment-id",
    })
    const serialized = JSON.stringify(analyzePineTreeDynamicExternalJwtContract(jwt, env))
    expect(serialized).not.toContain("merchant@example.com")
    expect(serialized).not.toContain(merchantId)
    expect(serialized).not.toContain("https://app.pinetree-payments.com")
  })
})

describe("runDynamicExternalJwtContractCheck (server key/JWKS parity)", () => {
  const envKeys = [
    "DYNAMIC_EXTERNAL_JWT_ISSUER",
    "DYNAMIC_EXTERNAL_JWT_AUDIENCE",
    "DYNAMIC_EXTERNAL_JWT_AUDIENCE_OVERRIDE",
    "DYNAMIC_EXTERNAL_JWT_KID",
    "DYNAMIC_EXTERNAL_JWT_KEY_ID",
    "DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64",
    "DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY",
    "NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID",
  ] as const
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))

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

  async function setupSigningEnv() {
    const keys = await generateKeyPair("RS256", { extractable: true })
    const privateKeyPem = await exportPKCS8(keys.privateKey)
    const publicJwk = await exportJWK(keys.publicKey)
    process.env.DYNAMIC_EXTERNAL_JWT_ISSUER = "https://app.pinetree-payments.com"
    process.env.DYNAMIC_EXTERNAL_JWT_KID = "pinetree-test-kid"
    process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64 = Buffer.from(privateKeyPem, "utf8").toString("base64")
    process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID = "test-environment-id"
    delete process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE
    delete process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE_OVERRIDE
    delete process.env.DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY
    delete process.env.DYNAMIC_EXTERNAL_JWT_KEY_ID
    return { publicJwk }
  }

  it("verifies a signed JWT against the exact JWKS key and subject binding", async () => {
    const { publicJwk } = await setupSigningEnv()
    const signed = await signDynamicExternalJwt({ merchantId, email: "merchant@example.com" })
    const check = await verifySignedDynamicExternalJwtAgainstJwks({
      externalJwt: signed.externalJwt,
      externalUserId: signed.subject,
      jwksKey: { ...publicJwk, kid: "pinetree-test-kid", alg: "RS256", use: "sig" },
    })

    expect(check).toEqual({
      jwtSelfVerificationPassed: true,
      jwtHeaderKidPresent: true,
      jwtHeaderKidMatchesJwks: true,
      signingPublicKeyMatchesJwks: true,
      jwksKidPresent: true,
      algorithmRs256: true,
      routeExternalUserIdPresent: true,
      routeExternalUserIdMatchesSubject: true,
    })
  })

  it("detects changing private key material while reusing the same kid", async () => {
    await setupSigningEnv()
    const signed = await signDynamicExternalJwt({ merchantId, email: "merchant@example.com" })
    const otherKeys = await generateKeyPair("RS256", { extractable: true })
    const otherJwk = await exportJWK(otherKeys.publicKey)

    const check = await verifySignedDynamicExternalJwtAgainstJwks({
      externalJwt: signed.externalJwt,
      externalUserId: signed.subject,
      jwksKey: { ...otherJwk, kid: "pinetree-test-kid", alg: "RS256", use: "sig" },
    })

    expect(check.jwtHeaderKidMatchesJwks).toBe(true)
    expect(check.signingPublicKeyMatchesJwks).toBe(false)
    expect(check.jwtSelfVerificationPassed).toBe(false)
  })

  it("detects missing or mismatched externalUserId binding without leaking values", async () => {
    const { publicJwk } = await setupSigningEnv()
    const signed = await signDynamicExternalJwt({ merchantId, email: "merchant@example.com" })
    const mismatched = await verifySignedDynamicExternalJwtAgainstJwks({
      externalJwt: signed.externalJwt,
      externalUserId: "different-external-user",
      jwksKey: { ...publicJwk, kid: "pinetree-test-kid", alg: "RS256", use: "sig" },
    })

    expect(mismatched.routeExternalUserIdPresent).toBe(true)
    expect(mismatched.routeExternalUserIdMatchesSubject).toBe(false)
    expect(mismatched.jwtSelfVerificationPassed).toBe(false)
    const serialized = JSON.stringify(mismatched)
    expect(serialized).not.toContain(merchantId)
    expect(serialized).not.toContain("different-external-user")
    expect(serialized).not.toContain("merchant@example.com")
  })

  it("proves signing key and kid parity against the JWKS Dynamic fetches", async () => {
    const { publicJwk } = await setupSigningEnv()
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: "pinetree-test-kid", alg: "RS256", use: "sig" }] }), { status: 200 })
    ))

    expect(await runDynamicExternalJwtContractCheck()).toEqual({
      headerKid: "pinetree-test-kid",
      jwksKid: "pinetree-test-kid",
      kidMatch: true,
      signingKeyMatchesJwks: true,
      issuerMatch: true,
      audienceMatch: true,
      environmentIdPresent: true,
      algorithm: "RS256",
      jwksLoaded: true,
    })
  })

  it("detects a JWKS serving a DIFFERENT key than the one signing tokens", async () => {
    await setupSigningEnv()
    const otherKeys = await generateKeyPair("RS256", { extractable: true })
    const otherJwk = await exportJWK(otherKeys.publicKey)
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ keys: [{ ...otherJwk, kid: "pinetree-test-kid", alg: "RS256", use: "sig" }] }), { status: 200 })
    ))

    const check = await runDynamicExternalJwtContractCheck()
    expect(check.kidMatch).toBe(true)
    expect(check.signingKeyMatchesJwks).toBe(false)
  })

  it("detects a kid mismatch between the JWT header and the served JWKS", async () => {
    const { publicJwk } = await setupSigningEnv()
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: "some-other-kid", alg: "RS256", use: "sig" }] }), { status: 200 })
    ))

    const check = await runDynamicExternalJwtContractCheck()
    expect(check.headerKid).toBe("pinetree-test-kid")
    expect(check.jwksKid).toBe("some-other-kid")
    expect(check.kidMatch).toBe(false)
  })

  it("reports an unreachable JWKS without throwing and never leaks key material", async () => {
    await setupSigningEnv()
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down") }))

    const check = await runDynamicExternalJwtContractCheck()
    expect(check.jwksLoaded).toBe(false)
    expect(check.kidMatch).toBe(false)
    const serialized = JSON.stringify(check)
    expect(serialized).not.toContain("BEGIN PRIVATE KEY")
    expect(serialized).not.toContain(process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64)
  })
})

describe("Wallet setup page - external JWT contract wiring", () => {
  const page = read("app/dashboard/wallet-setup/page.tsx")
  const eventRoute = read("app/api/debug/pinetree-wallet/setup-event/route.ts")
  const jwtRoute = read("app/api/wallets/dynamic/external-jwt/route.ts")
  const jwtLib = read("lib/api/dynamicExternalJwt.ts")

  it("uses the externalUser credential binding to exempt PineTree-signed sessions from email gates", () => {
    expect(page).toContain("dynamicSessionBoundToMerchant(user, merchantId)")
    // Both live derived states and the pre-provisioning identity gate must be
    // short-circuited by the external binding.
    expect(page).toContain("!dynamicSessionExternallyBound &&\n    Boolean(user) && Boolean(merchantEmail) && Boolean(dynamicUserEmail) && dynamicUserEmail !== merchantEmail")
    expect(page).toContain("!dynamicSessionExternallyBound &&\n    Boolean(user) && Boolean(merchantEmail) && !dynamicUserEmail")
    expect(page).toContain("if (dynamicSessionExternallyBound) return")
    expect(page).toContain("if (!dynamicSessionExternallyBound && merchantEmail && dynamicUserEmail && dynamicUserEmail !== merchantEmail)")
    expect(page).toContain("if (!dynamicSessionExternallyBound && (!merchantEmail || !dynamicUserEmail))")
  })

  it("treats Dynamic native email login as developer recovery only, never the production path", () => {
    expect(page).toContain("const nativeFallbackRecoveryAllowed =")
    expect(page).toContain('walletSyncDebugQueryEnabled || process.env.NODE_ENV !== "production"')
    const rejectedBlock = page.slice(
      page.indexOf('emitWalletSetupDebugEvent("wallet_dynamic_external_jwt_rejected", {})'),
      page.indexOf('logWalletCreationStep("failed", { reason: "dynamic_external_jwt_rejected" })')
    )
    expect(rejectedBlock).toContain("if (nativeFallbackRecoveryAllowed) {")
    expect(rejectedBlock).toContain('emitWalletSetupDebugEvent("wallet_dynamic_native_fallback_suppressed"')
    expect(rejectedBlock).toContain('recordWalletSetupFailure("dynamic_external_jwt_rejected", "failed"')
  })

  it("shows a real diagnostic for a rejected external JWT instead of generic timeout copy", () => {
    expect(page).toContain('"dynamic_external_jwt_rejected"')
    expect(page).toContain("code: external_jwt_rejected")
  })

  it("emits the wallet_dynamic_jwt_auth_* instrumentation with contract booleans only", () => {
    expect(page).toContain('emitWalletSetupDebugEvent("wallet_dynamic_jwt_auth_started", {})')
    const successBlock = page.slice(
      page.indexOf('emitWalletSetupDebugEvent("wallet_dynamic_jwt_auth_success"'),
      page.indexOf('emitWalletSetupDebugEvent("wallet_dynamic_jwt_auth_success"') + 500
    )
    expect(successBlock).toContain("issuerMatch")
    expect(successBlock).toContain("audienceMatch")
    const failedBlock = page.slice(
      page.indexOf('emitWalletSetupDebugEvent("wallet_dynamic_jwt_auth_failed"'),
      page.indexOf('emitWalletSetupDebugEvent("wallet_dynamic_jwt_auth_failed"') + 700
    )
    expect(failedBlock).toContain("issuerMatch")
    expect(failedBlock).toContain("audienceMatch")
    expect(failedBlock).toContain("jwksLoaded")
    expect(failedBlock).toContain("subjectPresent")
    expect(failedBlock).toContain("environmentIdPresent")
    for (const event of [
      "wallet_dynamic_jwt_auth_started",
      "wallet_dynamic_jwt_auth_success",
      "wallet_dynamic_jwt_auth_failed",
      "wallet_dynamic_native_fallback_suppressed",
    ]) {
      expect(eventRoute).toContain(`"${event}"`)
    }
  })

  it("server route logs the auth lifecycle without JWTs or claim values", () => {
    expect(jwtRoute).toContain("wallet_dynamic_jwt_auth_started")
    expect(jwtRoute).toContain("wallet_dynamic_jwt_auth_success")
    expect(jwtRoute).toContain("wallet_dynamic_jwt_auth_failed")
    // The success log spreads boolean claim diagnostics only.
    expect(jwtRoute).toContain("{ ...signed.claims }")
  })

  it("documents and enforces the verified audience contract (environment ID)", () => {
    expect(jwtLib).toContain("VERIFIED CONTRACT (2026-07-10")
    expect(jwtLib).toContain("DYNAMIC_EXTERNAL_JWT_AUDIENCE_OVERRIDE")
    // Environment ID must be consulted before the legacy audience var.
    const fn = jwtLib.slice(
      jwtLib.indexOf("export function resolveDynamicJwtAudience"),
      jwtLib.indexOf("function normalizeOrigin")
    )
    expect(fn.indexOf("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID")).toBeLessThan(fn.indexOf("DYNAMIC_EXTERNAL_JWT_AUDIENCE?."))
    expect(fn).toContain('legacy !== "dynamic"')
  })
})
