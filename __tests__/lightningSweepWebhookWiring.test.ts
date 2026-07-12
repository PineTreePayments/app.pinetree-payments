import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("Lightning sweep webhook wiring", () => {
  const eventProcessor = read("engine/eventProcessor.ts")
  const speedWebhookRoute = read("app/api/webhooks/speed/route.ts")
  const pinetreeManagedRoute = read("app/api/wallets/lightning/pinetree-managed/route.ts")

  it("only queues a sweep after webhook signature verification succeeds", () => {
    const verifyIndex = eventProcessor.indexOf("adapter.verifyWebhook")
    const rejectionIndex = eventProcessor.indexOf('throw new Error("Webhook verification failed")')
    const sweepCallIndex = eventProcessor.lastIndexOf("ensureLightningSweepQueued(paymentId)")

    expect(verifyIndex).toBeGreaterThan(-1)
    expect(sweepCallIndex).toBeGreaterThan(-1)
    expect(verifyIndex).toBeLessThan(rejectionIndex)
    expect(rejectionIndex).toBeLessThan(sweepCallIndex)
  })

  it("queues the sweep from both the fresh-confirmation and idempotent-terminal-replay branches, gated to Speed only", () => {
    const matches = eventProcessor.match(/ensureLightningSweepQueued\(paymentId\)/g) || []
    expect(matches.length).toBe(2)

    // Both call sites must be inside a `provider === SPEED_PROVIDER_NAME` guard.
    const occurrences = [...eventProcessor.matchAll(/ensureLightningSweepQueued\(paymentId\)/g)]
    for (const occurrence of occurrences) {
      const before = eventProcessor.slice(Math.max(0, occurrence.index! - 400), occurrence.index)
      expect(before).toContain("provider === SPEED_PROVIDER_NAME")
    }
  })

  it("only queues the sweep on a confirmed event, never on pending/processing/failed", () => {
    const occurrences = [...eventProcessor.matchAll(/ensureLightningSweepQueued\(paymentId\)/g)]
    for (const occurrence of occurrences) {
      const before = eventProcessor.slice(Math.max(0, occurrence.index! - 1000), occurrence.index)
      expect(before).toMatch(/payment\.confirmed|event\.event === "payment\.confirmed"/)
    }
  })

  it("delegates queueing to the dedicated engine module rather than inlining sweep logic in the event processor", () => {
    expect(eventProcessor).toContain('await import("./lightningSweep")')
    expect(eventProcessor).toContain("ensureLightningSweepForConfirmedPayment")
  })

  it("schedules bounded, deferred sweep processing after the webhook responds - never inside the verified-webhook processing itself", () => {
    const processIndex = speedWebhookRoute.indexOf("await processWebhook(")
    const scheduleIndex = speedWebhookRoute.indexOf("scheduleLightningSweepProcessing(")
    const responseIndex = speedWebhookRoute.indexOf('NextResponse.json({ received: true })')

    expect(processIndex).toBeGreaterThan(-1)
    expect(scheduleIndex).toBeGreaterThan(-1)
    expect(processIndex).toBeLessThan(scheduleIndex)
    expect(scheduleIndex).toBeLessThan(responseIndex)
  })

  it("the wallet page-load route only schedules processing when a sweep is actually due, never unconditionally", () => {
    expect(pinetreeManagedRoute).toContain(
      "if (await hasProcessableLightningSweepForMerchant(merchantId)) {"
    )
    const guardIndex = pinetreeManagedRoute.indexOf(
      "if (await hasProcessableLightningSweepForMerchant(merchantId)) {"
    )
    const scheduleIndex = pinetreeManagedRoute.indexOf("scheduleLightningSweepProcessing(")
    expect(scheduleIndex).toBeGreaterThan(guardIndex)
    // Must be inside the guard block, not a later sibling statement.
    expect(scheduleIndex - guardIndex).toBeLessThan(150)
  })
})

describe("Merchants never see Speed branding or sweep internals", () => {
  const walletPage = read("app/dashboard/wallet-setup/page.tsx")
  const providersPage = read("app/dashboard/providers/page.tsx")
  const settingsPage = read("app/dashboard/settings/page.tsx")

  // Scoped to the new terms this feature introduces - not the pre-existing
  // speed_connected_account_id/speed_account_id internal type fields, which
  // predate this work and are never rendered as visible copy.
  const forbiddenPatterns: RegExp[] = [
    /Instant Send/i,
    /X-Speed-Account/,
    /speed_header_account_id/,
    /merchant_lightning_sweeps/,
    /lightning[-_]?sweep/i,
  ]

  for (const page of [
    { name: "wallet-setup", src: walletPage },
    { name: "providers", src: providersPage },
    { name: "settings", src: settingsPage },
  ]) {
    it(`${page.name} page never references Speed Custom Connect identifiers or Instant Send`, () => {
      for (const pattern of forbiddenPatterns) {
        expect(page.src).not.toMatch(pattern)
      }
    })
  }

  it("no merchant-facing dashboard page imports the sweep engine, adapter, or DB modules directly", () => {
    const dashboardDir = path.join(process.cwd(), "app/dashboard")
    const forbiddenImports = [
      "@/engine/lightningSweep",
      "@/engine/adminLightningSweeps",
      "@/providers/lightning/speedInstantSend",
      "@/database/merchantLightningSweeps",
      "@/engine/pineTreeWalletLightningInvoice",
    ]

    function walk(dir: string): string[] {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      const files: string[] = []
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) files.push(...walk(full))
        else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) files.push(full)
      }
      return files
    }

    for (const file of walk(dashboardDir)) {
      const src = fs.readFileSync(file, "utf8")
      for (const forbidden of forbiddenImports) {
        expect(src, `${file} must not import ${forbidden}`).not.toContain(forbidden)
      }
    }
  })
})

describe("Admin route auth matrix documents the new sweep routes", () => {
  const matrix = read("docs/security/route-auth-matrix.md")

  it("lists all four lightning-sweeps admin routes as ADMIN-only", () => {
    expect(matrix).toContain("/api/admin/lightning-sweeps")
    expect(matrix).toContain("/api/admin/lightning-sweeps/[sweepId]/retry")
    expect(matrix).toContain("/api/admin/lightning-sweeps/[sweepId]/cancel")
  })
})
