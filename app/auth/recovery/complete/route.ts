import { NextResponse } from "next/server"
import { logRecoveryDiagnostic, RECOVERY_COOKIE_NAME } from "@/lib/auth/recovery"

export async function POST() {
  const response = NextResponse.json(
    { completed: true },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } }
  )
  response.cookies.set(RECOVERY_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  })
  logRecoveryDiagnostic("marker.cleared")
  return response
}
