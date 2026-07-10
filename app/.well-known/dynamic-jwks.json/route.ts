import { NextResponse } from "next/server"
import { deriveDynamicExternalJwtPublicJwk } from "@/lib/api/dynamicExternalJwt"

async function derivePublicJwks() {
  return {
    keys: [await deriveDynamicExternalJwtPublicJwk()],
  }
}

export async function GET() {
  try {
    const jwks = await derivePublicJwks()
    return NextResponse.json(jwks, {
      headers: {
        "Cache-Control": "public, max-age=300, must-revalidate",
      },
    })
  } catch (error) {
    const status =
      typeof error === "object" && error !== null && "status" in error && typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : 500
    const code = error instanceof Error ? error.message : "dynamic_external_jwt_jwks_failed"
    return NextResponse.json(
      { error: code },
      {
        status,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    )
  }
}
