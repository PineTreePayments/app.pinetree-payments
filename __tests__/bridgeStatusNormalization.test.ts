/**
 * Bridge (by Stripe) - status, endorsement, and PineTree state normalization.
 *
 * All Bridge identifiers and payloads here are fully fabricated.
 */

import { describe, expect, it } from "vitest"

import {
  BRIDGE_DISPLAY_NAME,
  BRIDGE_PROVIDER_KEY,
  bridgeActionRequiredDetail,
  buildBridgeConnectionState,
  emptyBridgeConnection,
  isBridgeApproved,
  isBridgeBlocked,
  isBridgeKybCleared,
  isBridgeTosAccepted,
  isBridgeUnderReview,
  normalizeBridgeConnection,
  normalizeBridgeEndorsements,
  outstandingBridgeRequirements,
  resolveBridgeProviderState,
} from "@/providers/bridge/normalize"
import {
  PINETREE_PROVIDER_STATE_LABELS,
  PINETREE_PROVIDER_STATES,
  type BridgeCustomer,
  type BridgeKycLink,
} from "@/providers/bridge/types"

const FAKE_CUSTOMER_ID = "cust_44444444-4444-4444-8444-444444444444"
const FAKE_KYC_LINK_ID = "kyc_55555555-5555-4555-8555-555555555555"

function approvedCustomer(overrides: Partial<BridgeCustomer> = {}): BridgeCustomer {
  return {
    id: FAKE_CUSTOMER_ID,
    type: "business",
    status: "active",
    endorsements: [
      { name: "base", status: "approved", requirements: { complete: ["business_details"] } },
    ],
    requirements_due: [],
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-02T00:00:00.000Z",
    ...overrides,
  }
}

function acceptedKycLink(overrides: Partial<BridgeKycLink> = {}): BridgeKycLink {
  return {
    id: FAKE_KYC_LINK_ID,
    type: "business",
    customer_id: FAKE_CUSTOMER_ID,
    kyc_status: "approved",
    tos_status: "approved",
    ...overrides,
  }
}

describe("Bridge customer status normalization", () => {
  it("normalizes every documented customer status", () => {
    for (const status of [
      "not_started",
      "incomplete",
      "awaiting_questionnaire",
      "awaiting_ubo",
      "under_review",
      "active",
      "rejected",
      "paused",
      "offboarded",
    ]) {
      const connection = normalizeBridgeConnection({
        customer: { id: FAKE_CUSTOMER_ID, status },
      })
      expect(connection.customerStatus).toBe(status)
      expect(connection.rawCustomerStatus).toBe(status)
    }
  })

  it("maps an unrecognized provider status to unknown instead of guessing", () => {
    const connection = normalizeBridgeConnection({
      customer: { id: FAKE_CUSTOMER_ID, status: "some_future_bridge_status" },
    })

    expect(connection.customerStatus).toBe("unknown")
    // An unknown status must never count as approval.
    expect(isBridgeKybCleared(connection)).toBe(false)
    expect(isBridgeApproved(connection)).toBe(false)
    // The raw value is retained for diagnostics.
    expect(connection.rawCustomerStatus).toBe("some_future_bridge_status")
  })

  it("treats customer `active` and kyc-link `approved` as the same cleared state", () => {
    const fromCustomer = normalizeBridgeConnection({ customer: approvedCustomer() })
    const fromLink = normalizeBridgeConnection({ kycLink: acceptedKycLink() })

    expect(isBridgeKybCleared(fromCustomer)).toBe(true)
    expect(isBridgeKybCleared(fromLink)).toBe(true)
  })

  it("merges the kyc link and the customer into one connection", () => {
    const connection = normalizeBridgeConnection({
      customer: approvedCustomer(),
      kycLink: acceptedKycLink(),
    })

    expect(connection.customerId).toBe(FAKE_CUSTOMER_ID)
    expect(connection.kycLinkId).toBe(FAKE_KYC_LINK_ID)
    expect(connection.customerType).toBe("business")
    expect(connection.tosStatus).toBe("approved")
    expect(connection.providerCreatedAt).toBe("2026-08-01T00:00:00.000Z")
    expect(connection.providerUpdatedAt).toBe("2026-08-02T00:00:00.000Z")
  })

  it("recognizes rejected, paused, and offboarded as blocked", () => {
    for (const status of ["rejected", "paused", "offboarded"]) {
      const connection = normalizeBridgeConnection({ customer: { id: FAKE_CUSTOMER_ID, status } })
      expect(isBridgeBlocked(connection)).toBe(true)
      expect(isBridgeApproved(connection)).toBe(false)
    }
  })

  it("recognizes under_review without treating it as failure", () => {
    const connection = normalizeBridgeConnection({
      customer: { id: FAKE_CUSTOMER_ID, status: "under_review" },
    })
    expect(isBridgeUnderReview(connection)).toBe(true)
    expect(isBridgeBlocked(connection)).toBe(false)
  })
})

