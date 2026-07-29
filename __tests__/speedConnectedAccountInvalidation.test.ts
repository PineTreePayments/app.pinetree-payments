import { describe, expect, it } from "vitest"

import {
  describeSpeedApiError,
  isSpeedConnectedAccountMissingError,
  getSafeSpeedCustomerErrorMessage,
  sanitizeSpeedDiagnosticMessage,
  SpeedApiError,
  SpeedTransportError,
} from "@/providers/lightning/speedClient"
import { isSpeedAccountReadyForPayments } from "@/lib/pinetreeRailReadiness"

/** The exact production failure: Speed 400 naming a connected account that no longer exists. */
function connectedAccountMissingError() {
  return new SpeedApiError(
    "Speed API returned 400",
    400,
    "invalid_request_error",
    [{ field: null, message: "Connected account could not be found - acct_mrl2trjxxAUdYqgm" }],
    null,
    "Oyg7L4LFsiV1hHV5H31"
  )
}

describe("Speed provider error propagation", () => {
  it("preserves status, provider code, message, request id, and retry classification", () => {
    const described = describeSpeedApiError(connectedAccountMissingError())

    expect(described).toMatchObject({
      provider: "speed",
      httpStatus: 400,
      providerCode: "invalid_request_error",
      providerMessage: "Connected account could not be found - acct_mrl2trjxxAUdYqgm",
      requestId: "Oyg7L4LFsiV1hHV5H31",
      retryClassification: "permanent_no_retry",
      connectedAccountMissing: true,
    })
  })

  it("classifies a retryable Speed failure as transient rather than permanent", () => {
    const described = describeSpeedApiError(
      new SpeedApiError("Speed API returned 503", 503, "service_unavailable", [])
    )
    expect(described).toMatchObject({
      retryClassification: "transient_retryable",
      connectedAccountMissing: false,
    })
    expect(describeSpeedApiError(new SpeedTransportError("socket hang up", true, false)))
      .toMatchObject({ retryClassification: "transient_retryable" })
  })

  it("never leaks credentials or authorization values into diagnostics", () => {
    const leaky = new SpeedApiError(
      "Speed API returned 400",
      400,
      "invalid_request_error",
      [{ field: null, message: "Authorization: Bearer sk_live_abc123def456 was rejected" }]
    )
    const described = describeSpeedApiError(leaky)
    const serialized = JSON.stringify(described)

    expect(serialized).not.toContain("sk_live_abc123def456")
    expect(serialized).not.toContain("Bearer")
    expect(described?.providerMessage).toBe("[redacted provider message]")

    expect(sanitizeSpeedDiagnosticMessage("api_key=pk_live_zzz")).toBe("[redacted provider message]")
    expect(sanitizeSpeedDiagnosticMessage("plain provider message")).toBe("plain provider message")
  })

  it("bounds diagnostic length so a large provider body cannot flood logs", () => {
    const long = sanitizeSpeedDiagnosticMessage("x".repeat(500))
    expect(long).not.toBeNull()
    expect((long as string).length).toBeLessThanOrEqual(160)
  })

  it("keeps the customer message safe and free of internal account ids", () => {
    const message = getSafeSpeedCustomerErrorMessage(connectedAccountMissingError())
    expect(message).toBe(
      "Bitcoin Lightning isn't available for this merchant right now. Please choose another payment method."
    )
    expect(message).not.toContain("acct_")
  })
})

describe("Speed connected-account-missing classification", () => {
  it("recognizes the permanent connected-account failure", () => {
    expect(isSpeedConnectedAccountMissingError(connectedAccountMissingError())).toBe(true)
    expect(connectedAccountMissingError().retryable).toBe(false)
  })

  it("does not misclassify unrelated Speed 400s as an account problem", () => {
    const unrelated = new SpeedApiError(
      "Speed API returned 400",
      400,
      "invalid_request_error",
      [{ field: "amount", message: "Amount must be greater than zero" }]
    )
    expect(isSpeedConnectedAccountMissingError(unrelated)).toBe(false)
    expect(describeSpeedApiError(unrelated)).toMatchObject({ connectedAccountMissing: false })
  })

  it("does not treat transport failures or non-400 statuses as an account problem", () => {
    expect(isSpeedConnectedAccountMissingError(new SpeedTransportError("timeout", true, true))).toBe(false)
    expect(isSpeedConnectedAccountMissingError(
      new SpeedApiError("Speed API returned 500", 500, "server_error", [])
    )).toBe(false)
    expect(isSpeedConnectedAccountMissingError(new Error("Connected account could not be found"))).toBe(false)
  })
})

describe("Speed readiness after a permanent connected-account failure", () => {
  const staleCredentials = {
    credentialAccountId: "acct_mrl2trjxxAUdYqgm",
    credentialSetupStatus: "ready_for_payments",
  }

  it("offers Lightning while the profile is ready", () => {
    expect(isSpeedAccountReadyForPayments({ profileStatus: "ready", ...staleCredentials })).toBe(true)
  })

  it("stops offering Lightning once the profile needs attention, despite stale ready credentials", () => {
    expect(isSpeedAccountReadyForPayments({ profileStatus: "needs_attention", ...staleCredentials })).toBe(false)
  })

  it("is idempotent: repeating the permanent failure keeps the same not-ready answer", () => {
    const first = isSpeedAccountReadyForPayments({ profileStatus: "needs_attention", ...staleCredentials })
    const second = isSpeedAccountReadyForPayments({ profileStatus: "needs_attention", ...staleCredentials })
    expect(first).toBe(second)
    expect(second).toBe(false)
  })

  it("still honors the legacy credentials fallback for merchants without a ready profile", () => {
    expect(isSpeedAccountReadyForPayments({ profileStatus: null, ...staleCredentials })).toBe(true)
    expect(isSpeedAccountReadyForPayments({ profileStatus: "pending", ...staleCredentials })).toBe(true)
    expect(isSpeedAccountReadyForPayments({
      profileStatus: "pending",
      credentialAccountId: "",
      credentialSetupStatus: "ready_for_payments",
    })).toBe(false)
  })
})
