import { timingSafeEqual } from "crypto"
import type { NextRequest } from "next/server"
import { requireMerchantIdFromRequest } from "./merchantAuth"
import { verifyTerminalSession } from "./terminalAuth"

export async function requireStripeCardMerchant(req: NextRequest): Promise<{ merchantId: string; terminalId: string | null }> {
  const auth = req.headers.get("authorization") || ""
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : ""
  if (token.startsWith("pts_")) {
    try {
      const claims = verifyTerminalSession(token)
      return { merchantId: claims.mid, terminalId: claims.tid }
    } catch {
      throw Object.assign(new Error("Invalid or expired terminal session"), { status: 401 })
    }
  }
  return { merchantId: await requireMerchantIdFromRequest(req), terminalId: null }
}

function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function requireTrustedNativeMerchant(req: NextRequest) {
  const expected = String(process.env.PINETREE_NATIVE_CLIENT_SECRET || "").trim()
  const supplied = String(req.headers.get("x-pinetree-native-secret") || "").trim()
  if (req.headers.get("x-pinetree-client-platform") !== "native" || !expected || !supplied || !equalSecret(supplied, expected)) {
    throw Object.assign(new Error("A trusted PineTree native client is required"), { status: 403 })
  }
  return requireStripeCardMerchant(req)
}

export function isTrustedNativeRequest(req: NextRequest): boolean {
  const expected = String(process.env.PINETREE_NATIVE_CLIENT_SECRET || "").trim()
  const supplied = String(req.headers.get("x-pinetree-native-secret") || "").trim()
  return req.headers.get("x-pinetree-client-platform") === "native" && Boolean(expected && supplied && equalSecret(supplied, expected))
}