describe("Bridge endorsement normalization", () => {
  it("normalizes endorsement status and requirement identifiers", () => {
    const [endorsement] = normalizeBridgeEndorsements([
      {
        name: "base",
        status: "incomplete",
        requirements: {
          complete: ["terms_of_service"],
          pending: ["id_verification"],
          missing: { all_of: ["proof_of_address", "ownership_details"] },
          issues: ["ubo_mismatch"],
        },
      },
    ])

    expect(endorsement.name).toBe("base")
    expect(endorsement.status).toBe("incomplete")
    expect(endorsement.approved).toBe(false)
    expect(endorsement.missingRequirements).toEqual(["proof_of_address", "ownership_details"])
    expect(endorsement.pendingRequirements).toEqual(["id_verification"])
    expect(endorsement.issues).toEqual(["ubo_mismatch"])
  })

  it("marks only the approved endorsement as approved", () => {
    const endorsements = normalizeBridgeEndorsements([
      { name: "base", status: "approved" },
      { name: "sepa", status: "incomplete" },
    ])

    expect(endorsements.find((entry) => entry.name === "base")?.approved).toBe(true)
    expect(endorsements.find((entry) => entry.name === "sepa")?.approved).toBe(false)
  })

  it("handles a null or missing requirements object", () => {
    const [endorsement] = normalizeBridgeEndorsements([
      { name: "base", status: "approved", requirements: { missing: null } },
    ])
    expect(endorsement.missingRequirements).toEqual([])
  })

  it("maps an unrecognized endorsement status to unknown and never approved", () => {
    const [endorsement] = normalizeBridgeEndorsements([{ name: "base", status: "provisional" }])
    expect(endorsement.status).toBe("unknown")
    expect(endorsement.approved).toBe(false)
  })

  it("requires the base endorsement specifically, not just any approved endorsement", () => {
    const connection = normalizeBridgeConnection({
      customer: approvedCustomer({
        endorsements: [{ name: "sepa", status: "approved" }],
      }),
      kycLink: acceptedKycLink(),
    })

    expect(connection.baseEndorsementApproved).toBe(false)
    // KYB cleared and terms accepted are not enough on their own.
    expect(isBridgeKybCleared(connection)).toBe(true)
    expect(isBridgeTosAccepted(connection)).toBe(true)
    expect(isBridgeApproved(connection)).toBe(false)
  })

  it("collects outstanding requirements across the customer and the base endorsement", () => {
    const connection = normalizeBridgeConnection({
      customer: approvedCustomer({
        status: "incomplete",
        requirements_due: ["external_account"],
        endorsements: [
          {
            name: "base",
            status: "incomplete",
            requirements: { missing: { all_of: ["proof_of_address"] }, issues: ["ubo_mismatch"] },
          },
        ],
      }),
    })

    expect(outstandingBridgeRequirements(connection)).toEqual([
      "external_account",
      "proof_of_address",
      "ubo_mismatch",
    ])
  })
})

