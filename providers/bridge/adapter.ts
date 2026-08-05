/**
 * Bridge (by Stripe) Provider Adapter
 *
 * Implements the universal PineTree provider-connector contract for Bridge.
 *
 * ARCHITECTURE: this adapter communicates with the Bridge API and normalizes
 * its vocabulary. It performs NO database writes and holds NO business logic -
 * PineTree Engine (engine/bridgeConnect.ts) owns persistence and state
 * transitions, exactly as the architecture requires.
 *
 * Bridge is NOT Stripe. A merchant with a Stripe connected account is not
 * approved by Bridge, and the two connections are kept separate for that
 * reason: separate credentials, customer identifiers, capabilities, KYB state,
 * webhooks, and operational behavior.
 *
 * PAYMENTS ARE NOT ENABLED IN THIS PHASE. `createPayment` and
 * `getPaymentStatus` are present as explicit not-yet-enabled functions so the
 * boundary is visible, and they fail closed rather than pretending to work.
 */

import { BaseProviderAdapter } from "../BaseAdapter"
import { registerProvider } from "../registry"
import type { PaymentStatus, ProviderAdapterMetadata } from "@/types/provider"

import { describeBridgeConfiguration, getBridgeConfig, isBridgeConfigured } from "./config"
import {
  createKycLink,
  getMerchantStatus as fetchBridgeMerchantStatus,
  syncCustomerStatus,
  type BridgeRequestContext,
} from "./client"
import { bridgeOnboardingIdempotencyKey } from "./idempotency"
import {
  BRIDGE_DISPLAY_NAME,
  BRIDGE_PROVIDER_KEY,
  BRIDGE_REQUIRED_ENDORSEMENT,
  emptyBridgeConnection,
  normalizeBridgeConnection,
} from "./normalize"
import { translateBridgeEvent, type NormalizedBridgeConnectionEvent } from "./translateEvent"
import type { NormalizedBridgeConnection } from "./types"
import { verifyBridgeWebhookSignature, BRIDGE_SIGNATURE_HEADER } from "./verifyWebhook"

export type BridgeConnectMerchantInput = {
  merchantId: string
  /** The merchant's full LEGAL business name, per Bridge's business contract. */
  legalBusinessName: string
  /** The authorized account owner's email address. */
  ownerEmail: string
  /** Overrides the configured redirect only in tests. */
  redirectUri?: string
  context?: BridgeRequestContext
  fetchImpl?: typeof fetch
}

export type BridgeConnectMerchantResult = {
  kycLinkId: string
  customerId: string | null
  /** Single-use hosted URLs returned straight to the requesting merchant. */
  kycUrl: string | null
  tosUrl: string | null
  connection: NormalizedBridgeConnection
  correlationId: string
}

class BridgeAdapter extends BaseProviderAdapter {
  readonly providerId = BRIDGE_PROVIDER_KEY
  readonly providerName = BRIDGE_DISPLAY_NAME

  /**
   * Bridge is a settlement/conversion provider, not a payment network, and it
   * creates no payments in this phase. An empty network list keeps it out of
   * every payment-routing selection by construction.
   */
  readonly supportedNetworks: string[] = []

  override get metadata(): ProviderAdapterMetadata {
    return {
      adapterId: this.providerId,
      displayName: this.providerName,
      supportedNetworks: [],
      capabilities: {
        hostedCheckout: false,
        walletRails: false,
        webhooks: true,
        supportsWebhookConfirmation: true,
        requiresKyc: true,
        custodyModel: "provider",
      },
    }
  }

  /** Whether this deployment can talk to Bridge at all. */
  isConfigured(): boolean {
    return isBridgeConfigured()
  }

  describeConfiguration() {
    return describeBridgeConfiguration()
  }

