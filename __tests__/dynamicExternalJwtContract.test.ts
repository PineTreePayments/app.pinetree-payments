import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  dynamicSessionBoundToMerchant,
  getDynamicExternalUserId,
} from "@/lib/wallets/dynamicExternalIdentity"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

const merchantId = "71478b11-ed12-4dbf-8466-52807995bac0"

describe("Dynamic external identity mapping", () => {
  it("extracts the externalUser credential public identifier (both casings)", () => {
    expect(getDynamicExternalUserId({
      verifiedCredentials: [
        { format: "email", publicIdentifier: "merchant@example.com" },
        { format: "externalUser", publicIdentifier: merchantId },
      ],
    })).toBe(merchantId)
    expect(getDynamicExternalUserId({
      verifiedCredentials: [
        { format: "externalUser", public_identifier: merchantId },
      ],
    })).toBe(merchantId)
  })

  it("binds a session to the merchant only on an exact externalUser match", () => {
    const user = {
      verifiedCredentials: [{ format: "externalUser", publicIdentifier: merchantId }],
    }
    expect(dynamicSessionBoundToMerchant(user, merchantId)).toBe(true)
    expect(dynamicSessionBoundToMerchant(user, "someone-else")).toBe(false)
    expect(dynamicSessionBoundToMerchant(user, null)).toBe(false)
    expect(dynamicSessionBoundToMerchant(user, "")).toBe(false)
  })

  it("never binds from emails, missing credentials, or malformed users", () => {
    expect(getDynamicExternalUserId(null)).toBeNull()
    expect(getDynamicExternalUserId({})).toBeNull()
    expect(getDynamicExternalUserId({ verifiedCredentials: "not-an-array" })).toBeNull()
    expect(getDynamicExternalUserId({
      verifiedCredentials: [{ format: "email", publicIdentifier: merchantId }],
    })).toBeNull()
    expect(dynamicSessionBoundToMerchant({ verifiedCredentials: [] }, merchantId)).toBe(false)
  })
})

describe("Wallet setup page - external JWT contract wiring", () => {
  const page = read("app/dashboard/wallet-setup/page.tsx")
  const eventRoute = read("app/api/debug/pinetree-wallet/setup-event/route.ts")
  const jwtRoute = read("app/api/wallets/dynamic/external-jwt/route.ts")
  const jwtLib = read("lib/api/dynamicExternalJwt.ts")

  it("uses the externalUser credential binding to exempt PineTree-signed sessions from email gates", () => {
    expect(page).toContain("dynamicSessionBoundToMerchant(user, merchantId)")
    // Both live derived states and the pre-provisioning identity gate must be
    // short-circuited by the external binding.
    expect(page).toContain("!dynamicSessionExternallyBound &&\n    Boolean(user) && Boolean(merchantEmail) && Boolean(dynamicUserEmail) && dynamicUserEmail !== merchantEmail")
    expect(page).toContain("!dynamicSessionExternallyBound &&\n    Boolean(user) && Boolean(merchantEmail) && !dynamicUserEmail")
    expect(page).toContain("if (dynamicSessionExternallyBound) return")
    expect(page).toContain("if (!dynamicSessionExternallyBound && merchantEmail && dynamicUserEmail && dynamicUserEmail !== merchantEmail)")
    expect(page).toContain("if (!dynamicSessionExternallyBound && (!merchantEmail || !dynamicUserEmail))")
  })

  it("treats Dynamic native email login as developer recovery only, never the production path", () => {
    expect(page).toContain("const nativeFallbackRecoveryAllowed =")
    expect(page).toContain('walletSyncDebugQueryEnabled || process.env.NODE_ENV !== "production"')
    const rejectedBlock = page.slice(
      page.indexOf('emitWalletSetupDebugEvent("wallet_dynamic_external_jwt_rejected", {})'),
      page.indexOf('logWalletCreationStep("failed", { reason: "dynamic_external_jwt_rejected" })')
    )
    expect(rejectedBlock).toContain("if (nativeFallbackRecoveryAllowed) {")
    expect(rejectedBlock).toContain('emitWalletSetupDebugEvent("wallet_dynamic_native_fallback_suppressed"')
    expect(rejectedBlock).toContain('recordWalletSetupFailure("dynamic_external_jwt_rejected", "failed"')
  })

  it("shows a real diagnostic for a rejected external JWT instead of generic timeout copy", () => {
    expect(page).toContain('"dynamic_external_jwt_rejected"')
    expect(page).toContain("code: external_jwt_rejected")
  })

  it("emits the wallet_dynamic_jwt_auth_* instrumentation with contract booleans only", () => {
    expect(page).toContain('emitWalletSetupDebugEvent("wallet_dynamic_jwt_auth_started", {})')
    const successBlock = page.slice(
      page.indexOf('emitWalletSetupDebugEvent("wallet_dynamic_jwt_auth_success"'),
      page.indexOf('emitWalletSetupDebugEvent("wallet_dynamic_jwt_auth_success"') + 500
    )
    expect(successBlock).toContain("issuerMatch")
    expect(successBlock).toContain("audienceMatch")
    const failedBlock = page.slice(
      page.indexOf('emitWalletSetupDebugEvent("wallet_dynamic_jwt_auth_failed"'),
      page.indexOf('emitWalletSetupDebugEvent("wallet_dynamic_jwt_auth_failed"') + 700
    )
    expect(failedBlock).toContain("issuerMatch")
    expect(failedBlock).toContain("audienceMatch")
    expect(failedBlock).toContain("jwksLoaded")
    expect(failedBlock).toContain("subjectPresent")
    expect(failedBlock).toContain("environmentIdPresent")
    for (const event of [
      "wallet_dynamic_jwt_auth_started",
      "wallet_dynamic_jwt_auth_success",
      "wallet_dynamic_jwt_auth_failed",
      "wallet_dynamic_native_fallback_suppressed",
    ]) {
      expect(eventRoute).toContain(`"${event}"`)
    }
  })

  it("server route logs the auth lifecycle without JWTs or claim values", () => {
    expect(jwtRoute).toContain("wallet_dynamic_jwt_auth_started")
    expect(jwtRoute).toContain("wallet_dynamic_jwt_auth_success")
    expect(jwtRoute).toContain("wallet_dynamic_jwt_auth_failed")
    // The success log spreads boolean claim diagnostics only.
    expect(jwtRoute).toContain("{ ...signed.claims }")
  })

  it("documents and enforces the verified audience contract (environment ID)", () => {
    expect(jwtLib).toContain("VERIFIED CONTRACT (2026-07-10")
    expect(jwtLib).toContain("DYNAMIC_EXTERNAL_JWT_AUDIENCE_OVERRIDE")
    // Environment ID must be consulted before the legacy audience var.
    const fn = jwtLib.slice(
      jwtLib.indexOf("export function resolveDynamicJwtAudience"),
      jwtLib.indexOf("function normalizeOrigin")
    )
    expect(fn.indexOf("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID")).toBeLessThan(fn.indexOf("DYNAMIC_EXTERNAL_JWT_AUDIENCE?."))
    expect(fn).toContain('legacy !== "dynamic"')
  })
})
