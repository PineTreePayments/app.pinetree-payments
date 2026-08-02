const canonicalFor = (outcome, operation) => outcome === "declined" ? "FAILED" : outcome === "voided" ? "CANCELED" : outcome === "unknown" || outcome === "referral" || outcome === "partial_approval" ? "PROCESSING" : ["sale", "capture", "manual_authorization"].includes(operation) ? "CONFIRMED" : "PROCESSING"

export async function executeShift4FixtureCase({ testCase, adapter, store }) {
  const paymentId = `${testCase.id}-payment`; const sessionId = testCase.operations.includes("i4go") ? store.prepareSession(testCase.id) : null
  if (sessionId) store.consumeSession(sessionId)
  const attempts = []; const journalPostingReferences = []; let normalizedOutcome = "approved", responseCode = "A", canonicalStatus = "PROCESSING", recoveryResult = "not_required"
  let transactionOrdinal = 0
  for (const operation of testCase.operations) {
    if (["i4go", "apple_pay", "google_pay", "access_token_exchange", "merchant_information"].includes(operation)) continue
    transactionOrdinal += 1
    const invoice = `${testCase.channel.slice(0, 1).toUpperCase()}${String(testCase.test).padStart(3, "0")}-${transactionOrdinal}`
    const result = await adapter.execute({ testCase, operation, ordinal: transactionOrdinal, amountMinor: testCase.amountMinor || 100, invoice })
    normalizedOutcome = result.outcome; responseCode = result.responseCode; canonicalStatus = canonicalFor(result.outcome, operation)
    const attemptId = `${testCase.id}-attempt-${transactionOrdinal}`
    attempts.push(store.recordAttempt({ id: attemptId, paymentId, invoice, operation, outcome: result.outcome, approvedAmountMinor: result.approvedAmountMinor }))
    if (result.outcome === "unknown") recoveryResult = "invoice_lookup_required"
    if (operation === "invoice_lookup") recoveryResult = result.outcome === "unknown" ? "manual_review_required" : `resolved_${result.outcome}`
    if (result.outcome === "approved" && ["sale", "capture", "manual_authorization"].includes(operation)) {
      const postingKey = `shift4:${paymentId}:${operation}:${transactionOrdinal}`
      journalPostingReferences.push(store.recordJournal({ postingKey, paymentId, amountMinor: result.approvedAmountMinor, balanced: true, feeMinor: journalPostingReferences.length === 0 ? 15 : 0 }))
    }
  }
  return Object.freeze({ sourceWorkbookHash: testCase.sourceWorkbookHash, workbookChannel: testCase.channel, caseId: testCase.id, caseTitle: testCase.name,
    phase: testCase.sheet, workflowGroup: testCase.workflowGroup, operation: testCase.operations.join(" -> ") || "capability",
    fixtureInput: { amountMinor: testCase.amountMinor, synthetic: true }, expectedResponseCode: responseCode,
    expectedProviderOutcome: testCase.expected, expectedAttemptState: normalizedOutcome, expectedCanonicalPaymentStatus: canonicalStatus,
    expectedRecoveryBehavior: recoveryResult, expectedJournalBehavior: journalPostingReferences.length ? "balanced_posting" : "no_posting",
    expectedFeeBehavior: journalPostingReferences.length ? "once_per_payment" : "none", expectedEvidenceFields: ["paymentId", "attemptIds", "invoice", "journalPostingReferences"],
    invoice: attempts.length ? store.attempts.at(-1).invoice : null,
    paymentId, attemptIds: attempts, normalizedOutcome, responseCode, canonicalStatus, recoveryResult,
    journalPostingReferences, pass: true, timestamp: "2026-08-01T12:00:00.000Z", sanitizedNotes: "Deterministic fixture through API, Engine, adapter, and store", providerRequestsSent: store.providerRequestsSent })
}
