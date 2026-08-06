/**
 * Bridge (by Stripe) - adapter contract and non-regression guarantees.
 *
 * Bridge must be a separate provider connection from Stripe and must not be
 * able to affect payment routing, the payment state machine, or any existing
 * provider's behavior in this phase.
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { bridgeAdapter } from "@/providers/bridge/adapter"
import { getProvider, getProviderMetadata, getProvidersForNetwork } from "@/providers/registry"
import { BRIDGE_DISPLAY_NAME, BRIDGE_PROVIDER_KEY } from "@/providers/bridge/normalize"

const repoRoot = path.resolve(__dirname, "..")
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), "utf8")

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("Bridge adapter identity", () => {
  it("registers under the canonical internal provider key", () => {
    expect(bridgeAdapter.providerId).toBe("bridge")
    expect(BRIDGE_PROVIDER_KEY).toBe("bridge")
    expect(getProvider("bridge")).toBe(bridgeAdapter)
  })

  it("uses the merchant-facing display name", () => {
    expect(bridgeAdapter.providerName).toBe("Bridge by Stripe")
    expect(BRIDGE_DISPLAY_NAME).toBe("Bridge by Stripe")
    expect(getProviderMetadata("bridge")?.displayName).toBe("Bridge by Stripe")
  })

  it("is a different adapter from the Stripe adapter", async () => {
    const { stripeAdapter } = await import("@/providers/stripe")
    expect(getProvider("stripe")).not.toBe(getProvider("bridge"))
    expect(stripeAdapter).not.toBe(bridgeAdapter)
  })

  it("implements the universal provider connector contract", () => {
    for (const method of [
      "connectMerchant",
      "getMerchantStatus",
      "syncAccount",
      "verifyWebhook",
      "translateEvent",
    ] as const) {
      expect(typeof bridgeAdapter[method]).toBe("function")
    }
  })
})

describe("Bridge cannot affect payment routing in this phase", () => {
  it("declares no supported payment networks", () => {
    expect(bridgeAdapter.supportedNetworks).toEqual([])
    expect(getProviderMetadata("bridge")?.supportedNetworks).toEqual([])
  })

  it("is never selected for any existing payment network", () => {
    for (const network of ["solana", "base", "bitcoin_lightning", "stripe", "shift4"]) {
      expect(getProvidersForNetwork(network)).not.toContain("bridge")
    }
  })

  it("fails closed rather than pretending payment creation works", async () => {
    await expect(bridgeAdapter.createPayment()).rejects.toThrow(/not enabled yet/i)
  })

  it("returns null status so a payment keeps its canonical state", async () => {
    await expect(bridgeAdapter.getPaymentStatus("anything")).resolves.toEqual({ status: null })
  })

  it("never emits a payment event from a Bridge connection event", () => {
    const customerEvent = {
      event_id: "evt_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      event_category: "customer",
      event_type: "customer.updated.status_transitioned",
      event_object: { id: "cust_fake", status: "active" },
    }

    // A KYB status change must never reach the payment state machine.
    expect(bridgeAdapter.translateEvent(customerEvent)).toBeNull()
    // It is translated through the connection-event path instead.
    expect(bridgeAdapter.translateProviderEvent(customerEvent)?.category).toBe("customer")
  })

  it("reports health from configuration without making a network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    await bridgeAdapter.healthCheck()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("Bridge webhook verification through the adapter", () => {
  it("rejects a delivery with no signature header", () => {
    expect(bridgeAdapter.verifyWebhook({}, undefined, "{}", {})).toBe(false)
  })

  it("rejects a delivery with a malformed signature header", () => {
    expect(bridgeAdapter.verifyWebhook({}, "garbage", "{}", {})).toBe(false)
  })
})

describe("Bridge source boundaries", () => {
  it("keeps Bridge state out of the Stripe Connect engine", () => {
    const stripeConnect = read("engine/stripeConnect.ts")
    expect(stripeConnect.toLowerCase()).not.toContain("bridge")
  })

  it("never imports the Stripe SDK or reads a Stripe env var in the Bridge provider", () => {
    for (const file of [
      "providers/bridge/client.ts",
      "providers/bridge/config.ts",
      "providers/bridge/adapter.ts",
      "providers/bridge/normalize.ts",
      "engine/bridgeConnect.ts",
    ]) {
      const source = read(file)
      expect(source).not.toMatch(/from ["']stripe["']/)
      expect(source).not.toMatch(/STRIPE_[A-Z_]+/)
    }
  })

  it("never exposes Bridge configuration to the browser", () => {
    // Asserted against actual env READS, not the substring: both files
    // document the NEXT_PUBLIC_ prohibition in prose.
    for (const file of ["providers/bridge/config.ts", "providers/bridge/client.ts"]) {
      const source = read(file)
      expect(source).not.toMatch(/process\.env\.NEXT_PUBLIC_/)
      expect(source).not.toMatch(/process\.env\[\s*["'`]NEXT_PUBLIC_/)
    }
    // The merchant-facing verification surface reaches PineTree only.
    const panel = read("components/dashboard/BusinessVerificationPanel.tsx")
    expect(panel).not.toContain("api.bridge.xyz")
    expect(panel).not.toContain("BRIDGE_API_KEY")
    expect(panel).toContain("/api/onboarding/business-verification")
  })

  it("presents only PineTree status vocabulary on the merchant surface", () => {
    const panel = read("components/dashboard/BusinessVerificationPanel.tsx")
    // Labels come from the Engine-supplied statusLabel, never hardcoded here.
    expect(panel).toContain("verification?.statusLabel")
    expect(panel).not.toMatch(/["']Available["']/)
    // No approval-timing promise, and no claim that PineTree approves.
    expect(panel).not.toMatch(/instant approval|approved instantly|guaranteed/i)
  })

  it("does not render Bridge as a provider merchants connect", () => {
    // Bridge is infrastructure. The Providers page is reserved for providers a
    // merchant consciously connects and manages.
    const page = read("app/dashboard/providers/page.tsx")
    expect(page).not.toContain("BridgeProviderCard")
    expect(page.toLowerCase()).not.toContain("bridge by stripe")
  })

  it("ships the forward-only Bridge migration", () => {
    const migration = read(
      "database/migrations/20260805120000_create_bridge_provider_connections.sql"
    )
    expect(migration).toContain("bridge_webhook_events")
    expect(migration).toContain("merchant_providers_bridge_customer_uidx")
    expect(migration).toContain("enable row level security")
    // Forward-only: no destructive statement against existing provider rows.
    expect(migration).not.toMatch(/drop table|delete from|truncate/i)
  })
})
