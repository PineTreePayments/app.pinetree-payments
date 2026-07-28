/**
 * Resolves a Dynamic-signed withdrawal's transaction evidence as soon as it
 * exists ANYWHERE, instead of depending solely on Dynamic's SDK promise.
 *
 * Root cause this fixes (production incident, 0.38 Solana USDC withdrawal):
 * Dynamic's Solana `signAndSendTransaction` does not hand the signature back
 * when the transaction is broadcast. It routes through the SDK's UI layer
 * (useWalletUiUtils.sendTransaction -> TransactionConfirmationModal), and that
 * modal delivers the response only from its *unmount* handler:
 *
 *     handleOnModalUnmount = () => transactionResponseRef.current
 *       ? onTransactionResponseSuccess(transactionResponseRef.current)  // resolves our await
 *       : onReject(new UserRejectedTransactionError())
 *
 * So the sequence is: submit() broadcasts -> mutation onSuccess stores the
 * response in a ref and calls closeModal() -> the Portal exit transition must
 * complete -> only then does our awaited promise resolve. When that modal
 * keeps spinning (exactly what the merchant observed), the funds have already
 * moved on-chain while the signature is unreachable inside Dynamic's ref.
 *
 * Worse, the previous bounded wait used Promise.race against a timeout, which
 * ABANDONS the underlying promise: when the merchant finally closed the modal
 * and Dynamic did resolve, nothing was listening and the signature was
 * discarded - leaving the 1-2 minute server chain scan as the only path.
 *
 * This module fixes both halves:
 *   1. Evidence race - the SDK promise runs concurrently with bounded
 *      server-side chain discovery, so the first authoritative evidence wins
 *      and the merchant leaves the spinner within seconds of broadcast.
 *   2. Late adoption - the SDK promise is never abandoned. If it resolves
 *      after the race was already decided (e.g. when the merchant closes the
 *      modal), the late signature is still delivered to onLateSignature so it
 *      can be persisted instead of thrown away.
 *
 * This module owns no canonical state: it only produces evidence. Persistence
 * and lifecycle transitions remain the API/Engine's job.
 */

export type DynamicSignatureEvidence = {
  txHash: string
  providerReference?: string
  /** Which path produced the evidence first. */
  source: "sdk" | "discovery"
}

export type DynamicSignatureRaceOptions = {
  /** The in-flight Dynamic SDK signing promise. Never abandoned. */
  signingPromise: Promise<{ txHash?: string; providerReference?: string; signedPsbtBase64?: string }>
  /**
   * Asks the server to look for this withdrawal's transaction on-chain.
   * Returns evidence when found, null otherwise. Must never throw.
   */
  discover: () => Promise<{ txHash?: string | null } | null>
  /** Total time to keep racing before reporting an ambiguous outcome. */
  timeoutMs: number
  /** Delay before the first discovery attempt (broadcast needs a moment). */
  discoveryInitialDelayMs?: number
  /** Interval between discovery attempts. */
  discoveryIntervalMs?: number
  /**
   * Called if the SDK promise resolves with a signature AFTER the race has
   * already been decided or timed out. This is the path that rescues the
   * exact production incident: the merchant closes the stuck modal, Dynamic
   * finally resolves, and the signature still reaches PineTree.
   */
  onLateSignature?: (evidence: DynamicSignatureEvidence) => void
  /** Structured stage logging; never receives secrets. */
  onStage?: (stage: string, details?: Record<string, unknown>) => void
  sleep?: (ms: number) => Promise<void>
}

export type DynamicSignatureRaceResult =
  | { outcome: "evidence"; evidence: DynamicSignatureEvidence }
  | { outcome: "signed_payload"; signedPsbtBase64: string }
  | { outcome: "rejected"; error: unknown }
  | { outcome: "ambiguous"; reason: "timeout_without_evidence" }

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function normalizeHash(value: unknown): string {
  return String(value || "").trim()
}

/**
 * Runs the SDK promise and bounded chain discovery concurrently, returning
 * the first authoritative evidence. Never rejects for timing reasons - an
 * unresolved outcome is reported as "ambiguous" so the caller can show
 * "checking status" rather than inventing a failure.
 */
