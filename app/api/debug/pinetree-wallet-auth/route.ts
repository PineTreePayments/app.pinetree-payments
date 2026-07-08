import { type NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { getPineTreeDynamicAuthConfig } from "@/lib/pinetreeDynamicAuth"
import { GET as getDynamicJwks } from "@/app/.well-known/dynamic-jwks.json/route"

function present(value: string | undefined) {
  return Boolean(value?.trim())
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)
    const publicAuthConfig = getPineTreeDynamicAuthConfig(process.env)
    const jwksResponse = await getDynamicJwks().catch(() => null)

    return NextResponse.json({
      nodeEnv: process.env.NODE_ENV || "",
      vercelEnv: process.env.VERCEL_ENV || "",
      dynamicEnvironmentIdPresent: present(process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID),
      publicAuthModeRaw: publicAuthConfig.rawMode,
      publicAuthModeResolved: publicAuthConfig.mode,
      publicAuthModeValid: publicAuthConfig.configValid,
      publicAuthInvalidReason: publicAuthConfig.invalidReason,
      publicEmailFallbackRaw: publicAuthConfig.rawEmailFallback,
      publicEmailFallbackEnabled: publicAuthConfig.emailFallbackEnabled,
      publicExternalJwtConfigured: publicAuthConfig.externalJwtConfigured,
      dynamicExternalJwtEnabled: process.env.DYNAMIC_EXTERNAL_JWT_ENABLED || "",
      issuerConfigured: present(process.env.DYNAMIC_EXTERNAL_JWT_ISSUER),
      audienceConfigured: present(process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE),
      kidConfigured: present(process.env.DYNAMIC_EXTERNAL_JWT_KID) || present(process.env.DYNAMIC_EXTERNAL_JWT_KEY_ID),
      signingKeyConfigured: present(process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64) || present(process.env.DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY),
      jwksReachable: Boolean(jwksResponse?.ok),
      jwksStatus: jwksResponse?.status ?? null,
      nextPublicAppUrl: process.env.NEXT_PUBLIC_APP_URL || "",
    })
  } catch (error) {
    const status = getRouteErrorStatus(error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "debug_wallet_auth_failed" }, { status })
  }
}
