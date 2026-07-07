import { randomUUID } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { SignJWT, importPKCS8 } from "jose"
import { getMerchantById } from "@/database/merchants"

type AuthenticatedMerchant = {
  merchantId: string
  userId: string
  email: string
}

type ExternalJwtRouteStatus =
  | "starting"
  | "mode_disabled"
  | "not_enabled"
  | "authenticating"
  | "merchant_resolving"
  | "signing"
  | "issued"
  | "failed"

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

function isEnabled(value: string | undefined) {
  return value === "true" || value === "1"
}

function getExternalJwtConfigDiagnostics() {
  return {
    enabled: isEnabled(process.env.DYNAMIC_EXTERNAL_JWT_ENABLED),
    issuerConfigured: Boolean(process.env.DYNAMIC_EXTERNAL_JWT_ISSUER?.trim()),
    audienceConfigured: Boolean(process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE?.trim()),
    kidConfigured: Boolean(process.env.DYNAMIC_EXTERNAL_JWT_KID || process.env.DYNAMIC_EXTERNAL_JWT_KEY_ID),
    signingKeyConfigured: Boolean(process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64 || process.env.DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY),
    jwksPublicConfigured: Boolean(process.env.DYNAMIC_EXTERNAL_JWT_JWKS_PUBLIC?.trim()),
  }
}

function logExternalJwtRoute(input: ReturnType<typeof getExternalJwtConfigDiagnostics> & {
  userPresent: boolean
  merchantResolved: boolean
  status: ExternalJwtRouteStatus
}) {
  console.info("[pinetree-dynamic-auth] external_jwt_route", input)
}

function getSigningKeyPem() {
  const encodedSigningKey = process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64?.trim()
  if (encodedSigningKey) {
    try {
      const decoded = Buffer.from(encodedSigningKey, "base64").toString("utf8")
      if (!decoded.includes("-----BEGIN PRIVATE KEY-----") || !decoded.includes("-----END PRIVATE KEY-----")) {
        throw new Error("invalid_pem")
      }
      return decoded
    } catch {
      throw Object.assign(new Error("dynamic_external_jwt_signing_key_invalid"), { status: 503 })
    }
  }

  // TODO: Remove this raw PEM fallback after all environments use
  // DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64.
  const legacyPrivateKey = process.env.DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY?.replace(/\\n/g, "\n")
  if (legacyPrivateKey) return legacyPrivateKey

  throw Object.assign(new Error("dynamic_external_jwt_signing_key_missing"), { status: 503 })
}

async function requireSupabaseMerchant(req: NextRequest): Promise<AuthenticatedMerchant> {
  const authHeader = req.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""
  if (!token || token.startsWith("pt_live_")) {
    throw Object.assign(new Error("unauthorized"), { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    throw Object.assign(new Error("supabase_env_missing"), { status: 500 })
  }

  const client = createClient(supabaseUrl, supabaseAnonKey)
  const { data, error } = await client.auth.getUser(token)
  const user = data?.user
  if (error || !user) {
    throw Object.assign(new Error("unauthorized"), { status: 401 })
  }

  const merchantId = user.id
  const merchant = await getMerchantById(merchantId)
  const merchantEmail = String(merchant?.email || user.email || "").trim().toLowerCase()
  if (!merchantEmail) {
    throw Object.assign(new Error("merchant_email_missing"), { status: 409 })
  }

  return {
    merchantId,
    userId: user.id,
    email: merchantEmail,
  }
}

async function signPineTreeDynamicJwt(input: AuthenticatedMerchant) {
  const issuer = process.env.DYNAMIC_EXTERNAL_JWT_ISSUER || "https://app.pinetree-payments.com"
  const audience = process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE?.trim()
  const keyId = process.env.DYNAMIC_EXTERNAL_JWT_KID || process.env.DYNAMIC_EXTERNAL_JWT_KEY_ID || undefined
  const ttlSeconds = 5 * 60
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)

  if (!keyId) {
    throw Object.assign(new Error("dynamic_external_jwt_kid_missing"), { status: 503 })
  }
  const privateKey = getSigningKeyPem()

  let jwt = new SignJWT({
    email: input.email,
    emailVerified: true,
    merchant_id: input.merchantId,
  })
    .setProtectedHeader({
      alg: "RS256",
      kid: keyId,
    })
    .setIssuer(issuer)
    .setSubject(input.merchantId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(expiresAt)

  if (audience) jwt = jwt.setAudience(audience)

  let signingKey: Awaited<ReturnType<typeof importPKCS8>>
  try {
    signingKey = await importPKCS8(privateKey, "RS256")
  } catch {
    throw Object.assign(new Error("dynamic_external_jwt_signing_key_invalid"), { status: 503 })
  }
  return { externalJwt: await jwt.sign(signingKey), expiresAt, issuer, audience, keyId }
}

export async function POST(req: NextRequest) {
  let userPresent = false
  let merchantResolved = false
  let routeStatus: ExternalJwtRouteStatus = "starting"
  try {
    const diagnostics = getExternalJwtConfigDiagnostics()
    logExternalJwtRoute({ ...diagnostics, userPresent, merchantResolved, status: routeStatus })
    if (process.env.NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE !== "external_jwt") {
      routeStatus = "mode_disabled"
      logExternalJwtRoute({ ...diagnostics, userPresent, merchantResolved, status: routeStatus })
      return jsonError("dynamic_external_jwt_mode_disabled", 409)
    }
    if (!isEnabled(process.env.DYNAMIC_EXTERNAL_JWT_ENABLED)) {
      routeStatus = "not_enabled"
      logExternalJwtRoute({ ...diagnostics, userPresent, merchantResolved, status: routeStatus })
      return jsonError("dynamic_external_jwt_not_enabled", 503)
    }

    routeStatus = "authenticating"
    const auth = await requireSupabaseMerchant(req)
    userPresent = true
    merchantResolved = true
    routeStatus = "signing"
    const signed = await signPineTreeDynamicJwt(auth)
    routeStatus = "issued"
    logExternalJwtRoute({ ...diagnostics, userPresent, merchantResolved, status: routeStatus })

    console.info("[pinetree-wallets] dynamic_external_jwt_issued", {
      emailPresent: Boolean(auth.email),
      issuer: signed.issuer,
      audienceConfigured: Boolean(signed.audience),
      kidConfigured: Boolean(signed.keyId),
      signingKeyConfigured: diagnostics.signingKeyConfigured,
      expiresAt: signed.expiresAt.toISOString(),
    })

    return NextResponse.json({
      externalJwt: signed.externalJwt,
      externalUserId: auth.merchantId,
      expiresAt: signed.expiresAt.toISOString(),
      diagnostics,
    })
  } catch (error) {
    routeStatus = "failed"
    const diagnostics = getExternalJwtConfigDiagnostics()
    logExternalJwtRoute({ ...diagnostics, userPresent, merchantResolved, status: routeStatus })
    const status =
      typeof error === "object" && error !== null && "status" in error && typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : 500
    const code = error instanceof Error ? error.message : "dynamic_external_jwt_failed"
    console.warn("[pinetree-wallets] dynamic_external_jwt_failed", {
      status,
      code,
    })
    return jsonError(code, status)
  }
}
