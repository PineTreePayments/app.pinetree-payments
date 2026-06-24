/**
 * GET /api/internal/speed/capabilities
 * Server-only diagnostic — checks what the configured Speed API key can do.
 * Protected by INTERNAL_API_SECRET or CRON_SECRET. Never exposes raw API keys.
 */

import { type NextRequest, NextResponse } from "next/server"
import { checkSpeedCapabilities } from "@/providers/lightning/speedCapabilities"

function isAuthorized(req: NextRequest): boolean {
  const secret =
    String(process.env.INTERNAL_API_SECRET || "").trim() ||
    String(process.env.CRON_SECRET || "").trim()

  if (!secret) return false

  const authHeader = req.headers.get("authorization") || ""
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
  return bearer === secret
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const capabilities = await checkSpeedCapabilities()
    return NextResponse.json({ capabilities })
  } catch (error) {
    return NextResponse.json(
      {
        error: "Capabilities check failed",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
