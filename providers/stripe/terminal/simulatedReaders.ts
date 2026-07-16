import { StripeClient } from "../client"
import { registerStripeTerminalReader } from "./readers"
import type { StripeTerminalReader } from "./types"

/**
 * Simulated server-driven readers (Stripe test mode only).
 *
 * Stripe registers a simulated WisePOS E when the registration code
 * "simulated-wpe" is used (validated against stripe@22 / current docs).
 * Simulated readers are strictly a test-mode facility — every entry point
 * here fails closed in live mode, and production code paths never call
 * these helpers implicitly.
 */

export const STRIPE_SIMULATED_READER_REGISTRATION_CODE = "simulated-wpe"

export function isStripeTestMode(secretKey?: string): boolean {
  const key = String(secretKey || process.env.STRIPE_SECRET_KEY || "").trim()
  return key.startsWith("sk_test_") || key.startsWith("rk_test_")
}

export function assertStripeTestMode(operation: string): void {
  if (!isStripeTestMode()) {
    throw new Error(`${operation} is only available in Stripe test mode`)
  }
}

export async function registerSimulatedStripeReader(params: {
  connectedAccountId: string
  stripeLocationId: string
  label?: string
}): Promise<StripeTerminalReader> {
  assertStripeTestMode("Simulated reader registration")

  return registerStripeTerminalReader({
    connectedAccountId: params.connectedAccountId,
    registrationCode: STRIPE_SIMULATED_READER_REGISTRATION_CODE,
    stripeLocationId: params.stripeLocationId,
    label: params.label || "PineTree simulated reader"
  })
}

/**
 * Simulates a successful card presentation on a simulated reader
 * (test_helpers API). Deterministic test hook — never valid in live mode.
 */
export async function presentSimulatedCard(params: {
  connectedAccountId: string
  stripeReaderId: string
}): Promise<void> {
  assertStripeTestMode("Simulated card presentation")

  const client = new StripeClient()
  await client.presentTerminalPaymentMethod(params.stripeReaderId, params.connectedAccountId)
}
