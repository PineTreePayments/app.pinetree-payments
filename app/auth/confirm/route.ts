import { NextRequest } from "next/server"
import {
  handleRecoveryVerification,
  readRecoveryInput,
  recoveryHeadResponse,
} from "@/lib/auth/recoveryServer"

/**
 * Primary password-recovery entry point.
 *
 * The reset email links here with `?token_hash=...&type=recovery`. Verification
 * happens entirely server-side through `verifyOtp`, so it does not depend on a
 * PKCE code verifier being present in whichever browser or in-app webview the
 * email link happens to open in.
 */
export const dynamic = "force-dynamic"

const ROUTE = "/auth/confirm"

export async function GET(request: NextRequest) {
  return handleRecoveryVerification(request, {
    route: ROUTE,
    method: "GET",
    input: readRecoveryInput(request.nextUrl.searchParams),
  })
}

/**
 * Submitted by the scanner interstitial. Link scanners issue GET and HEAD, not
 * form posts, so this path is only reached by a real person.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData()
  const params = new URLSearchParams()
  for (const key of ["token_hash", "code", "type", "next"]) {
    const value = form.get(key)
    if (typeof value === "string" && value) params.set(key, value)
  }

  return handleRecoveryVerification(request, {
    route: ROUTE,
    method: "POST",
    input: readRecoveryInput(params),
  })
}

export async function HEAD() {
  return recoveryHeadResponse(ROUTE)
}
