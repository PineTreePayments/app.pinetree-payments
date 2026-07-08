import { type NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"

function present(value: string | undefined) {
  return Boolean(value?.trim())
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)

    return NextResponse.json({
      dynamicEnvironmentIdPresent: present(process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID),
      pineTreeDynamicAuthMode: process.env.NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE || "",
      pineTreeDynamicEmailFallback: process.env.NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK || "",
      dynamicExternalJwtEnabled: process.env.DYNAMIC_EXTERNAL_JWT_ENABLED || "",
      issuerConfigured: present(process.env.DYNAMIC_EXTERNAL_JWT_ISSUER),
      audienceConfigured: present(process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE),
      kidConfigured: present(process.env.DYNAMIC_EXTERNAL_JWT_KID) || present(process.env.DYNAMIC_EXTERNAL_JWT_KEY_ID),
      signingKeyConfigured: present(process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64) || present(process.env.DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY),
      nextPublicAppUrl: process.env.NEXT_PUBLIC_APP_URL || "",
    })
  } catch (error) {
    const status = getRouteErrorStatus(error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "debug_wallet_auth_failed" }, { status })
  }
}
