import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

describe("check-environment.mjs PineTree Wallet Dynamic auth coverage", () => {
  const script = read("scripts/check-environment.mjs")

  it("validates every env var the Dynamic auth code actually reads", () => {
    expect(script).toContain('name: "PineTree Wallet Dynamic auth"')
    for (const name of [
      "NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID",
      "NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE",
      "NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK",
      "DYNAMIC_EXTERNAL_JWT_ENABLED",
      "DYNAMIC_EXTERNAL_JWT_ISSUER",
      "DYNAMIC_EXTERNAL_JWT_AUDIENCE",
      "DYNAMIC_EXTERNAL_JWT_KID",
      "DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64",
    ]) {
      expect(script).toContain(`"${name}"`)
    }
  })

  it("fails strict mode when external_jwt mode is missing its server-only config", () => {
    expect(script).toContain('dynamicAuthMode === "external_jwt"')
    expect(script).toContain("missingExternalJwtVars.length > 0 || ![\"true\", \"1\"].includes(enabledValue)")
    expect(script).toContain("requiredFailures += 1")
  })

  it("fails strict mode when email fallback is disabled without external_jwt configured", () => {
    expect(script).toContain("dynamicEmailFallbackDisabled")
    expect(script).toContain('NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK=false without NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE=external_jwt')
  })

  it("never prints raw env values", () => {
    expect(script).toContain("Values are never printed.")
    expect(script).not.toContain("console.log(env[")
  })
})
