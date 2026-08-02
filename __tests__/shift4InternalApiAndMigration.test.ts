import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

describe("Shift4 internal API and additive migration structure", () => {
  const paymentRoute = source("app/api/internal/shift4/payments/[operation]/route.ts")

  it("authenticates, requires idempotency, and invokes the Engine service", () => {
    expect(paymentRoute).toContain("requireMerchantIdFromRequest")
    expect(paymentRoute).toContain("requireIdempotencyKey")
    expect(paymentRoute).toContain("executeMerchantShift4Operation")
    expect(paymentRoute).not.toContain("@/providers/shift4")
    expect(paymentRoute).not.toContain("merchantId: requiredString")
  })

  it("keeps routes internal and responses structurally unable to expose secrets", () => {
    const helper = source("lib/api/shift4Routes.ts")
    expect(helper).toContain("{ ok: true, data }")
    expect(helper).toContain("correlationId")
    expect(source("app/api/internal/shift4/readiness/route.ts")).toContain("getShift4ReadinessForMerchant")
    expect(source("app/api/internal/shift4/tokenization/complete/route.ts")).not.toContain("accessToken")
  })

  it("uses a strict additive tokenization migration with service-role-only access", () => {
    const sql = source("database/migrations/20260801160000_create_shift4_tokenization_sessions.sql").toLowerCase()
    expect(sql).toContain("strict first-deployment")
    expect(sql).toContain("enable row level security")
    expect(sql).toContain("revoke all on public.shift4_tokenization_sessions from public, anon, authenticated")
    expect(sql).toContain("grant select, insert, update on public.shift4_tokenization_sessions to service_role")
    expect(sql).not.toContain("grant all")
    expect(sql).not.toMatch(/^create\s+(table|index|function)\s+if\s+not\s+exists/gm)
    expect(sql).toContain("security definer set search_path=pg_catalog,public")
    expect(sql).not.toMatch(/\b(pan|cvv|track_data|raw_token)\s+(text|varchar|json)/)
  })

  it("does not add a Shift4 webhook route and documents polling authority", () => {
    expect(source("docs/architecture/shift4-integration-architecture.md")).toContain("No Shift4 webhook route was added")
    expect(source("providers/shift4/verifyWebhook.ts")).toContain("fail closed")
  })

  it("keeps fixture commands and checkout/POS state views fail-closed", () => {
    const command = source("app/api/admin/shift4/certification/route.ts")
    expect(command).toContain("requireAdminFromRequest")
    expect(command).toContain("runShift4CertificationFixture")
    expect(source("engine/shift4/certificationService.ts")).toContain("providerRequestsSent: 0")
    expect(command).toContain("certification_external_blocker")
    expect(command).not.toContain("@/providers/shift4")
    const checkout = source("components/payment/Shift4HostedCheckoutPanel.tsx")
    const retail = source("components/payment/Shift4RetailTerminalPanel.tsx")
    expect(checkout).toContain('const canStart = props.state === "ready" && Boolean(props.onStart)')
    expect(retail).toContain('data-keypad-locked={active ? "true" : "false"}')
    expect(checkout + retail).not.toContain("@/providers/shift4")
  })
})
