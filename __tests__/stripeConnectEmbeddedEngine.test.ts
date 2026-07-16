import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Engine tests for Stripe Connect embedded onboarding:
 *  - a connected account is created only when none exists
 *  - an existing connected account is always reused (no duplicates)
 *  - status sync persists normalized state through PineTree Engine
 *  - a merchant/account metadata binding mismatch is rejected
 *  - Account Session client secrets are never persisted
 */

type UpsertRow = {
  merchant_id: string
  provider: string
  status: string
  enabled: boolean
  credentials: Record<string, unknown>
}

const mocks = vi.hoisted(() => {
  const state = {
    storedCredentials: {} as Record<string, unknown>,
    upserts: [] as UpsertRow[]
  }

  const query = {
    maybeSingle: vi.fn(async () => ({ data: { credentials: state.storedCredentials }, error: null }))
  }

  const db = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => query)
        }))
      })),
      upsert: vi.fn(async (row: UpsertRow) => {
        state.upserts.push(row)
        return { error: null }
      })
    }))
  }

  return {
    state,
    db,
    createStripeConnectedAccount: vi.fn(),
    createStripeAccountSession: vi.fn(),
    createStripeOnboardingLink: vi.fn(),
    retrieveStripeConnectedAccount: vi.fn(),
    retrieveStripeConnectedAccountDetails: vi.fn()
  }
})

vi.mock("@/database", () => ({
  supabase: mocks.db,
  supabaseAdmin: mocks.db
}))

vi.mock("@/providers/stripe", async () => {
  const capabilities = await vi.importActual<typeof import("@/providers/stripe/capabilities")>(
    "@/providers/stripe/capabilities"
  )
  return {
    ...capabilities,
    STRIPE_MERCHANT_METADATA_KEY: "pinetree_merchant_id",
    createStripeConnectedAccount: mocks.createStripeConnectedAccount,
    createStripeAccountSession: mocks.createStripeAccountSession,
    createStripeOnboardingLink: mocks.createStripeOnboardingLink,
    retrieveStripeConnectedAccount: mocks.retrieveStripeConnectedAccount,
    retrieveStripeConnectedAccountDetails: mocks.retrieveStripeConnectedAccountDetails
  }
})

import {
  createStripeAccountSessionEngine,
  ensureStripeConnectedAccountEngine,
  syncStripeConnectionEngine
} from "@/engine/stripeConnect"

function activeAccountDetails(merchantId = "merchant_1") {
  return {
    id: "acct_existing",
    detailsSubmitted: true,
    chargesEnabled: true,
    payoutsEnabled: true,
    requirements: {
      currentlyDue: [],
      eventuallyDue: [],
      pastDue: [],
      pendingVerification: [],
      disabledReason: null
    },
    capabilities: { card_payments: "active", transfers: "active" },
    metadata: { pinetree_merchant_id: merchantId }
  }
}

describe("Stripe Connect embedded engine", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.storedCredentials = {}
    mocks.state.upserts.length = 0
    mocks.createStripeConnectedAccount.mockResolvedValue({
      id: "acct_new",
      detailsSubmitted: false,
      chargesEnabled: false,
      payoutsEnabled: false
    })
    mocks.createStripeAccountSession.mockResolvedValue({ clientSecret: "accs_secret_test_value" })
    mocks.retrieveStripeConnectedAccountDetails.mockResolvedValue(activeAccountDetails())
  })

  it("creates a connected account only when none exists and persists the ID", async () => {
    const result = await ensureStripeConnectedAccountEngine({ merchantId: "merchant_1" })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.created).toBe(true)
    expect(result.connection.connectionStatus).toBe("onboarding_required")
    expect(mocks.createStripeConnectedAccount).toHaveBeenCalledTimes(1)
    expect(mocks.createStripeConnectedAccount).toHaveBeenCalledWith({ merchantId: "merchant_1" })

    expect(mocks.state.upserts).toHaveLength(1)
    const upsert = mocks.state.upserts[0]
    expect(upsert.merchant_id).toBe("merchant_1")
    expect(upsert.provider).toBe("stripe")
    expect(upsert.status).toBe("pending")
    expect(upsert.enabled).toBe(false)
    expect(upsert.credentials.stripe_account_id).toBe("acct_new")
    expect(upsert.credentials.connection_status).toBe("onboarding_required")
  })

  it("reuses an existing connected account and never creates a duplicate", async () => {
    mocks.state.storedCredentials = { stripe_account_id: "acct_existing" }

    const result = await ensureStripeConnectedAccountEngine({ merchantId: "merchant_1" })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.created).toBe(false)
    expect(result.connection.accountConnected).toBe(true)
    expect(mocks.createStripeConnectedAccount).not.toHaveBeenCalled()
    expect(mocks.state.upserts).toHaveLength(0)
  })

  it("creates an onboarding session for the stored account without persisting the client secret", async () => {
    mocks.state.storedCredentials = { stripe_account_id: "acct_existing" }

    const result = await createStripeAccountSessionEngine({ merchantId: "merchant_1" })

    expect(result).toEqual({ ok: true, clientSecret: "accs_secret_test_value" })
    expect(mocks.createStripeAccountSession).toHaveBeenCalledWith({ accountId: "acct_existing" })
    expect(mocks.createStripeConnectedAccount).not.toHaveBeenCalled()
    expect(JSON.stringify(mocks.state.upserts)).not.toContain("accs_secret_test_value")
  })

  it("synchronizes normalized status into the database as the source of truth", async () => {
    mocks.state.storedCredentials = { stripe_account_id: "acct_existing" }

    const result = await syncStripeConnectionEngine({ merchantId: "merchant_1" })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.connection.connectionStatus).toBe("active")
    expect(result.connection.chargesEnabled).toBe(true)
    expect(result.connection.payoutsEnabled).toBe(true)

    expect(mocks.state.upserts).toHaveLength(1)
    const upsert = mocks.state.upserts[0]
    expect(upsert.status).toBe("active")
    expect(upsert.enabled).toBe(true)
    expect(upsert.credentials.connection_status).toBe("active")
    expect(upsert.credentials.charges_enabled).toBe(true)
    expect(upsert.credentials.payouts_enabled).toBe(true)
  })

  it("returns not_connected without calling Stripe when no account exists", async () => {
    const result = await syncStripeConnectionEngine({ merchantId: "merchant_1" })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.connection.connectionStatus).toBe("not_connected")
    expect(result.connection.accountConnected).toBe(false)
    expect(mocks.retrieveStripeConnectedAccountDetails).not.toHaveBeenCalled()
    expect(mocks.state.upserts).toHaveLength(0)
  })

  it("rejects a merchant/account binding mismatch and persists nothing", async () => {
    mocks.state.storedCredentials = { stripe_account_id: "acct_existing" }
    mocks.retrieveStripeConnectedAccountDetails.mockResolvedValue(activeAccountDetails("merchant_other"))

    const result = await syncStripeConnectionEngine({ merchantId: "merchant_1" })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe("Stripe account is not linked to this merchant.")
    expect(mocks.state.upserts).toHaveLength(0)
  })

  it("never leaks the Stripe account ID in the normalized connection state", async () => {
    mocks.state.storedCredentials = { stripe_account_id: "acct_existing" }

    const result = await syncStripeConnectionEngine({ merchantId: "merchant_1" })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(JSON.stringify(result.connection)).not.toContain("acct_existing")
  })
})