describe("PineTree provider state resolution", () => {
  const approved = () =>
    normalizeBridgeConnection({ customer: approvedCustomer(), kycLink: acceptedKycLink() })

  it("uses only PineTree terminology and never the word Available", () => {
    expect(PINETREE_PROVIDER_STATES).toEqual([
      "coming_soon",
      "requested",
      "action_required",
      "connected",
      "enabled",
      "disabled",
    ])
    expect(Object.values(PINETREE_PROVIDER_STATE_LABELS)).toEqual([
      "Coming soon",
      "Requested",
      "Action required",
      "Connected",
      "Enabled",
      "Disabled",
    ])
    expect(Object.values(PINETREE_PROVIDER_STATE_LABELS)).not.toContain("Available")
  })

  it("reports Coming soon when Bridge is not configured for the deployment", () => {
    expect(
      resolveBridgeProviderState({
        configured: false,
        onboardingRequested: true,
        connection: approved(),
        enabled: true,
        enablementDecisionMade: true,
      })
    ).toBe("coming_soon")
  })

  it("reports Requested when the merchant asked for Bridge but no provider object exists", () => {
    expect(
      resolveBridgeProviderState({
        configured: true,
        onboardingRequested: true,
        connection: emptyBridgeConnection(),
        enabled: false,
        enablementDecisionMade: false,
      })
    ).toBe("requested")
  })

  it("reports Action required for incomplete KYB", () => {
    const connection = normalizeBridgeConnection({
      customer: approvedCustomer({ status: "incomplete" }),
      kycLink: acceptedKycLink({ kyc_status: "incomplete" }),
    })

    expect(
      resolveBridgeProviderState({
        configured: true,
        onboardingRequested: true,
        connection,
        enabled: false,
        enablementDecisionMade: false,
      })
    ).toBe("action_required")
  })

  it("reports Action required with an Under review detail while Bridge reviews", () => {
    const connection = normalizeBridgeConnection({
      customer: approvedCustomer({ status: "under_review" }),
      kycLink: acceptedKycLink({ kyc_status: "under_review" }),
    })

    expect(bridgeActionRequiredDetail(connection)?.headline).toBe("Under review")
  })

  it("reports Connected after approval and before the merchant chooses", () => {
    expect(
      resolveBridgeProviderState({
        configured: true,
        onboardingRequested: true,
        connection: approved(),
        enabled: false,
        enablementDecisionMade: false,
      })
    ).toBe("connected")
  })

  it("reports Enabled and Disabled only after an explicit merchant decision", () => {
    expect(
      resolveBridgeProviderState({
        configured: true,
        onboardingRequested: true,
        connection: approved(),
        enabled: true,
        enablementDecisionMade: true,
      })
    ).toBe("enabled")

    expect(
      resolveBridgeProviderState({
        configured: true,
        onboardingRequested: true,
        connection: approved(),
        enabled: false,
        enablementDecisionMade: true,
      })
    ).toBe("disabled")
  })

  it("never reports Enabled for an unapproved connection, even if the flag says so", () => {
    const connection = normalizeBridgeConnection({
      customer: approvedCustomer({ status: "under_review" }),
    })

    const state = resolveBridgeProviderState({
      configured: true,
      onboardingRequested: true,
      connection,
      enabled: true,
      enablementDecisionMade: true,
    })

    expect(state).toBe("action_required")
  })

  it("reports Action required with safe copy for a rejected customer", () => {
    const connection = normalizeBridgeConnection({
      customer: approvedCustomer({ status: "rejected" }),
      kycLink: acceptedKycLink({ kyc_status: "rejected" }),
    })
    const detail = bridgeActionRequiredDetail(connection)

    expect(detail?.headline).toBe("Verification not approved")
    // The merchant-facing copy must not promise timing or echo provider text.
    expect(detail?.detail).not.toMatch(/instant|immediately|guarantee/i)
    expect(detail?.detail).not.toContain("rejected")
  })

  it("distinguishes paused and offboarded with their own safe copy", () => {
    const paused = normalizeBridgeConnection({ customer: approvedCustomer({ status: "paused" }) })
    const offboarded = normalizeBridgeConnection({
      customer: approvedCustomer({ status: "offboarded" }),
    })

    expect(bridgeActionRequiredDetail(paused)?.headline).toBe("Verification paused")
    expect(bridgeActionRequiredDetail(offboarded)?.headline).toBe("Account closed by Bridge")
  })
})

describe("Merchant-facing Bridge connection state", () => {
  it("exposes identifiers-free, PineTree-labeled state", () => {
    const state = buildBridgeConnectionState({
      configured: true,
      environment: "sandbox",
      onboardingRequested: true,
      connection: normalizeBridgeConnection({
        customer: approvedCustomer(),
        kycLink: acceptedKycLink(),
      }),
      enabled: true,
      enablementDecisionMade: true,
      lastSyncedAt: "2026-08-05T12:00:00.000Z",
    })

    expect(state.provider).toBe(BRIDGE_PROVIDER_KEY)
    expect(state.displayName).toBe(BRIDGE_DISPLAY_NAME)
    expect(state.state).toBe("enabled")
    expect(state.stateLabel).toBe("Enabled")
    expect(state.approved).toBe(true)
    expect(state.actionRequired).toBeNull()

    // No Bridge identifier may reach a merchant surface.
    const serialized = JSON.stringify(state)
    expect(serialized).not.toContain(FAKE_CUSTOMER_ID)
    expect(serialized).not.toContain(FAKE_KYC_LINK_ID)
  })

  it("never reports enabled for an unapproved connection", () => {
    const state = buildBridgeConnectionState({
      configured: true,
      environment: "sandbox",
      onboardingRequested: true,
      connection: normalizeBridgeConnection({
        customer: approvedCustomer({ status: "under_review" }),
      }),
      enabled: true,
      enablementDecisionMade: true,
      lastSyncedAt: null,
    })

    expect(state.approved).toBe(false)
    expect(state.enabled).toBe(false)
    expect(state.stateLabel).toBe("Action required")
  })

  it("surfaces the outstanding requirement count without the source documents", () => {
    const state = buildBridgeConnectionState({
      configured: true,
      environment: "production",
      onboardingRequested: true,
      connection: normalizeBridgeConnection({
        customer: approvedCustomer({
          status: "incomplete",
          requirements_due: ["external_account", "proof_of_address"],
        }),
      }),
      enabled: false,
      enablementDecisionMade: false,
      lastSyncedAt: null,
    })

    expect(state.outstandingRequirementCount).toBe(2)
    expect(state.outstandingRequirements).toEqual(["external_account", "proof_of_address"])
  })
})