  /**
   * Begin Bridge onboarding for a merchant by creating (or, thanks to the
   * deterministic idempotency key, re-fetching) the hosted KYC/KYB link.
   *
   * The idempotency key is derived from the merchant id plus the onboarding
   * version, so restarting onboarding NEVER creates a second Bridge customer.
   */
  async connectMerchant(input: BridgeConnectMerchantInput): Promise<BridgeConnectMerchantResult> {
    const config = getBridgeConfig()
    const idempotencyKey = bridgeOnboardingIdempotencyKey({ merchantId: input.merchantId })

    const result = await createKycLink({
      fullName: input.legalBusinessName,
      email: input.ownerEmail,
      type: "business",
      endorsements: [BRIDGE_REQUIRED_ENDORSEMENT],
      redirectUri: input.redirectUri ?? config.kycRedirectUrl,
      idempotencyKey,
      context: { ...input.context, merchantId: input.merchantId },
      config,
      fetchImpl: input.fetchImpl,
    })

    const kycLink = result.data

    return {
      kycLinkId: String(kycLink.id),
      customerId: String(kycLink.customer_id || "").trim() || null,
      kycUrl: String(kycLink.kyc_link || "").trim() || null,
      tosUrl: String(kycLink.tos_link || "").trim() || null,
      connection: normalizeBridgeConnection({ kycLink }),
      correlationId: result.correlationId,
    }
  }

  /**
   * Read the merchant's normalized Bridge state directly from Bridge.
   * Returns an empty connection when no Bridge object exists yet.
   */
  async getMerchantStatus(input: {
    customerId?: string | null
    kycLinkId?: string | null
    context?: BridgeRequestContext
    fetchImpl?: typeof fetch
  }): Promise<NormalizedBridgeConnection> {
    if (!input.customerId && !input.kycLinkId) return emptyBridgeConnection()
    return fetchBridgeMerchantStatus(input)
  }

  /**
   * Re-read every Bridge object PineTree knows about for this merchant and
   * return the merged normalized state. The Engine persists the result; this
   * adapter never writes.
   */
  async syncAccount(input: {
    customerId?: string | null
    kycLinkId?: string | null
    context?: BridgeRequestContext
    fetchImpl?: typeof fetch
  }): Promise<{ connection: NormalizedBridgeConnection; correlationId: string }> {
    if (!input.customerId && !input.kycLinkId) {
      return {
        connection: emptyBridgeConnection(),
        correlationId: input.context?.correlationId || "",
      }
    }
    return syncCustomerStatus(input)
  }

  /**
   * Verify a Bridge webhook delivery against the raw request body.
   *
   * The universal contract passes the parsed payload first; Bridge signs the
   * RAW bytes, so verification uses `rawBody` and the parsed payload is
   * ignored on purpose.
   */
  override verifyWebhook(
    payload: unknown,
    signature?: string,
    rawBody?: string,
    headers?: Record<string, string>
  ): boolean {
    void payload
    const signatureHeader =
      signature ||
      headers?.[BRIDGE_SIGNATURE_HEADER] ||
      headers?.["X-Webhook-Signature"] ||
      null

    const result = verifyBridgeWebhookSignature({
      rawBody: rawBody ?? "",
      signatureHeader,
    })

    if (!result.valid) {
      console.warn("[bridge] webhook_verification_failed", { reason: result.reason })
      return false
    }
    return true
  }

  /**
   * The universal payment-event translator.
   *
   * Bridge emits no payment events in this phase, so this always returns null:
   * per the provider contract, an adapter must return null for a value it does
   * not recognize and must never guess a payment state. Bridge CONNECTION
   * events are translated by `translateProviderEvent` below, which feeds the
   * provider-connection pipeline rather than the payment state machine.
   */
  override translateEvent(payload: unknown): ReturnType<BaseProviderAdapter["translateEvent"]> {
    void payload
    return null
  }

  /** Translate a verified Bridge customer/kyc_link event. */
  translateProviderEvent(payload: unknown): NormalizedBridgeConnectionEvent | null {
    return translateBridgeEvent(payload)
  }

  // ── Not enabled in this phase ──────────────────────────────────────────────

  /**
   * Bridge payment creation is intentionally not implemented yet. It fails
   * closed so nothing can route a live payment to Bridge before the payment
   * contract, fee capture, and settlement model are implemented.
   */
  override async createPayment(): Promise<never> {
    throw new Error("Bridge payment creation is not enabled yet.")
  }

  override async getPaymentStatus(providerReference: string): Promise<{ status: PaymentStatus | null }> {
    void providerReference
    // Null retains the payment's current canonical state instead of inventing
    // one, which is what the provider contract requires for an unknown value.
    return { status: null }
  }

  /**
   * Health reflects configuration only. It performs no network call, so a
   * dashboard read can never be slowed down or made to depend on Bridge
   * availability.
   */
  override async healthCheck(): Promise<boolean> {
    return this.isConfigured()
  }
}

const adapter = new BridgeAdapter()
registerProvider(adapter.providerId, adapter)

export { BridgeAdapter }
export const bridgeAdapter = adapter
export default adapter
