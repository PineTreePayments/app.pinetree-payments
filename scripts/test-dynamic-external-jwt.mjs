import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { SignJWT, importJWK, importPKCS8, jwtVerify } from "jose"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const envPath = path.join(repoRoot, ".env")
const envLocalPath = path.join(repoRoot, ".env.local")
const testSubject = "pinetree-dynamic-test-merchant"
const testEmail = "dynamic-jwt-test@pinetree-payments.com"
const ttlSeconds = 5 * 60
const debugEnv = process.argv.includes("--debug-env")
const originalProcessEnv = new Set(Object.keys(process.env))

function parseDotenvLine(line) {
  const trimmed = line.replace(/^\uFEFF/, "").trim()
  if (!trimmed || trimmed.startsWith("#")) return null
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
  if (!match) return null
  let value = match[2] ?? ""
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  return [match[1], value]
}

function loadDotenvFile(filePath, options = { overrideLoaded: false }) {
  if (!fs.existsSync(filePath)) return { path: filePath, exists: false, loadedKeys: [] }
  const loadedKeys = []
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/)
  for (const line of lines) {
    const parsed = parseDotenvLine(line)
    if (!parsed) continue
    const [key, value] = parsed
    if (originalProcessEnv.has(key)) continue
    if (!options.overrideLoaded && process.env[key] !== undefined) continue
    process.env[key] = value
    loadedKeys.push(key)
  }
  return { path: filePath, exists: true, loadedKeys }
}

function loadEnvFiles() {
  const env = loadDotenvFile(envPath, { overrideLoaded: false })
  const envLocal = loadDotenvFile(envLocalPath, { overrideLoaded: true })
  return { env, envLocal }
}

function fail(code, extra = {}) {
  console.log(JSON.stringify({ ok: false, code, ...extra }, null, 2))
  process.exitCode = 1
}

function assertCheck(checks, name, pass, detail) {
  checks.push({ name, pass, ...(detail ? { detail } : {}) })
}

function unwrapEnvValue(value) {
  const trimmed = value?.trim() || ""
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function getSigningKeyPem() {
  const encodedSigningKey = unwrapEnvValue(process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64)
  if (encodedSigningKey) {
    const decoded = Buffer.from(encodedSigningKey, "base64").toString("utf8")
    if (!decoded.includes("-----BEGIN PRIVATE KEY-----") || !decoded.includes("-----END PRIVATE KEY-----")) {
      throw new Error("dynamic_external_jwt_signing_key_invalid")
    }
    return decoded
  }

  const legacyPrivateKey = process.env.DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY?.replace(/\\n/g, "\n")
  if (legacyPrivateKey) return legacyPrivateKey
  throw new Error("dynamic_external_jwt_signing_key_missing")
}

function parsePublicJwks() {
  const raw = unwrapEnvValue(process.env.DYNAMIC_EXTERNAL_JWT_JWKS_PUBLIC)
  if (!raw) throw new Error("dynamic_external_jwt_jwks_missing")
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("dynamic_external_jwt_jwks_invalid")
  }
  if (parsed && Array.isArray(parsed.keys)) return parsed
  if (parsed && parsed.kty) return { keys: [parsed] }
  throw new Error("dynamic_external_jwt_jwks_invalid")
}

function decodeJwtPart(part) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"))
}

function getSafeEnvDiagnostics(loadResult) {
  let jwksKid = null
  let jwksParseError = null
  try {
    const jwks = parsePublicJwks()
    jwksKid = jwks.keys[0]?.kid ?? null
  } catch (error) {
    jwksParseError = error instanceof Error ? error.message : "dynamic_external_jwt_jwks_invalid"
  }

  const kid = process.env.DYNAMIC_EXTERNAL_JWT_KID || process.env.DYNAMIC_EXTERNAL_JWT_KEY_ID || ""
  const signingKey = unwrapEnvValue(process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64) || unwrapEnvValue(process.env.DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY) || ""
  const jwksPublic = unwrapEnvValue(process.env.DYNAMIC_EXTERNAL_JWT_JWKS_PUBLIC)

  return {
    cwd: process.cwd(),
    repoRoot,
    envPath,
    envLocalPath,
    envLoaded: loadResult.env.exists,
    envLocalLoaded: loadResult.envLocal.exists,
    enabledValue:
      process.env.DYNAMIC_EXTERNAL_JWT_ENABLED === undefined
        ? null
        : process.env.DYNAMIC_EXTERNAL_JWT_ENABLED === "true"
          ? true
          : process.env.DYNAMIC_EXTERNAL_JWT_ENABLED,
    issuerConfigured: Boolean(process.env.DYNAMIC_EXTERNAL_JWT_ISSUER?.trim()),
    audienceConfigured: Boolean(process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE?.trim()),
    kidConfigured: Boolean(kid),
    signingKeyConfigured: Boolean(signingKey),
    signingKeyLength: signingKey ? signingKey.length : 0,
    jwksPublicConfigured: Boolean(jwksPublic),
    jwksPublicLength: jwksPublic ? jwksPublic.length : 0,
    jwksKidConfigured: Boolean(jwksKid),
    jwksKidMatchesEnvKid: Boolean(kid && jwksKid && jwksKid === kid),
    jwksParseError,
  }
}

