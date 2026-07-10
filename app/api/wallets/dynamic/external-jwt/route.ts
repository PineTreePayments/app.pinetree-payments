import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import {
  getDynamicExternalJwtIssuer,
  getDynamicJwtClaimsDiagnostics,
  deriveDynamicExternalJwtPublicJwk,
  resolveDynamicJwtAudience,
  runDynamicExternalJwtContractCheck,
  signDynamicExternalJwt,
  type DynamicExternalJwtContractCheck,
  verifySignedDynamicExternalJwtAgainstJwks,
} from "@/lib/api/dynamicExternalJwt"

// TEMPORARY diagnostic cache: the contract check fetches this deployment's own
// public JWKS to prove key/kid parity with what Dynamic verifies against - one
// fetch per 5 minutes, never per request, and never blocking token issuance.
let contractCheckCache: { at: number; value: DynamicExternalJwtContractCheck } | null = null
const contractCheckTtlMs = 5 * 60 * 1000

async function logExternalJwtContractDiagnostic() {
  try {
    if (!contractCheckCache || Date.now() - contractCheckCache.at > contractCheckTtlMs) {
      contractCheckCache = { at: Date.now(), value: await runDynamicExternalJwtContractCheck() }
    }
    console.info("[pinetree-wallets] wallet_dynamic_jwt_contract_diagnostic", contractCheckCache.value)
  } catch {
    // Diagnostics must never break token issuance.
  }
}

