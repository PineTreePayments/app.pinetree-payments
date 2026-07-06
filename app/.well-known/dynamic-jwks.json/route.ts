import { NextResponse } from "next/server"

function parsePublicJwks() {
  const raw = process.env.DYNAMIC_EXTERNAL_JWT_JWKS_PUBLIC
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "keys" in parsed &&
      Array.isArray((parsed as { keys?: unknown }).keys)
    ) {
      return parsed
    }
    if (typeof parsed === "object" && parsed !== null && "kty" in parsed) {
      return { keys: [parsed] }
    }
  } catch {
    return null
  }
  return null
}

export async function GET() {
  const jwks = parsePublicJwks()
  if (!jwks) {
    return NextResponse.json(
      { error: "dynamic_external_jwt_jwks_missing" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    )
  }

  return NextResponse.json(jwks, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=300",
    },
  })
}