export async function raceDynamicSignatureEvidence(
  options: DynamicSignatureRaceOptions
): Promise<DynamicSignatureRaceResult> {
  const sleep = options.sleep ?? defaultSleep
  const stage = options.onStage ?? (() => {})
  const startedAt = Date.now()
  let settled = false

  // The SDK promise is attached to exactly once, here. Its result is recorded
  // whenever it arrives - during the race, or long after it - so a late
  // resolution can never be discarded the way Promise.race discarded it.
  let sdkEvidence: DynamicSignatureEvidence | null = null
  let sdkSignedPsbt: string | null = null
  let sdkError: unknown = null
  let sdkDone = false

  const sdkTracked = options.signingPromise.then(
    (result) => {
      sdkDone = true
      const txHash = normalizeHash(result?.txHash)
      if (txHash) {
        sdkEvidence = {
          txHash,
          providerReference: normalizeHash(result?.providerReference) || txHash,
          source: "sdk",
        }
        stage("DYNAMIC_SDK_SIGNATURE_RESOLVED", {
          elapsedMs: Date.now() - startedAt,
          afterRaceSettled: settled,
        })
        if (settled) options.onLateSignature?.(sdkEvidence)
      } else if (normalizeHash(result?.signedPsbtBase64)) {
        sdkSignedPsbt = String(result.signedPsbtBase64)
      }
      return result
    },
    (error) => {
      sdkDone = true
      sdkError = error
      stage("DYNAMIC_SDK_SIGNING_REJECTED", { elapsedMs: Date.now() - startedAt })
      // Swallow here so an unobserved rejection can never become an unhandled
      // promise rejection; the error is surfaced through sdkError below.
      return undefined
    }
  )
  void sdkTracked

  const initialDelay = options.discoveryInitialDelayMs ?? 4000
  const interval = options.discoveryIntervalMs ?? 3000
  let waited = 0

  // Give the SDK a brief head start: the overwhelmingly common case is that
  // Dynamic resolves normally and no discovery call is needed at all.
  while (waited < initialDelay) {
    const step = Math.min(250, initialDelay - waited)
    await sleep(step)
    waited += step
    if (sdkEvidence) {
      settled = true
      return { outcome: "evidence", evidence: sdkEvidence }
    }
    if (sdkError) {
      settled = true
      return { outcome: "rejected", error: sdkError }
    }
    if (sdkDone && sdkSignedPsbt) {
      settled = true
      return { outcome: "signed_payload", signedPsbtBase64: sdkSignedPsbt }
    }
  }

  while (Date.now() - startedAt < options.timeoutMs) {
    if (sdkEvidence) {
      settled = true
      return { outcome: "evidence", evidence: sdkEvidence }
    }
    if (sdkError) {
      settled = true
      return { outcome: "rejected", error: sdkError }
    }
    if (sdkDone && sdkSignedPsbt) {
      settled = true
      return { outcome: "signed_payload", signedPsbtBase64: sdkSignedPsbt }
    }

    stage("DYNAMIC_CHAIN_DISCOVERY_ATTEMPT", { elapsedMs: Date.now() - startedAt })
    let discovered: { txHash?: string | null } | null = null
    try {
      discovered = await options.discover()
    } catch {
      // Discovery is best-effort evidence gathering - a failure here must
      // never end the race or invent an outcome.
      discovered = null
    }
    const discoveredHash = normalizeHash(discovered?.txHash)
    if (discoveredHash) {
      settled = true
      stage("DYNAMIC_CHAIN_DISCOVERY_EVIDENCE_FOUND", { elapsedMs: Date.now() - startedAt })
      return {
        outcome: "evidence",
        evidence: { txHash: discoveredHash, providerReference: discoveredHash, source: "discovery" },
      }
    }

    await sleep(interval)
  }

  // Timed out with no evidence from either path. The transaction may still
  // have been broadcast, so this is explicitly ambiguous - never a failure.
  settled = true
  stage("DYNAMIC_SIGNATURE_RACE_AMBIGUOUS", { elapsedMs: Date.now() - startedAt })
  return { outcome: "ambiguous", reason: "timeout_without_evidence" }
}
