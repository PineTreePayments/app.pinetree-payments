#!/usr/bin/env node
import { exportJWK, exportPKCS8, generateKeyPair, calculateJwkThumbprint } from "jose"

const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://app.pinetree-payments.com"
const issuer = process.env.DYNAMIC_EXTERNAL_JWT_ISSUER || appUrl
const audience = process.env.DYNAMIC_EXTERNAL_JWT_AUDIENCE ?? "dynamic"

const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true })
const privateKeyPem = await exportPKCS8(privateKey)
const publicJwk = await exportJWK(publicKey)
const kid = `pinetree-dynamic-${(await calculateJwkThumbprint(publicJwk)).slice(0, 12)}`
const jwk = {
  ...publicJwk,
  kid,
  alg: "RS256",
  use: "sig",
}
const jwks = { keys: [jwk] }
const jwksJson = JSON.stringify(jwks)
const signingKeyB64 = Buffer.from(privateKeyPem, "utf8").toString("base64")

const output = {
  kid,
  issuer,
  audience,
  jwksUrl: `${appUrl.replace(/\/$/, "")}/.well-known/dynamic-jwks.json`,
  signingKeyB64,
  jwks,
}

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  process.exit(0)
}

console.log("PineTree Dynamic External JWT / BYOA key material")
console.log("")
console.log("A) Vercel server env vars")
console.log("```bash")
console.log("DYNAMIC_EXTERNAL_JWT_ENABLED=true")
console.log(`DYNAMIC_EXTERNAL_JWT_ISSUER=${issuer}`)
console.log(`DYNAMIC_EXTERNAL_JWT_AUDIENCE=${audience}`)
console.log(`DYNAMIC_EXTERNAL_JWT_KID=${kid}`)
console.log(`DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64=${signingKeyB64}`)
console.log(`DYNAMIC_EXTERNAL_JWT_JWKS_PUBLIC='${jwksJson}'`)
console.log("```")
console.log("")
console.log("B) Vercel public env vars")
console.log("```bash")
console.log("NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE=external_jwt")
console.log("NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK=false")
console.log("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID=<from Dynamic dashboard>")
console.log("```")
console.log("")
console.log("C) Dynamic dashboard values PineTree can provide")
console.log("```text")
console.log(`Issuer: ${issuer}`)
console.log(`JWKS URL: ${output.jwksUrl}`)
console.log(`Audience: ${audience || "<empty unless Dynamic requires one>"}`)
console.log(`Algorithm: RS256`)
console.log(`Key ID / kid: ${kid}`)
console.log("```")
console.log("")
console.log("D) Values that must come from Dynamic/support")
console.log("```text")
console.log("- BYOA / External JWT enabled on the Dynamic project")
console.log("- Confirmation RS256 is accepted for this project")
console.log("- Required JWT claims beyond iss/sub/exp/iat/jti/email, if any")
console.log("- Whether aud is required and the exact audience value")
console.log("- Sandbox and production Dynamic environment IDs")
console.log("- Dashboard location or support confirmation for issuer/JWKS configuration")
console.log("```")
console.log("")
console.log("Do not commit the signing key. Store it only in server-side secret env vars.")
