/**
 * Centralized Stripe Connect charge-model helper.
 *
 * PineTree's connected accounts are platform-controlled
 * (controller.stripe_dashboard=none, requirement_collection=application,
 * fees.payer=application, losses.payments=application — see ./accounts.ts).
 * That controller configuration supports BOTH direct and destination
 * charges; the commercial decision was intentionally deferred.
 *
 * The default here is DIRECT charges because that is what the existing,
 * live-verified integration already does: every PaymentIntent is created
 * with the `Stripe-Account` header of the merchant's connected account
 * (providers/stripe/payments.ts), and the browser confirms it with
 * `loadStripe(pk, { stripeAccount })`. Terminal objects follow the
 * PaymentIntent owner:
 *
 * | Object                    | direct (default)      | destination (future) |
 * |---------------------------|-----------------------|----------------------|
 * | PaymentIntent             | connected account     | platform account     |
 * | Terminal Location         | connected account     | platform account     |
 * | Terminal Reader           | connected account     | platform account     |
 * | Terminal connection token | connected account     | platform account     |
 * | Application fee           | supported by Stripe   | via transfer_data    |
 *
 * Application fees are supported by Stripe for direct charges, but PineTree
 * does not collect its fee provider-side yet — the computed PineTree fee is
 * preserved in the payment ledger (metadata + pinetree_fee column) and
 * provider-side collection stays behind STRIPE_APPLICATION_FEE_ENABLED
 * until the commercial model is confirmed with Stripe.
 *
 * Every Stripe call site must consume this helper instead of assuming an
 * account context.
 */

export type StripeChargeModel = "direct" | "destination"

export type StripeAccountContext = "connected" | "platform"

export type StripeConnectChargeContext = {
  chargeModel: StripeChargeModel
  /** Which account owns / hosts each object. */
  paymentIntentAccount: StripeAccountContext
  terminalLocationAccount: StripeAccountContext
  terminalReaderAccount: StripeAccountContext
  connectionTokenAccount: StripeAccountContext
  /** Whether Stripe supports an application fee on this path. */
  applicationFeeSupported: boolean
  /** Whether PineTree has enabled provider-side fee collection (config guard). */
  applicationFeeEnabled: boolean
}

export function getStripeChargeModel(): StripeChargeModel {
  const raw = String(process.env.PINE_TREE_STRIPE_CHARGE_MODEL || "").trim().toLowerCase()
  if (raw === "destination") return "destination"
  // Safe default: matches the shipped, live-verified direct-charge behavior.
  return "direct"
}

export function isStripeApplicationFeeEnabled(): boolean {
  return String(process.env.STRIPE_APPLICATION_FEE_ENABLED || "").trim().toLowerCase() === "true"
}

export function resolveStripeConnectChargeContext(): StripeConnectChargeContext {
  const chargeModel = getStripeChargeModel()

  if (chargeModel === "destination") {
    // Destination charges are NOT implemented yet — no call site may take
    // this branch until it is validated against Stripe test mode. The
    // context still describes it so future work has one place to look.
    return {
      chargeModel,
      paymentIntentAccount: "platform",
      terminalLocationAccount: "platform",
      terminalReaderAccount: "platform",
      connectionTokenAccount: "platform",
      applicationFeeSupported: true,
      applicationFeeEnabled: isStripeApplicationFeeEnabled()
    }
  }

  return {
    chargeModel,
    paymentIntentAccount: "connected",
    terminalLocationAccount: "connected",
    terminalReaderAccount: "connected",
    connectionTokenAccount: "connected",
    applicationFeeSupported: true,
    applicationFeeEnabled: isStripeApplicationFeeEnabled()
  }
}

/**
 * Resolves the `Stripe-Account` header value for an API call, given the
 * owning context from resolveStripeConnectChargeContext(). Returns
 * undefined for platform-owned calls (no header).
 */
export function stripeAccountHeaderFor(
  context: StripeAccountContext,
  connectedAccountId: string
): string | undefined {
  if (context === "platform") return undefined
  const accountId = String(connectedAccountId || "").trim()
  if (!accountId) throw new Error("Stripe connected account required for this operation")
  return accountId
}
