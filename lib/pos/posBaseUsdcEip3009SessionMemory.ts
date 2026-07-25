/**
 * Per-payment, session-scoped memory of a *proven* EIP-3009
 * (`eth_signTypedData_v4`) incompatibility on the POS-owned Base USDC flow.
 *
 * Once a signing failure has been strictly classified as `method_unsupported`
 * for a given paymentId (see lib/pos/baseUsdcSigningErrorClassifier.ts), a
 * retry of that SAME payment must not attempt EIP-3009 again — the wallet
 * already conclusively proved it doesn't implement the method. This is
 * intentionally narrow:
 *  - scoped to this browser tab's lifetime only (process-local, like every
 *    other POS WalletConnect state in lib/pos/*), not persisted;
 *  - keyed by paymentId, not by wallet — a different payment (even to the
 *    same wallet) starts with no assumption;
 *  - only ever set from a *conclusive* method_unsupported classification —
 *    never from `unknown`/`timeout`/`transport_error`/etc., which must not
 *    permanently (or even session-) blacklist a wallet based on a result
 *    that might just be transient.
 */

const provenEip3009UnsupportedPaymentIds = new Set<string>()

export function rememberBaseUsdcEip3009MethodUnsupported(paymentId: string): void {
  if (paymentId) provenEip3009UnsupportedPaymentIds.add(paymentId)
}

export function hasProvenBaseUsdcEip3009MethodUnsupported(paymentId: string): boolean {
  return provenEip3009UnsupportedPaymentIds.has(paymentId)
}

export function resetBaseUsdcEip3009SessionMemoryForTests(): void {
  provenEip3009UnsupportedPaymentIds.clear()
}
