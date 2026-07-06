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

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

function isEnabled(value: string | undefined) {
  return value === "true" || value === "1"
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
  const issuer = process.env.DYNAMIC_EXTERNAL_JWT_ISSUER || "pinetree"
  const audience = process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE || "dynamic"
  const keyId = process.env.DYNAMIC_EXTERNAL_JWT_KEY_ID || undefined
  const privateKey = process.env.DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY?.replace(/\\n/g, "\n")
  const secret = process.env.DYNAMIC_EXTERNAL_JWT_SECRET
  const ttlSeconds = 5 * 60
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)

  const jwt = new SignJWT({
    email: input.email,
    emailVerified: true,
    merchant_id: input.merchantId,
  })
    .setProtectedHeader({
      alg: privateKey ? "RS256" : "HS256",
      ...(keyId ? { kid: keyId } : {}),
    })
    .setIssuer(issuer)
    .setSubject(input.merchantId)
    .setAudience(audience)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(expiresAt)

  if (privateKey) {
    const signingKey = await importPKCS8(privateKey, "RS256")
    return { externalJwt: await jwt.sign(signingKey), expiresAt }
  }

  if (!secret) {
    throw Object.assign(new Error("dynamic_external_jwt_signing_key_missing"), { status: 503 })
  }

  return {
    externalJwt: await jwt.sign(new TextEncoder().encode(secret)),
    expiresAt,
  }
}

export async function POST(req: NextRequest) {
  try {
    if (process.env.NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE !== "external_jwt") {
      return jsonError("dynamic_external_jwt_mode_disabled", 409)
    }
    if (!isEnabled(process.env.DYNAMIC_EXTERNAL_JWT_ENABLED)) {
      return jsonError("dynamic_external_jwt_not_enabled", 503)
    }

    const auth = await requireSupabaseMerchant(req)
    const signed = await signPineTreeDynamicJwt(auth)

    console.info("[pinetree-wallets] dynamic_external_jwt_issued", {
      merchantId: auth.merchantId,
      userId: auth.userId,
      emailPresent: Boolean(auth.email),
      externalUserId: auth.merchantId,
      issuer: process.env.DYNAMIC_EXTERNAL_JWT_ISSUER || "pinetree",
      audience: process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE || "dynamic",
      expiresAt: signed.expiresAt.toISOString(),
    })

    return NextResponse.json({
      externalJwt: signed.externalJwt,
      externalUserId: auth.merchantId,
      expiresAt: signed.expiresAt.toISOString(),
    })
  } catch (error) {
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
