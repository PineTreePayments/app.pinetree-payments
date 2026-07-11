// Bounds a single third-party provider call (e.g. Dynamic's createWalletAccount) with a
// PineTree-side deadline, without pretending the underlying call can always be
// cancelled. Dynamic's WaaS SDK does not document AbortSignal support for
// createWalletAccount, so `result` racing a timeout against the real call is what
// actually protects refreshDynamicWalletRuntimeImpl from awaiting indefinitely; the
// AbortController is still created and aborted for forward-compatibility in case a
// future SDK version honors it, but callers must not assume the underlying call
// actually stops - `settlement` is the same call, uncancelled, for late-arrival
// handling once the timeout has already been surfaced to the caller.
export type BoundedProviderCallSettlement<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown }

export type BoundedProviderCallResult<T> = BoundedProviderCallSettlement<T> | { status: "timeout" }

export type BoundedProviderCall<T> = {
  // Resolves with the first of (operation settling, timeout elapsing). Await this.
  result: Promise<BoundedProviderCallResult<T>>
  // The same underlying operation, independent of the race - always eventually settles
  // (assuming the provider call itself isn't hung forever). Attach a .then/.catch here
  // to handle a call that kept running in the background after a timeout was already
  // reported to the original caller.
  settlement: Promise<BoundedProviderCallSettlement<T>>
}

export function runWithBoundedTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): BoundedProviderCall<T> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null
  const settlement: Promise<BoundedProviderCallSettlement<T>> = operation(controller?.signal as AbortSignal).then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason) => ({ status: "rejected" as const, reason })
  )
  const timeout = new Promise<BoundedProviderCallResult<T>>((resolve) => {
    setTimeout(() => {
      controller?.abort()
      resolve({ status: "timeout" })
    }, timeoutMs)
  })
  const result = Promise.race<BoundedProviderCallResult<T>>([settlement, timeout])
  return { result, settlement }
}
