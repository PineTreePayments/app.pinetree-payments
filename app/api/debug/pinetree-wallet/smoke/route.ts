import { type NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { getPineTreeWalletProfile } from "@/database/pineTreeWalletProfiles"
import { getMerchantLightningProfile } from "@/database/merchantLightningProfiles"
import { verifyPineTreeWalletSetupState } from "@/database/pineTreeWalletSetupVerification"
import { getPineTreeDynamicAuthConfig } from "@/lib/pinetreeDynamicAuth"
import {
  checkDynamicExternalJwks,
  signDynamicExternalJwt,
} from "@/lib/api/dynamicExternalJwt"

/**
 * GET /api/debug/pinetree-wallet/smoke[?merchant_id=...][&probe=1]
 *
 * Admin-only end-to-end smoke check for the PineTree Wallet provisioning
 * contract. Reports coarse boolean/enum state only:
 *
 * - supabaseAuthOk: the request authenticated through Supabase admin auth.
 * - dynamicJwtGeneratedOk + claim diagnostics: PineTree can sign an external
 *   JWT with the current env, and whether its issuer/audience match the
 *   verified Dynamic dashboard contract (issuer = app origin, aud = env ID).
 * - jwksLoaded/kidFound: the public JWKS URL Dynamic fetches actually serves
 *   the active signing key.
 * - dynamicExternalAuthEnabled/dynamicEnvironmentName: from Dynamic's public
 *   SDK settings for the configured environment.
 * - With ?probe=1: submits the signed JWT to Dynamic's externalAuth/signin and
 *   reports whether Dynamic ACCEPTED it, whether the merchant's Dynamic user
 *   already existed, and whether Base/Solana embedded wallets exist on it.
 *   On rejection, Dynamic's error code/messages are included (they are
 *   diagnostic strings like "Audience (aud) does not match", never secrets).
 * - lightningStatus: Speed provisioning status from the DB profile.
 *
 * Never returns emails, wallet addresses, Dynamic user IDs, JWTs, Speed
 * payloads, or any secret.
 */

function smokeEnabled() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.PINETREE_WALLET_DEBUG_SMOKE_ENABLED === "true"
  )
}

type DynamicSigninProbeResult = {
  dynamicJwtAcceptedOk: boolean
  dynamicEmbeddedUserExists: boolean | null
  baseWalletExists: boolean | null
  solanaWalletExists: boolean | null
  dynamicRejectionCode: string | null
  dynamicRejectionMessages: string[]
}

type DynamicCredentialLike = {
  format?: string
  chain?: string
  address?: string
}

