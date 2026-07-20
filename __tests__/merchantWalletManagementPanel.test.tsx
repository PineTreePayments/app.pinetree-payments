import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "fs"
import { describe, expect, it } from "vitest"
import MerchantWalletManagementPanel from "@/components/dashboard/MerchantWalletManagementPanel"

const componentSource = readFileSync(
  "components/dashboard/MerchantWalletManagementPanel.tsx",
  "utf8"
)

describe("MerchantWalletManagementPanel", () => {
  it("renders its initial loading state without throwing, with no access token", () => {
    const markup = renderToStaticMarkup(createElement(MerchantWalletManagementPanel, { accessToken: null }))
    expect(markup).toContain("animate-spin")
  })

  it("renders its initial loading state without throwing, with an access token present", () => {
    const markup = renderToStaticMarkup(createElement(MerchantWalletManagementPanel, { accessToken: "token-123" }))
    expect(markup).toContain("animate-spin")
  })

  it("only ever calls generic, authenticated PineTree wallet routes - never a provider-branded path", () => {
    expect(componentSource).not.toContain("/api/wallets/speed")
    expect(componentSource).not.toContain("speedAccountId")
    expect(componentSource).not.toContain("speed_account_id")
    expect(componentSource).not.toContain("X-Speed-Account")
    expect(componentSource).not.toMatch(/\bSpeed\b/)

    for (const path of [
      "/api/wallets/capabilities",
      "/api/wallets/balances",
      "/api/wallets/activity",
      "/api/wallets/withdrawals",
    ]) {
      expect(componentSource).toContain(path)
    }
    expect(componentSource).not.toContain("/api/wallets/payouts")
    expect(componentSource).not.toContain("/api/wallets/swaps")
    expect(componentSource).not.toContain("/api/wallets/preferences")
  })

  it("derives any provider display label from the normalized API response, never a hardcoded provider name", () => {
    expect(componentSource).toContain("providerDisplayName")
    expect(componentSource).not.toMatch(/"Speed"/)
  })

  it("keeps unsupported automation non-interactive and requires withdrawal review", () => {
    expect(componentSource).not.toContain("Automatic conversion and scheduled payouts are not currently available for Bitcoin Lightning.")
    expect(componentSource).not.toContain("ToggleSwitch")
    expect(componentSource).toContain("Review")
    expect(componentSource).toContain("Confirm withdrawal")
  })

  it("removes the merchant-facing capability diagnostics summary from the Activity tab", () => {
    expect(componentSource).not.toContain("function CapabilitySummary")
    expect(componentSource).not.toContain("function PreferencesCard")
    expect(componentSource).not.toContain("Not yet available")
    expect(componentSource).not.toContain("<CapabilitySummary")
    expect(componentSource).not.toContain("<PreferencesCard")
    expect(componentSource).toContain("<BalancesCard")
    expect(componentSource).toContain("<ActivityCard")
  })

  it("keeps one idempotency key for the dialog so rapid duplicate submits converge", () => {
    expect(componentSource).toContain("const [idempotencyKey] = useState(() => crypto.randomUUID())")
    expect(componentSource).toContain('headers: { "Idempotency-Key": idempotencyKey }')
  })
})