type AuthenticatedMerchant = {
  merchantId: string
  userId: string
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

function jsonError(error: string, status: number, diagnostics?: ReturnType<typeof getExternalJwtConfigDiagnostics> & { merchantResolved: boolean }) {
  return NextResponse.json({ error, ...(diagnostics ? { diagnostics } : {}) }, { status })
}

function isEnabled(value: string | undefined) {
  return value === "true" || value === "1"
}

function getExternalJwtConfigDiagnostics() {
  return {
    enabled: isEnabled(process.env.DYNAMIC_EXTERNAL_JWT_ENABLED),
    issuerConfigured: Boolean(process.env.DYNAMIC_EXTERNAL_JWT_ISSUER?.trim()),
    audienceConfigured: Boolean(resolveDynamicJwtAudience()),
    kidConfigured: Boolean(process.env.DYNAMIC_EXTERNAL_JWT_KID || process.env.DYNAMIC_EXTERNAL_JWT_KEY_ID),
    signingKeyConfigured: Boolean(process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64 || process.env.DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY),
    jwksDerivedFromSigningKey: Boolean(
      (process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64 || process.env.DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY) &&
        (process.env.DYNAMIC_EXTERNAL_JWT_KID || process.env.DYNAMIC_EXTERNAL_JWT_KEY_ID)
    ),
  }
}

function logExternalJwtRoute(input: ReturnType<typeof getExternalJwtConfigDiagnostics> & {
  userPresent: boolean
  merchantResolved: boolean
  status: ExternalJwtRouteStatus
}) {
  console.info("[pinetree-dynamic-auth] external_jwt_route", input)
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

  return {
    merchantId: user.id,
    userId: user.id,
  }
}

async function shouldIncludeDebugResponse(req: NextRequest) {
  if (process.env.NODE_ENV !== "production") return true
  const urlDebug = req.nextUrl.searchParams.get("walletDebug") === "1"
  if (urlDebug) return true
  const body = await req.json().catch(() => null) as { walletDebug?: unknown } | null
  return body?.walletDebug === true || body?.walletDebug === "1"
}

export async function GET(req: NextRequest) {
  let merchantResolved = false
  const diagnostics = getExternalJwtConfigDiagnostics()
  try {
    await requireMerchantIdFromRequest(req)
    merchantResolved = true
    return NextResponse.json({
      diagnostics: {
        ...diagnostics,
        merchantResolved,
        claims: getDynamicJwtClaimsDiagnostics({
          issuer: getDynamicExternalJwtIssuer(),
          audience: resolveDynamicJwtAudience(),
          subject: "diagnostic",
        }),
      },
    })
  } catch (error) {
    const status =
      typeof error === "object" && error !== null && "status" in error && typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : 500
    return NextResponse.json({
      error: error instanceof Error ? error.message : "dynamic_external_jwt_debug_failed",
      diagnostics: {
        ...diagnostics,
        merchantResolved,
      },
    }, { status })
  }
}

export async function POST(req: NextRequest) {
  let userPresent = false
  let merchantResolved = false
  let routeStatus: ExternalJwtRouteStatus = "starting"
  let subject: string | null = null
  const includeDebugResponse = await shouldIncludeDebugResponse(req)
  try {
    const diagnostics = getExternalJwtConfigDiagnostics()
    const responseDiagnostics = includeDebugResponse ? { ...diagnostics, merchantResolved } : undefined
    logExternalJwtRoute({ ...diagnostics, userPresent, merchantResolved, status: routeStatus })
    if (process.env.NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE !== "external_jwt") {
      routeStatus = "mode_disabled"
      logExternalJwtRoute({ ...diagnostics, userPresent, merchantResolved, status: routeStatus })
      return jsonError("dynamic_external_jwt_mode_disabled", 409, responseDiagnostics)
    }
    if (!isEnabled(process.env.DYNAMIC_EXTERNAL_JWT_ENABLED)) {
      routeStatus = "not_enabled"
      logExternalJwtRoute({ ...diagnostics, userPresent, merchantResolved, status: routeStatus })
      return jsonError("dynamic_external_jwt_not_enabled", 503, responseDiagnostics)
    }

    routeStatus = "authenticating"
    const auth = await requireSupabaseMerchant(req)
    userPresent = true
    merchantResolved = true
    subject = auth.merchantId
    routeStatus = "signing"
    console.info("[pinetree-wallets] wallet_dynamic_jwt_auth_started", {
      environmentIdPresent: Boolean(process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID?.trim()),
      subjectPresent: Boolean(auth.merchantId),
    })
    const signed = await signDynamicExternalJwt({ merchantId: auth.merchantId })
    const jwksKey = await deriveDynamicExternalJwtPublicJwk()
    const verification = await verifySignedDynamicExternalJwtAgainstJwks({
      externalJwt: signed.externalJwt,
      externalUserId: signed.subject,
      jwksKey,
    })
    console.info("[pinetree-dynamic-auth] jwt_contract_verified", {
      jwtSelfVerificationPassed: verification.jwtSelfVerificationPassed,
      jwtHeaderKidMatchesJwks: verification.jwtHeaderKidMatchesJwks,
      signingPublicKeyMatchesJwks: verification.signingPublicKeyMatchesJwks,
      routeExternalUserIdMatchesSubject: verification.routeExternalUserIdMatchesSubject,
      algorithmRs256: verification.algorithmRs256,
    })
    if (
      !verification.jwtSelfVerificationPassed ||
      !verification.jwtHeaderKidMatchesJwks ||
      !verification.signingPublicKeyMatchesJwks ||
      !verification.routeExternalUserIdMatchesSubject ||
      !verification.algorithmRs256
    ) {
      throw Object.assign(new Error("dynamic_jwt_self_verification_failed"), { status: 503 })
    }
    routeStatus = "issued"
    logExternalJwtRoute({ ...diagnostics, userPresent, merchantResolved, status: routeStatus })

    console.info("[pinetree-wallets] wallet_dynamic_jwt_auth_success", { ...signed.claims })
    await logExternalJwtContractDiagnostic()
    console.info("[pinetree-wallets] dynamic_external_jwt_issued", {
      emailPresent: false,
      emailClaimIncluded: false,
      issuerMatch: signed.claims.issuerMatch,
      audienceMatch: signed.claims.audienceMatch,
      environmentIdMatch: signed.claims.environmentIdPresent && signed.claims.audienceMatch,
      audienceConfigured: Boolean(signed.audience),
      kidConfigured: Boolean(signed.keyId),
      algorithm: "RS256",
      signingKeyConfigured: diagnostics.signingKeyConfigured,
      jwtSelfVerificationPassed: verification.jwtSelfVerificationPassed,
      jwtHeaderKidPresent: verification.jwtHeaderKidPresent,
      jwtHeaderKidMatchesJwks: verification.jwtHeaderKidMatchesJwks,
      signingPublicKeyMatchesJwks: verification.signingPublicKeyMatchesJwks,
      jwksKidPresent: verification.jwksKidPresent,
      algorithmRs256: verification.algorithmRs256,
      routeExternalUserIdPresent: verification.routeExternalUserIdPresent,
      routeExternalUserIdMatchesSubject: verification.routeExternalUserIdMatchesSubject,
      expiresAt: signed.expiresAt.toISOString(),
    })

    return NextResponse.json({
      externalJwt: signed.externalJwt,
      externalUserId: signed.subject,
      expiresAt: signed.expiresAt.toISOString(),
      // Boolean-only claim diagnostics, always returned so the client can emit
      // wallet_dynamic_jwt_auth_failed with real issuer/audience facts when
      // Dynamic rejects the token later in the flow. Never contains claim values.
      claims: signed.claims,
      jwtVerification: verification,
      ...(includeDebugResponse ? { diagnostics: { ...diagnostics, merchantResolved } } : {}),
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
    console.warn("[pinetree-wallets] wallet_dynamic_jwt_auth_failed", {
      ...getDynamicJwtClaimsDiagnostics({
        issuer: getDynamicExternalJwtIssuer(),
        audience: resolveDynamicJwtAudience(),
        subject,
      }),
      status,
      code,
    })
    console.warn("[pinetree-wallets] dynamic_external_jwt_failed", {
      status,
      code,
    })
    return jsonError(code, status, includeDebugResponse ? { ...diagnostics, merchantResolved } : undefined)
  }
}
