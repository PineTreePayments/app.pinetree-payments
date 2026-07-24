import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WalletNetwork } from "@/engine/providerMappings"

/**
 * Direct unit coverage for the classification logic
 * engine/paymentIntents.ts's getMerchantAvailableNetworks() uses to decide
 * checkout/POS eligibility per network - proves each customer-facing
 * network maps to its own distinct provider connection, and that card
 * providers (Stripe/Shift4) and crypto rails (Solana/Base/Lightning) never
 * share a key.
 *
 * engine/paymentIntents.ts pulls in the full database/provider layer at
 * module load - stub it all out so importing walletNetworkToProviderKey/
 * isProviderAvailableForCheckout (pure functions, never touch these) does
 * not attempt to construct a real Supabase client.
 */
vi.mock("@/database", () => ({
  createPaymentIntent: vi.fn(),
  getPaymentIntentById: vi.fn(),
  markPaymentIntentSelected: vi.fn(),
  markPaymentIntentSelectedIfUnchanged: vi.fn(),
  expirePaymentIntent: vi.fn(),
  getMerchantWallets: vi.fn(),
  getConnectedHostedCheckoutNetworks: vi.fn(),
  getPaymentById: vi.fn(),
}))
vi.mock("@/database/transactions", () => ({ getTransactionByPaymentId: vi.fn() }))
vi.mock("@/database/paymentEvents", () => ({ getPaymentEvents: vi.fn() }))
vi.mock("@/engine/createPayment", () => ({ createPayment: vi.fn(), buildCreatePaymentRequest: vi.fn() }))
vi.mock("@/engine/paymentStateActions", () => ({
  markPaymentIncomplete: vi.fn(),
  markPaymentIncompleteIfAbandoned: vi.fn(),
}))
vi.mock("@/engine/baseChainReconciliation", () => ({
  reconcileBasePaymentFromChain: vi.fn(),
}))
vi.mock("@/engine/loadProviders", () => ({ loadProviders: vi.fn() }))
vi.mock("@/database/merchants", () => ({ getMerchantProviders: vi.fn() }))
// SPEED_PROVIDER_NAME is a plain string constant, but its module
// (database/merchantProviders.ts) also constructs a Supabase client at
// import time like every other database/* module in this repo - the value
// is fixed and documented ("lightning_speed") in
// project_speed_wallet_management_foundation memory / prior sessions, so
// it's hardcoded here rather than importing the real module.
const SPEED_PROVIDER_NAME = "lightning_speed"
vi.mock("@/database/merchantProviders", () => ({ SPEED_PROVIDER_NAME }))
vi.mock("@/database/pineTreeWalletProfiles", () => ({ getPineTreeWalletProfile: vi.fn() }))
vi.mock("@/providers/lightning/speedClient", () => ({ getPineTreeSpeedConfigStatus: vi.fn() }))
vi.mock("@/providers/cardProviderReadiness", () => ({ merchantProviderCanProcessPayments: vi.fn() }))
vi.mock("@/lib/pinetreeRailReadiness", () => ({
  buildPineTreeRailReadiness: vi.fn(),
  getPineTreeRailReadinessDiagnostics: vi.fn(),
}))

const {
  cancelPaymentIntentEngine,
  PaymentAlreadySubmittedError,
  selectPaymentIntentNetworkEngine,
  isProviderAvailableForCheckout,
  walletNetworkToProviderKey
} = await import("@/engine/paymentIntents")
const paymentIntentDb = await import("@/database")
const paymentStateActions = await import("@/engine/paymentStateActions")
const baseChainReconciliation = await import("@/engine/baseChainReconciliation")
const { createPayment, buildCreatePaymentRequest } = await import("@/engine/createPayment")
const { getTransactionByPaymentId } = await import("@/database/transactions")
const { getPaymentEvents } = await import("@/database/paymentEvents")

/** Default: no submitted-transaction evidence stored — most cancel tests start here. */
function mockNoStoredEvidence() {
  vi.mocked(getTransactionByPaymentId).mockResolvedValue(null)
  vi.mocked(getPaymentEvents).mockResolvedValue([])
}

