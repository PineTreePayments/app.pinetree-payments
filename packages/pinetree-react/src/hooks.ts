"use client"

import type PineTree from "@pinetreepayments/js"
import type {
  CheckoutEventHandler,
  CheckoutOpenResult,
  CheckoutOptions,
} from "@pinetreepayments/js"
import { usePineTreeContext } from "./provider"
import type { CheckoutLifecycleCallbacks } from "./types"

export type UsePineTreeResult = PineTree

export function usePineTree(): UsePineTreeResult {
  return usePineTreeContext()
}

const EVENT_CALLBACKS = {
  complete: "onComplete",
  failed: "onFailed",
  expired: "onExpired",
  canceled: "onCanceled",
  closed: "onClosed",
} as const

export function wireCheckoutCallbacks(
  checkout: CheckoutOpenResult,
  callbacks: CheckoutLifecycleCallbacks
): () => void {
  const subscriptions: Array<
    [keyof typeof EVENT_CALLBACKS, CheckoutEventHandler]
  > = []

  for (const [event, callbackName] of Object.entries(EVENT_CALLBACKS) as Array<
    [keyof typeof EVENT_CALLBACKS, (typeof EVENT_CALLBACKS)[keyof typeof EVENT_CALLBACKS]]
  >) {
    const callback = callbacks[callbackName]
    if (!callback) continue
    checkout.on(event, callback)
    subscriptions.push([event, callback])
  }

  return () => {
    for (const [event, callback] of subscriptions) {
      checkout.off(event, callback)
    }
  }
}

export async function openReactCheckout(
  client: PineTree,
  options: CheckoutOptions,
  callbacks: CheckoutLifecycleCallbacks
): Promise<CheckoutOpenResult> {
  callbacks.onStart?.()
  const checkout = await client.checkout.open(options)
  wireCheckoutCallbacks(checkout, callbacks)
  callbacks.onOpen?.(checkout)
  return checkout
}

export async function openReactCheckoutWithError(
  client: PineTree,
  options: CheckoutOptions,
  callbacks: CheckoutLifecycleCallbacks
): Promise<CheckoutOpenResult> {
  try {
    return await openReactCheckout(client, options, callbacks)
  } catch (error) {
    callbacks.onError?.(error)
    throw error
  }
}

export function isCheckoutButtonDisabled(
  disabled: boolean | undefined,
  opening: boolean
): boolean {
  return Boolean(disabled || opening)
}

export function destroyReactCheckout(
  checkout: CheckoutOpenResult | null | undefined
): void {
  checkout?.destroy()
}