async function main() {
  const loadResult = loadEnvFiles()

  if (debugEnv) {
    console.log(JSON.stringify({
      ok: true,
      debugEnv: getSafeEnvDiagnostics(loadResult),
    }, null, 2))
    return
  }

  const checks = []
  const enabled = process.env.DYNAMIC_EXTERNAL_JWT_ENABLED === "true" || process.env.DYNAMIC_EXTERNAL_JWT_ENABLED === "1"
  const issuer = process.env.DYNAMIC_EXTERNAL_JWT_ISSUER || "https://app.pinetree-payments.com"
  const audience = process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE?.trim()
  const kid = process.env.DYNAMIC_EXTERNAL_JWT_KID || process.env.DYNAMIC_EXTERNAL_JWT_KEY_ID
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)

  assertCheck(checks, "DYNAMIC_EXTERNAL_JWT_ENABLED is enabled", enabled)
  assertCheck(checks, "DYNAMIC_EXTERNAL_JWT_KID is configured", Boolean(kid))
  if (!enabled) throw new Error("dynamic_external_jwt_not_enabled")
  if (!kid) throw new Error("dynamic_external_jwt_kid_missing")

  const signingKeyPem = getSigningKeyPem()
  const signingKey = await importPKCS8(signingKeyPem, "RS256")
  const jwks = parsePublicJwks()
  const publicJwk = jwks.keys.find((key) => key?.kid === kid)
  if (!publicJwk) throw new Error("dynamic_external_jwt_jwks_kid_mismatch")
  const verificationKey = await importJWK(publicJwk, "RS256")

  let jwt = new SignJWT({
    email: testEmail,
    emailVerified: true,
    merchant_id: testSubject,
  })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(issuer)
    .setSubject(testSubject)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(expiresAt)

  if (audience) jwt = jwt.setAudience(audience)

  const signed = await jwt.sign(signingKey)
  const [encodedHeader, encodedPayload] = signed.split(".")
  const header = decodeJwtPart(encodedHeader)
  const payload = decodeJwtPart(encodedPayload)
  const verified = await jwtVerify(signed, verificationKey, {
    issuer,
    audience: audience || undefined,
    subject: testSubject,
  })

  assertCheck(checks, "header.kid matches DYNAMIC_EXTERNAL_JWT_KID", header.kid === kid)
  assertCheck(checks, "header.alg is RS256", header.alg === "RS256")
  assertCheck(checks, "payload.iss matches DYNAMIC_EXTERNAL_JWT_ISSUER", payload.iss === issuer)
  assertCheck(checks, "payload.aud matches DYNAMIC_EXTERNAL_JWT_AUDIENCE when configured", audience ? payload.aud === audience : payload.aud === undefined)
  assertCheck(checks, "payload.sub exists", Boolean(payload.sub))
  assertCheck(checks, "payload.exp exists", typeof payload.exp === "number")
  assertCheck(checks, "payload.exp is short-lived", Number(payload.exp) - Number(payload.iat) <= ttlSeconds)
  assertCheck(checks, "payload.email exists for test identity", payload.email === testEmail)
  assertCheck(checks, "JWT verifies against configured public JWKS", verified.payload.sub === testSubject)
  assertCheck(checks, "JWKS key is public signing material only", publicJwk.alg === "RS256" && publicJwk.use === "sig" && !("d" in publicJwk))

  const ok = checks.every((check) => check.pass)
  console.log(JSON.stringify({
    ok,
    decodedHeader: header,
    decodedPayload: payload,
    checks,
  }, null, 2))
  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : "dynamic_external_jwt_test_failed")
})