describe("walletNetworkToProviderKey", () => {
  it("maps stripe to its own provider key, distinct from every crypto rail", () => {
    expect(walletNetworkToProviderKey("stripe")).toBe("stripe")
  })

  it("maps shift4 to its own provider key", () => {
    expect(walletNetworkToProviderKey("shift4")).toBe("shift4")
  })

  it("maps solana and base to their own provider keys", () => {
    expect(walletNetworkToProviderKey("solana")).toBe("solana")
    expect(walletNetworkToProviderKey("base")).toBe("base")
  })

  it("maps bitcoin_lightning to the lightning provider key, never to stripe/shift4", () => {
    const key = walletNetworkToProviderKey("bitcoin_lightning")
    expect(key).toBe("lightning")
    expect(key).not.toBe("stripe")
    expect(key).not.toBe("shift4")
  })

  it("returns null for an unrecognized/infrastructure-only identifier (e.g. Dynamic, Fireblocks) - they are never a checkout network", () => {
    expect(walletNetworkToProviderKey("dynamic" as WalletNetwork)).toBeNull()
    expect(walletNetworkToProviderKey("fireblocks" as WalletNetwork)).toBeNull()
  })
})

describe("isProviderAvailableForCheckout", () => {
  it("Stripe connected and ready: stripe network is available, no crypto network becomes available as a side effect", () => {
    const enabled = new Set(["stripe"])
    expect(isProviderAvailableForCheckout("stripe", enabled)).toBe(true)
    expect(isProviderAvailableForCheckout("solana", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("base", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("bitcoin_lightning", enabled)).toBe(false)
  })

  it("Speed connected and ready: bitcoin_lightning is available via the canonical SPEED_PROVIDER_NAME key, stripe remains unavailable", () => {
    const enabled = new Set([SPEED_PROVIDER_NAME])
    expect(isProviderAvailableForCheckout("bitcoin_lightning", enabled)).toBe(true)
    expect(isProviderAvailableForCheckout("stripe", enabled)).toBe(false)
  })

  it("legacy lightning/lightning_nwc provider keys also unlock bitcoin_lightning", () => {
    expect(isProviderAvailableForCheckout("bitcoin_lightning", new Set(["lightning"]))).toBe(true)
    expect(isProviderAvailableForCheckout("bitcoin_lightning", new Set(["lightning_nwc"]))).toBe(true)
  })

  it("Stripe and Speed both connected: each network is independently available, neither implies the other", () => {
    const enabled = new Set(["stripe", SPEED_PROVIDER_NAME])
    expect(isProviderAvailableForCheckout("stripe", enabled)).toBe(true)
    expect(isProviderAvailableForCheckout("bitcoin_lightning", enabled)).toBe(true)
    expect(isProviderAvailableForCheckout("solana", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("base", enabled)).toBe(false)
  })

  it("Stripe and Base both connected: Card and USDC on Base are both available, Stripe never counts toward Base's availability", () => {
    const enabled = new Set(["stripe", "base"])
    expect(isProviderAvailableForCheckout("stripe", enabled)).toBe(true)
    expect(isProviderAvailableForCheckout("base", enabled)).toBe(true)
    expect(isProviderAvailableForCheckout("solana", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("bitcoin_lightning", enabled)).toBe(false)
  })

  it("Shift4 connected: shift4 network is available, does not unlock any crypto rail", () => {
    const enabled = new Set(["shift4"])
    expect(isProviderAvailableForCheckout("shift4", enabled)).toBe(true)
    expect(isProviderAvailableForCheckout("solana", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("base", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("bitcoin_lightning", enabled)).toBe(false)
  })

  it("Dynamic/Fireblocks-style infrastructure connections never make any checkout network available - they aren't in the enabled-provider key space this function checks", () => {
    // Even if "dynamic"/"fireblocks" somehow ended up in the enabled set,
    // no WalletNetwork maps to those keys, so they can never flip a
    // customer-facing payment method on.
    const enabled = new Set(["dynamic", "fireblocks"])
    expect(isProviderAvailableForCheckout("stripe", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("solana", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("base", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("bitcoin_lightning", enabled)).toBe(false)
  })

  it("no providers connected: nothing is available", () => {
    const enabled = new Set<string>()
    expect(isProviderAvailableForCheckout("stripe", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("solana", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("base", enabled)).toBe(false)
    expect(isProviderAvailableForCheckout("bitcoin_lightning", enabled)).toBe(false)
  })
})

describe("cancelPaymentIntentEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("cancels an active payment and expires its intent", async () => {
    vi.mocked(paymentIntentDb.getPaymentIntentById).mockResolvedValue({
      id: "intent-1",
      payment_id: "payment-1",
      status: "SELECTED"
    } as never)
    vi.mocked(paymentIntentDb.getPaymentById).mockResolvedValue({ status: "PENDING" } as never)
    vi.mocked(paymentStateActions.markPaymentIncomplete).mockResolvedValue(true)
    mockNoStoredEvidence()

    await cancelPaymentIntentEngine("intent-1")

    expect(paymentStateActions.markPaymentIncomplete).toHaveBeenCalledWith(
      "payment-1",
      expect.objectContaining({ providerEvent: "terminal_cancel" })
    )
    expect(paymentIntentDb.expirePaymentIntent).toHaveBeenCalledWith("intent-1")
  })

  it.each(["PROCESSING", "FAILED", "CONFIRMED"])(
    "rejects with PaymentAlreadySubmittedError instead of cancelling or expiring a %s payment",
    async (status) => {
      vi.mocked(paymentIntentDb.getPaymentIntentById).mockResolvedValue({
        id: "intent-1",
        payment_id: "payment-1",
        status: "SELECTED"
      } as never)
      vi.mocked(paymentIntentDb.getPaymentById).mockResolvedValue({ status } as never)

      await expect(cancelPaymentIntentEngine("intent-1")).rejects.toBeInstanceOf(
        PaymentAlreadySubmittedError
      )

      expect(paymentStateActions.markPaymentIncomplete).not.toHaveBeenCalled()
      expect(paymentIntentDb.expirePaymentIntent).not.toHaveBeenCalled()
    }
  )

  it("is idempotent for an already expired intent", async () => {
    vi.mocked(paymentIntentDb.getPaymentIntentById).mockResolvedValue({
      id: "intent-1",
      status: "EXPIRED"
    } as never)

    await cancelPaymentIntentEngine("intent-1")

    expect(paymentStateActions.markPaymentIncomplete).not.toHaveBeenCalled()
    expect(paymentIntentDb.expirePaymentIntent).not.toHaveBeenCalled()
  })
})

// ── cancelPaymentIntentEngine — Base pre-cancel chain check ─────────────────
//
// Reproduces the exact live incident: a POS terminal treated a Base
// WalletConnect request as expired and the merchant pressed Cancel while the
// payment was still PENDING (no local evidence yet). Before honouring the
// cancel, a bounded on-chain check must run — if it finds the transaction
// already landed, the cancel must be pre-empted rather than overwriting a
// payment that is (or is about to be) PROCESSING/CONFIRMED.
describe("cancelPaymentIntentEngine — Base pre-cancel chain check", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("pre-empts the cancel when the chain check finds the transaction already landed", async () => {
    vi.mocked(paymentIntentDb.getPaymentIntentById).mockResolvedValue({
      id: "intent-1",
      payment_id: "payment-1",
      status: "SELECTED"
    } as never)
    vi.mocked(paymentIntentDb.getPaymentById).mockResolvedValue({
      status: "PENDING",
      network: "base"
    } as never)
    mockNoStoredEvidence()
    vi.mocked(baseChainReconciliation.reconcileBasePaymentFromChain).mockResolvedValue({
      paymentId: "payment-1",
      attempted: true,
      detected: true,
      previousStatus: "PENDING",
      status: "CONFIRMED",
      reason: "chain_evidence_found"
    })

    await cancelPaymentIntentEngine("intent-1")

    expect(baseChainReconciliation.reconcileBasePaymentFromChain).toHaveBeenCalledWith(
      "payment-1",
      expect.objectContaining({ timeoutMs: expect.any(Number) })
    )
    expect(paymentStateActions.markPaymentIncomplete).not.toHaveBeenCalled()
    expect(paymentIntentDb.expirePaymentIntent).not.toHaveBeenCalled()
  })

  it("proceeds with the normal cancel when the chain check finds no evidence", async () => {
    vi.mocked(paymentIntentDb.getPaymentIntentById).mockResolvedValue({
      id: "intent-1",
      payment_id: "payment-1",
      status: "SELECTED"
    } as never)
    vi.mocked(paymentIntentDb.getPaymentById).mockResolvedValue({
      status: "PENDING",
      network: "base"
    } as never)
    mockNoStoredEvidence()
    vi.mocked(baseChainReconciliation.reconcileBasePaymentFromChain).mockResolvedValue({
      paymentId: "payment-1",
      attempted: true,
      detected: false,
      previousStatus: "PENDING",
      status: "PENDING",
      reason: "no_chain_evidence_in_window"
    })
    vi.mocked(paymentStateActions.markPaymentIncomplete).mockResolvedValue(true)

    await cancelPaymentIntentEngine("intent-1")

    expect(paymentStateActions.markPaymentIncomplete).toHaveBeenCalledWith(
      "payment-1",
      expect.objectContaining({ providerEvent: "terminal_cancel" })
    )
    expect(paymentIntentDb.expirePaymentIntent).toHaveBeenCalledWith("intent-1")
  })

  it("proceeds with the normal cancel when the chain check itself fails (fail-open on infra errors)", async () => {
    vi.mocked(paymentIntentDb.getPaymentIntentById).mockResolvedValue({
      id: "intent-1",
      payment_id: "payment-1",
      status: "SELECTED"
    } as never)
    vi.mocked(paymentIntentDb.getPaymentById).mockResolvedValue({
      status: "PENDING",
      network: "base"
    } as never)
    mockNoStoredEvidence()
    vi.mocked(baseChainReconciliation.reconcileBasePaymentFromChain).mockRejectedValue(
      new Error("RPC unreachable")
    )
    vi.mocked(paymentStateActions.markPaymentIncomplete).mockResolvedValue(true)

    await cancelPaymentIntentEngine("intent-1")

    expect(paymentStateActions.markPaymentIncomplete).toHaveBeenCalled()
    expect(paymentIntentDb.expirePaymentIntent).toHaveBeenCalledWith("intent-1")
  })

  it("never runs the chain pre-check for non-Base networks", async () => {
    vi.mocked(paymentIntentDb.getPaymentIntentById).mockResolvedValue({
      id: "intent-1",
      payment_id: "payment-1",
      status: "SELECTED"
    } as never)
    vi.mocked(paymentIntentDb.getPaymentById).mockResolvedValue({
      status: "PENDING",
      network: "solana"
    } as never)
    mockNoStoredEvidence()
    vi.mocked(paymentStateActions.markPaymentIncomplete).mockResolvedValue(true)

    await cancelPaymentIntentEngine("intent-1")

    expect(baseChainReconciliation.reconcileBasePaymentFromChain).not.toHaveBeenCalled()
    expect(paymentStateActions.markPaymentIncomplete).toHaveBeenCalled()
  })

  it("skips the chain pre-check when the payment is already INCOMPLETE (self-heal owns that recovery path)", async () => {
    vi.mocked(paymentIntentDb.getPaymentIntentById).mockResolvedValue({
      id: "intent-1",
      payment_id: "payment-1",
      status: "SELECTED"
    } as never)
    vi.mocked(paymentIntentDb.getPaymentById).mockResolvedValue({
      status: "INCOMPLETE",
      network: "base"
    } as never)
    vi.mocked(paymentStateActions.markPaymentIncomplete).mockResolvedValue(false)

    await cancelPaymentIntentEngine("intent-1")

    expect(baseChainReconciliation.reconcileBasePaymentFromChain).not.toHaveBeenCalled()
    expect(getTransactionByPaymentId).not.toHaveBeenCalled()
  })
})

// ── cancelPaymentIntentEngine — stored submitted-transaction evidence guard ─
//
// Reproduces the exact live incident: payment 6fd3c713-6f3a-4e5d-bbff-b83e157af1fb.
// The customer's wallet already returned a transaction hash and detect had
// already persisted it (transactions.provider_transaction_id / a
// payment.processing event) while the payment was still PENDING (the watcher
// hadn't yet advanced it). A merchant cancel arriving in that window must be
// rejected outright — this DB-only check runs before any network call, so it
// closes the race even when the live chain pre-check would itself be unable
// to run (e.g. a broken RPC endpoint).
describe("cancelPaymentIntentEngine — stored submitted-transaction evidence guard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects the cancel when a transaction hash is already stored, even though status is still PENDING", async () => {
    vi.mocked(paymentIntentDb.getPaymentIntentById).mockResolvedValue({
      id: "intent-1",
      payment_id: "payment-1",
      status: "SELECTED"
    } as never)
    vi.mocked(paymentIntentDb.getPaymentById).mockResolvedValue({
      status: "PENDING",
      network: "base"
    } as never)
    vi.mocked(getTransactionByPaymentId).mockResolvedValue({
      id: "txn-1",
      provider_transaction_id: "0x670fb79d50e4777bef5ee0f59a925ce123e3f7e5c90d4e3793e9f95c45624428"
    } as never)
    vi.mocked(getPaymentEvents).mockResolvedValue([])

    await expect(cancelPaymentIntentEngine("intent-1")).rejects.toBeInstanceOf(
      PaymentAlreadySubmittedError
    )
    expect(paymentStateActions.markPaymentIncomplete).not.toHaveBeenCalled()
    expect(paymentIntentDb.expirePaymentIntent).not.toHaveBeenCalled()
    // The DB-only check is cheap and runs first — no live chain call needed.
    expect(baseChainReconciliation.reconcileBasePaymentFromChain).not.toHaveBeenCalled()
  })

  it("rejects the cancel when a payment.processing event already exists, even with no stored tx hash yet", async () => {
    vi.mocked(paymentIntentDb.getPaymentIntentById).mockResolvedValue({
      id: "intent-1",
      payment_id: "payment-1",
      status: "SELECTED"
    } as never)
    vi.mocked(paymentIntentDb.getPaymentById).mockResolvedValue({
      status: "PENDING",
      network: "base"
    } as never)
    vi.mocked(getTransactionByPaymentId).mockResolvedValue({
      id: "txn-1",
      provider_transaction_id: null
    } as never)
    vi.mocked(getPaymentEvents).mockResolvedValue([
      { event_type: "payment.processing" }
    ] as never)

    await expect(cancelPaymentIntentEngine("intent-1")).rejects.toBeInstanceOf(
      PaymentAlreadySubmittedError
    )
    expect(paymentStateActions.markPaymentIncomplete).not.toHaveBeenCalled()
  })

  it("proceeds with the normal cancel when there is genuinely no submitted evidence", async () => {
    vi.mocked(paymentIntentDb.getPaymentIntentById).mockResolvedValue({
      id: "intent-1",
      payment_id: "payment-1",
      status: "SELECTED"
    } as never)
    vi.mocked(paymentIntentDb.getPaymentById).mockResolvedValue({
      status: "PENDING",
      network: "solana"
    } as never)
    mockNoStoredEvidence()
    vi.mocked(paymentStateActions.markPaymentIncomplete).mockResolvedValue(true)

    await cancelPaymentIntentEngine("intent-1")

    expect(paymentStateActions.markPaymentIncomplete).toHaveBeenCalled()
    expect(paymentIntentDb.expirePaymentIntent).toHaveBeenCalledWith("intent-1")
  })
})

// ── selectPaymentIntentNetworkEngine — concurrent /select-network races ─────
//
// Reproduces a double-tapped QR link, a stale tab plus a fresh one, or a POS
// refresh racing the phone: two calls for the SAME intent, neither of which
// has seen the other's write yet. An unconditional intent-linking update let
// whichever call finished last silently orphan the other's payment — the
// customer could go on to pay into a payment record checkout polling never
// looks at again. These tests prove the compare-and-set + deterministic
// idempotency key close that gap without breaking the normal single-caller
// path or legitimate later retries.
describe("selectPaymentIntentNetworkEngine — concurrent selection", () => {
  const baseIntent = {
    id: "intent-1",
    merchant_id: "merchant-1",
    amount: 10,
    currency: "USD",
    terminal_id: null,
    metadata: {},
    available_networks: ["base"],
    payment_id: null,
    status: "PENDING" as const,
    expires_at: "2099-01-01T00:00:00.000Z",
  }

  const winnerPayment = {
    id: "winner-payment-1",
    provider: "base",
    status: "PENDING",
    network: "base",
    payment_url: "ethereum:0xsplit@8453?value=1",
    qr_code_url: "data:image/png;base64,winner",
    metadata: { selectedAsset: "ETH", split: {} },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(buildCreatePaymentRequest).mockResolvedValue({
      createPaymentInput: {
        amount: 10,
        currency: "USD",
        merchantId: "merchant-1",
        preferredNetwork: "base",
        metadata: {},
      },
    } as never)
  })

  it("derives a deterministic per-attempt-epoch idempotency key when the caller supplies none", async () => {
    vi.mocked(paymentIntentDb.getPaymentIntentById).mockResolvedValue(baseIntent as never)
    vi.mocked(createPayment).mockResolvedValue({
      id: "payment-1",
      provider: "base",
      paymentUrl: "ethereum:0xsplit@8453?value=1",
      qrCodeUrl: "data:image/png;base64,abc",
      address: "0xsplit",
    } as never)
    vi.mocked(paymentIntentDb.markPaymentIntentSelectedIfUnchanged).mockResolvedValue({
      id: "intent-1",
      payment_id: "payment-1",
    } as never)
    vi.mocked(paymentIntentDb.getPaymentById).mockResolvedValue({
      id: "payment-1",
      status: "PENDING",
      network: "base",
      metadata: { selectedAsset: "ETH" },
    } as never)

    await selectPaymentIntentNetworkEngine({ intentId: "intent-1", network: "base" })

    expect(createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "payment-intent:intent-1:base:ETH:after:initial",
      })
    )
    expect(paymentIntentDb.markPaymentIntentSelectedIfUnchanged).toHaveBeenCalledWith({
      id: "intent-1",
      selected_network: "base",
      payment_id: "payment-1",
      expectedPreviousPaymentId: null,
    })
  })

  it("retires its own payment and returns the winner's when it loses the intent-linking race", async () => {
    vi.mocked(paymentIntentDb.getPaymentIntentById)
      .mockResolvedValueOnce(baseIntent as never) // initial read: nobody linked yet
      .mockResolvedValue({ ...baseIntent, payment_id: "winner-payment-1", status: "SELECTED" } as never) // resolveConcurrentSelectionWinner's read(s)
    vi.mocked(createPayment).mockResolvedValue({
      id: "payment-1",
      provider: "base",
      paymentUrl: "ethereum:0xsplit@8453?value=1",
      qrCodeUrl: "data:image/png;base64,abc",
      address: "0xsplit",
    } as never)
    // Lost the race: some other concurrent call already linked winner-payment-1.
    vi.mocked(paymentIntentDb.markPaymentIntentSelectedIfUnchanged).mockResolvedValue(null)
    vi.mocked(paymentIntentDb.getPaymentById).mockImplementation(async (id: string) => {
      if (id === "winner-payment-1") return winnerPayment as never
      return { id, status: "PENDING", network: "base", metadata: {} } as never
    })
    vi.mocked(paymentStateActions.markPaymentIncomplete).mockResolvedValue(true)

    const result = await selectPaymentIntentNetworkEngine({ intentId: "intent-1", network: "base" })

    // The orphaned payment we created must never be shown as canonical.
    expect(paymentStateActions.markPaymentIncomplete).toHaveBeenCalledWith(
      "payment-1",
      expect.objectContaining({ providerEvent: "concurrent_selection_lost" })
    )
    expect(result).toMatchObject({
      paymentId: "winner-payment-1",
      alreadySelected: true,
    })
  })

  it("recovers from a duplicate-idempotency-key collision at the provider-creation layer by returning the winner's payment", async () => {
    vi.mocked(paymentIntentDb.getPaymentIntentById)
      .mockResolvedValueOnce(baseIntent as never)
      .mockResolvedValue({ ...baseIntent, payment_id: "winner-payment-1", status: "SELECTED" } as never)
    vi.mocked(createPayment).mockRejectedValue(
      new Error("Duplicate idempotency key. Start a new checkout attempt with a unique idempotency key.")
    )
    vi.mocked(paymentIntentDb.getPaymentById).mockResolvedValue(winnerPayment as never)

    const result = await selectPaymentIntentNetworkEngine({ intentId: "intent-1", network: "base" })

    // No payment of our own was ever created, so there is nothing to retire.
    expect(paymentStateActions.markPaymentIncomplete).not.toHaveBeenCalled()
    expect(paymentIntentDb.markPaymentIntentSelectedIfUnchanged).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      paymentId: "winner-payment-1",
      alreadySelected: true,
    })
  })

  it("still reuses an already-linked active payment on a normal (non-racing) repeat call", async () => {
    vi.mocked(paymentIntentDb.getPaymentIntentById).mockResolvedValue({
      ...baseIntent,
      payment_id: "payment-1",
    } as never)
    vi.mocked(paymentIntentDb.getPaymentById).mockResolvedValue({
      id: "payment-1",
      status: "PENDING",
      network: "base",
      metadata: { selectedAsset: "ETH" },
      payment_url: "ethereum:0xsplit@8453?value=1",
      qr_code_url: "data:image/png;base64,abc",
    } as never)

    const result = await selectPaymentIntentNetworkEngine({ intentId: "intent-1", network: "base" })

    expect(createPayment).not.toHaveBeenCalled()
    expect(result).toMatchObject({ paymentId: "payment-1", alreadySelected: true })
  })
})
