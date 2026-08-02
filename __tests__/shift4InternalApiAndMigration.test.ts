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
    expect(sql).toContain("force row level security")
    expect(sql).toContain("revoke all on public.shift4_tokenization_sessions from public, anon, authenticated")
    expect(sql).toContain("grant select on public.shift4_tokenization_sessions to service_role")
    expect(sql).toMatch(/grant insert \([\s\S]*completion_secret_hash, status, expires_at[\s\S]*\) on public\.shift4_tokenization_sessions to service_role/)
    expect(sql).not.toMatch(/grant\s+[^;]*\bupdate\b[^;]*shift4_tokenization_sessions/i)
    expect(sql).not.toContain("grant all")
    expect(sql).not.toMatch(/^create\s+(table|index|function)\s+if\s+not\s+exists/gm)
    expect(sql).toContain("security definer set search_path=pg_catalog,public")
    expect(sql).not.toMatch(/\b(pan|cvv|track_data|raw_token)\s+(text|varchar|json)/)
    expect(sql).toContain("before insert or update on public.shift4_tokenization_sessions")
    expect(sql).toContain("ownership and financial identity are immutable")
    expect(sql).toContain("v_stored_fingerprint = p_token_fingerprint")
    expect(sql).toContain("return 'fingerprint_conflict'")
    expect(sql).toContain("status='created'")
    expect(sql).toContain("expires_at > clock_timestamp()")
  })

  it("hardens onboarding identity, idempotency, provider key, and function privileges", () => {
    const sql = source("database/migrations/20260801161000_create_shift4_onboarding_sessions.sql").toLowerCase()
    expect(sql).toContain("strict first-deployment")
    expect(sql).toContain("gen_random_uuid()")
    expect(sql).toContain("array['service_role','anon','authenticated']")
    expect(sql).toContain("v_provider is distinct from 'shift4_rest'")
    expect(sql).not.toMatch(/v_provider\s*(?:<>|is distinct from)\s*'shift4'/)
    expect(sql).toContain("p_merchant_provider_connection_id uuid")
    expect(sql).toContain("merchant_provider_connection_id = p_merchant_provider_connection_id")
    expect(sql).toContain("shift4 onboarding application does not belong to this provider connection")
    for (const identity of [
      "onboarding_session_id", "provider_application_id", "provider_status",
      "status_reason_code", "occurred_at", "correlation_id", "verified", "source",
    ]) expect(sql).toContain(`v_existing_event.${identity}`)
    expect(sql).toContain("shift4 onboarding update idempotency conflict")
    expect(sql).toContain("revoke all on function public.shift4_onboarding_guard_ownership() from public")
    expect(sql).toContain("revoke all on function public.shift4_onboarding_touch_updated_at() from public")
    expect(sql).toContain("revoke all on function public.shift4_onboarding_events_immutable() from public")
    expect(sql).toContain("notify pgrst, 'reload schema'")
    expect(source("database/shift4OnboardingSessions.ts")).toContain(
      "p_merchant_provider_connection_id: input.merchantProviderConnectionId"
    )
    expect(source("app/api/internal/shift4/onboarding/fixture-update/route.ts")).toContain(
      'requiredString(body, "merchantProviderConnectionId")'
    )
  })

  it("stores delayed onboarding evidence without replacing a newer session snapshot", () => {
    const sql = source("database/migrations/20260801161000_create_shift4_onboarding_sessions.sql").toLowerCase()
    const insert = sql.indexOf("insert into public.shift4_onboarding_events")
    const snapshotUpdate = sql.indexOf("update public.shift4_onboarding_sessions", insert)
    const replayReturn = sql.indexOf(
      "return query select * from public.shift4_onboarding_sessions where id = v_session.id",
      insert
    )

    expect(insert).toBeGreaterThan(-1)
    expect(snapshotUpdate).toBeGreaterThan(insert)
    expect(sql).toContain("and v_inserted_id = (")
    expect(sql).toContain("where e.onboarding_session_id = v_session.id")
    expect(sql).toContain("order by e.occurred_at desc, e.received_at desc, e.id desc")
    expect(sql).toMatch(
      /on public\.shift4_onboarding_events \(\s*onboarding_session_id, occurred_at desc, received_at desc, id desc\s*\)/
    )

    // Identical replay returns before the snapshot update; conflicting reuse
    // still raises, and session lookup remains exact-connection scoped.
    expect(replayReturn).toBeLessThan(snapshotUpdate)
    expect(sql).toContain("shift4 onboarding update idempotency conflict")
    expect(sql).toContain("merchant_provider_connection_id = p_merchant_provider_connection_id")

    type Event = { id: string; connection: string; status: "approved" | "declined"; occurredAt: string; receivedAt: string }
    const currentFor = (events: Event[], connection: string) => events
      .filter((event) => event.connection === connection)
      .sort((left, right) =>
        right.occurredAt.localeCompare(left.occurredAt) ||
        right.receivedAt.localeCompare(left.receivedAt) ||
        right.id.localeCompare(left.id)
      )[0]

    const newerDecline: Event = { id: "b", connection: "connection-a", status: "declined", occurredAt: "2026-08-02T12:00:00.000Z", receivedAt: "2026-08-02T12:00:01.000Z" }
    const delayedOldApproval: Event = { id: "c", connection: "connection-a", status: "approved", occurredAt: "2026-08-02T11:00:00.000Z", receivedAt: "2026-08-02T13:00:00.000Z" }
    expect(currentFor([newerDecline, delayedOldApproval], "connection-a").status).toBe("declined")

    const newerApproval: Event = { id: "d", connection: "connection-a", status: "approved", occurredAt: "2026-08-02T14:00:00.000Z", receivedAt: "2026-08-02T14:00:01.000Z" }
    const delayedOldDecline: Event = { id: "e", connection: "connection-a", status: "declined", occurredAt: "2026-08-02T13:00:00.000Z", receivedAt: "2026-08-02T15:00:00.000Z" }
    const otherConnection: Event = { id: "f", connection: "connection-b", status: "declined", occurredAt: "2026-08-02T16:00:00.000Z", receivedAt: "2026-08-02T16:00:01.000Z" }
    expect(currentFor([newerApproval, delayedOldDecline, otherConnection], "connection-a").status).toBe("approved")
    expect(currentFor([newerApproval, delayedOldDecline, otherConnection], "connection-b").status).toBe("declined")
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
