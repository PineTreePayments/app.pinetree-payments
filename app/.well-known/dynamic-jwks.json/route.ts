import { NextResponse } from "next/server"
import { createPrivateKey, createPublicKey } from "node:crypto"
import { exportJWK, importPKCS8 } from "jose"

function getSigningKeyPem() {
  const encodedSigningKey = process.env.DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64?.trim()
  if (!encodedSigningKey) {
    throw Object.assign(new Error("dynamic_external_jwt_signing_key_missing"), { status: 503 })
  }

  try {
    const decoded = Buffer.from(encodedSigningKey, "base64").toString("utf8")
    if (!decoded.includes("-----BEGIN PRIVATE KEY-----") || !decoded.includes("-----END PRIVATE KEY-----")) {
      throw new Error("invalid_pem")
    }
    return decoded
  } catch {
    throw Object.assign(new Error("dynamic_external_jwt_signing_key_invalid"), { status: 503 })
  }
}

async function derivePublicJwks() {
  const kid = process.env.DYNAMIC_EXTERNAL_JWT_KID || process.env.DYNAMIC_EXTERNAL_JWT_KEY_ID
  if (!kid) {
    throw Object.assign(new Error("dynamic_external_jwt_kid_missing"), { status: 503 })
  }

  const signingKeyPem = getSigningKeyPem()
  try {
    await importPKCS8(signingKeyPem, "RS256")
    const privateKey = createPrivateKey(signingKeyPem)
    const publicKey = createPublicKey(privateKey)
    const publicJwk = await exportJWK(publicKey)
    return {
      keys: [{
        ...publicJwk,
        kid,
        alg: "RS256",
        use: "sig",
      }],
    }
  } catch {
    throw Object.assign(new Error("dynamic_external_jwt_signing_key_invalid"), { status: 503 })
  }
}

export async function GET() {
  try {
    const jwks = await derivePublicJwks()
    return NextResponse.json(jwks, {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=300",
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
