import { NextRequest, NextResponse } from "next/server"
import { cleanupExpiredApiIdempotencyClaims } from "@/engine/apiIdempotencyCleanup"

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    return NextResponse.json(await cleanupExpiredApiIdempotencyClaims())
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to clean API idempotency claims",
      },
      { status: 500 }
    )
  }
}
