import { describe, expect, it, vi } from "vitest"
import { raceDynamicSignatureEvidence } from "@/lib/wallets/dynamicSignatureRace"

/**
 * Production incident reproduced here (0.38 Solana USDC withdrawal):
 * Dynamic broadcast the transaction, the funds arrived, but the SDK's
 * TransactionConfirmationModal only delivers the signature from its UNMOUNT
 * handler - so while the modal kept spinning, the awaited promise never
 * resolved. The old bounded wait used Promise.race, which abandoned that
 * promise entirely: when the merchant finally closed the modal and Dynamic
 * did resolve, nothing was listening and the signature was thrown away.
 *
 * These tests pin both halves of the fix: chain discovery wins the race when
 * the SDK stalls, and a late SDK resolution is still delivered instead of
 * being discarded.
 */

// Immediate sleep so the race's timing logic is exercised without real delays.
const instantSleep = () => Promise.resolve()

function neverResolves<T>(): Promise<T> {
  return new Promise<T>(() => {})
}

describe("raceDynamicSignatureEvidence", () => {
  it("returns SDK evidence immediately when Dynamic resolves normally", async () => {
    const result = await raceDynamicSignatureEvidence({
      signingPromise: Promise.resolve({ txHash: "sig-normal", providerReference: "sig-normal" }),
      discover: vi.fn().mockResolvedValue(null),
      timeoutMs: 30_000,
      sleep: instantSleep,
    })
    expect(result).toEqual({
      outcome: "evidence",
      evidence: { txHash: "sig-normal", providerReference: "sig-normal", source: "sdk" },
    })
  })

  it("does not call discovery at all when the SDK resolves during the head start", async () => {
    const discover = vi.fn().mockResolvedValue(null)
    await raceDynamicSignatureEvidence({
      signingPromise: Promise.resolve({ txHash: "sig-fast" }),
      discover,
      timeoutMs: 30_000,
      sleep: instantSleep,
    })
    expect(discover).not.toHaveBeenCalled()
  })

  it("THE INCIDENT: chain discovery wins when the Dynamic modal never unmounts", async () => {
    const discover = vi
      .fn()
      .mockResolvedValueOnce({ txHash: null })
      .mockResolvedValueOnce({ txHash: "5SXeL6zVdiscovered" })
    const result = await raceDynamicSignatureEvidence({
      signingPromise: neverResolves(),
      discover,
      timeoutMs: 30_000,
      sleep: instantSleep,
    })
    expect(result).toEqual({
      outcome: "evidence",
      evidence: {
        txHash: "5SXeL6zVdiscovered",
        providerReference: "5SXeL6zVdiscovered",
        source: "discovery",
      },
    })
    expect(discover).toHaveBeenCalledTimes(2)
  })

  it("THE REGRESSION: a late SDK signature is delivered, never discarded", async () => {
    let resolveSigning: (value: { txHash: string }) => void = () => {}
    const signingPromise = new Promise<{ txHash: string }>((resolve) => {
      resolveSigning = resolve
    })
    const onLateSignature = vi.fn()

    // Race decides via discovery first (SDK still stuck behind the modal).
    const result = await raceDynamicSignatureEvidence({
      signingPromise,
      discover: vi.fn().mockResolvedValue({ txHash: "discovered-first" }),
      timeoutMs: 30_000,
      sleep: instantSleep,
      onLateSignature,
    })
    expect(result.outcome).toBe("evidence")

    // The merchant now closes the stuck modal -> Dynamic finally resolves.
    resolveSigning({ txHash: "late-signature-from-modal-close" })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onLateSignature).toHaveBeenCalledTimes(1)
    expect(onLateSignature).toHaveBeenCalledWith({
      txHash: "late-signature-from-modal-close",
      providerReference: "late-signature-from-modal-close",
      source: "sdk",
    })
  })

  it("delivers a late signature even after an ambiguous timeout", async () => {
    let resolveSigning: (value: { txHash: string }) => void = () => {}
    const signingPromise = new Promise<{ txHash: string }>((resolve) => {
      resolveSigning = resolve
    })
    const onLateSignature = vi.fn()

    const result = await raceDynamicSignatureEvidence({
      signingPromise,
      discover: vi.fn().mockResolvedValue(null),
      timeoutMs: 1, // expires immediately with no evidence
      sleep: instantSleep,
      onLateSignature,
    })
    expect(result).toEqual({ outcome: "ambiguous", reason: "timeout_without_evidence" })

    resolveSigning({ txHash: "late-after-timeout" })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onLateSignature).toHaveBeenCalledWith(
      expect.objectContaining({ txHash: "late-after-timeout", source: "sdk" })
    )
  })

  it("surfaces a genuine wallet rejection as rejected, never ambiguous", async () => {
    const error = Object.assign(new Error("User rejected"), { code: "DYNAMIC_SIGNING_REJECTED" })
    const result = await raceDynamicSignatureEvidence({
      signingPromise: Promise.reject(error),
      discover: vi.fn().mockResolvedValue(null),
      timeoutMs: 30_000,
      sleep: instantSleep,
    })
    expect(result).toEqual({ outcome: "rejected", error })
  })

  it("reports ambiguous - never failure - when nothing produces evidence", async () => {
    const result = await raceDynamicSignatureEvidence({
      signingPromise: neverResolves(),
      discover: vi.fn().mockResolvedValue(null),
      timeoutMs: 1,
      sleep: instantSleep,
    })
    expect(result).toEqual({ outcome: "ambiguous", reason: "timeout_without_evidence" })
  })

  it("a discovery failure never ends the race or invents an outcome", async () => {
    const discover = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ txHash: "found-after-transient-failure" })
    const result = await raceDynamicSignatureEvidence({
      signingPromise: neverResolves(),
      discover,
      timeoutMs: 30_000,
      sleep: instantSleep,
    })
    expect(result).toEqual({
      outcome: "evidence",
      evidence: {
        txHash: "found-after-transient-failure",
        providerReference: "found-after-transient-failure",
        source: "discovery",
      },
    })
  })

  it("returns the signed PSBT path unchanged (Bitcoin legacy flow)", async () => {
    const result = await raceDynamicSignatureEvidence({
      signingPromise: Promise.resolve({ signedPsbtBase64: "cHNidP8=" }),
      discover: vi.fn().mockResolvedValue(null),
      timeoutMs: 30_000,
      sleep: instantSleep,
    })
    expect(result).toEqual({ outcome: "signed_payload", signedPsbtBase64: "cHNidP8=" })
  })
})