async function probeDynamicSignin(input: { merchantId: string }): Promise<DynamicSigninProbeResult> {
  const environmentId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID?.trim()
  const result: DynamicSigninProbeResult = {
    dynamicJwtAcceptedOk: false,
    dynamicEmbeddedUserExists: null,
    baseWalletExists: null,
    solanaWalletExists: null,
    dynamicRejectionCode: null,
    dynamicRejectionMessages: [],
  }
  if (!environmentId) {
    result.dynamicRejectionCode = "environment_id_missing"
    return result
  }
  const signed = await signDynamicExternalJwt(input)
  const res = await fetch(`https://app.dynamicauth.com/api/v0/sdk/${environmentId}/externalAuth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jwt: signed.externalJwt }),
    cache: "no-store",
  })
  const body = (await res.json().catch(() => null)) as {
    code?: string
    payload?: { additionalMessages?: unknown }
    user?: { newUser?: boolean; verifiedCredentials?: DynamicCredentialLike[] }
  } | null

  if (!res.ok) {
    result.dynamicRejectionCode = typeof body?.code === "string" ? body.code : `http_${res.status}`
    const messages = body?.payload?.additionalMessages
    result.dynamicRejectionMessages = Array.isArray(messages)
      ? messages.filter((m): m is string => typeof m === "string").slice(0, 5)
      : []
    return result
  }

  result.dynamicJwtAcceptedOk = true
  const user = body?.user
  result.dynamicEmbeddedUserExists = user ? user.newUser !== true : null
  const credentials = Array.isArray(user?.verifiedCredentials) ? user.verifiedCredentials : []
  const walletCredentials = credentials.filter(
    (credential) => credential && typeof credential === "object" && Boolean(credential.address)
  )
  const chainOf = (credential: DynamicCredentialLike) => String(credential.chain || "").toLowerCase()
  result.baseWalletExists = walletCredentials.some((credential) => {
    const chain = chainOf(credential)
    return chain.includes("eip155") || chain.includes("evm") || chain === "eth"
  })
  result.solanaWalletExists = walletCredentials.some((credential) => chainOf(credential).includes("sol"))
  return result
}

async function fetchDynamicEnvironmentFacts(): Promise<{
  dynamicExternalAuthEnabled: boolean | null
  dynamicEnvironmentName: string | null
}> {
  const environmentId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID?.trim()
  if (!environmentId) return { dynamicExternalAuthEnabled: null, dynamicEnvironmentName: null }
  try {
    const res = await fetch(`https://app.dynamicauth.com/api/v0/sdk/${environmentId}/settings`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    })
    if (!res.ok) return { dynamicExternalAuthEnabled: null, dynamicEnvironmentName: null }
    const json = (await res.json()) as {
      environmentName?: string
      security?: { externalAuth?: { enabled?: boolean } }
    }
    return {
      dynamicExternalAuthEnabled: json?.security?.externalAuth?.enabled ?? null,
      dynamicEnvironmentName: typeof json?.environmentName === "string" ? json.environmentName : null,
    }
  } catch {
    return { dynamicExternalAuthEnabled: null, dynamicEnvironmentName: null }
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!smokeEnabled()) {
      return NextResponse.json({ error: "Wallet setup smoke check is disabled" }, { status: 404 })
    }

    const adminId = await requireAdminFromRequest(req)
    const merchantIdParam = req.nextUrl.searchParams.get("merchant_id")
    const merchantId = merchantIdParam && merchantIdParam.trim() ? merchantIdParam.trim() : adminId
    const runSigninProbe = req.nextUrl.searchParams.get("probe") === "1"

    const [profile, lightningProfile, setupVerification, jwks, environmentFacts] = await Promise.all([
      getPineTreeWalletProfile(merchantId),
      getMerchantLightningProfile(merchantId),
      verifyPineTreeWalletSetupState(merchantId),
      checkDynamicExternalJwks(),
      fetchDynamicEnvironmentFacts(),
    ])
    const authConfig = getPineTreeDynamicAuthConfig()

    let dynamicJwtGeneratedOk = false
    let claims: { issuerMatch: boolean; audienceMatch: boolean; subjectPresent: boolean; environmentIdPresent: boolean } | null = null
    let jwtGenerationError: string | null = null
    try {
      const signed = await signDynamicExternalJwt({ merchantId })
      dynamicJwtGeneratedOk = true
      claims = signed.claims
    } catch (error) {
      jwtGenerationError = error instanceof Error ? error.message : "sign_failed"
    }

    let signinProbe: DynamicSigninProbeResult | null = null
    if (runSigninProbe && dynamicJwtGeneratedOk) {
      try {
        signinProbe = await probeDynamicSignin({ merchantId })
      } catch (error) {
        signinProbe = {
          dynamicJwtAcceptedOk: false,
          dynamicEmbeddedUserExists: null,
          baseWalletExists: null,
          solanaWalletExists: null,
          dynamicRejectionCode: error instanceof Error ? error.message : "probe_failed",
          dynamicRejectionMessages: [],
        }
      }
    }

    // Coarse presence/status values only - deliberately no emails, addresses,
    // Dynamic IDs, JWTs, or provider payloads.
    return NextResponse.json({
      supabaseAuthOk: true,
      dynamicAuthMode: authConfig.mode,
      externalJwtEnabled: authConfig.externalJwtConfigured,
      dynamicJwtGeneratedOk,
      jwtGenerationError,
      claims,
      jwksLoaded: jwks.jwksLoaded,
      jwksKidFound: jwks.kidFound,
      dynamicExternalAuthEnabled: environmentFacts.dynamicExternalAuthEnabled,
      dynamicEnvironmentName: environmentFacts.dynamicEnvironmentName,
      ...(signinProbe
        ? {
            dynamicJwtAcceptedOk: signinProbe.dynamicJwtAcceptedOk,
            dynamicEmbeddedUserExists: signinProbe.dynamicEmbeddedUserExists,
            baseWalletExists: signinProbe.baseWalletExists,
            solanaWalletExists: signinProbe.solanaWalletExists,
            dynamicRejectionCode: signinProbe.dynamicRejectionCode,
            dynamicRejectionMessages: signinProbe.dynamicRejectionMessages,
          }
        : {}),
      profileExists: Boolean(profile),
      profileStatus: profile?.status ?? null,
      profileHasBaseAddress: Boolean(profile?.base_address),
      profileHasSolanaAddress: Boolean(profile?.solana_address),
      lightningStatus: lightningProfile?.status ?? null,
      setupVerification,
    })
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to run PineTree Wallet smoke check" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
