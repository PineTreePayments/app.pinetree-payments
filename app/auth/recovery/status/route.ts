import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { RECOVERY_COOKIE_NAME } from "@/lib/auth/recovery"

export async function GET() {
  const cookieStore = await cookies()
  return NextResponse.json(
    { recoveryActive: cookieStore.has(RECOVERY_COOKIE_NAME) },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } }
  )
}
