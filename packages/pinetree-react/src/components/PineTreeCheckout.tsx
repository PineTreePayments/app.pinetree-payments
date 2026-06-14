"use client"

import { useEffect, useRef } from "react"
import type { CheckoutOpenResult } from "@pinetreepayments/js"
import {
  destroyReactCheckout,
  openReactCheckout,
  usePineTree,
} from "../hooks"
import type { PineTreeCheckoutProps } from "../types"

export function PineTreeCheckout({
  className,
  onStart,
  onOpen,
  onComplete,
  onFailed,
  onExpired,
  onCanceled,
  onClosed,
  onError,
  amount,
  currency,
  reference,
  customer,
  metadata,
  rails,
  successUrl,
  cancelUrl,
}: PineTreeCheckoutProps) {
  const pinetree = usePineTree()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const checkoutRef = useRef<CheckoutOpenResult | null>(null)
  const callbacksRef = useRef({
    onStart,
    onOpen,
    onComplete,
    onFailed,
    onExpired,
    onCanceled,
    onClosed,
    onError,
  })

  useEffect(() => {
    callbacksRef.current = {
      onStart,
      onOpen,
      onComplete,
      onFailed,
      onExpired,
      onCanceled,
      onClosed,
      onError,
    }
  }, [
    onCanceled,
    onClosed,
    onComplete,
    onError,
    onExpired,
    onFailed,
    onOpen,
    onStart,
  ])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    const callbacks = callbacksRef.current

    void openReactCheckout(
      pinetree,
      {
        amount,
        currency,
        reference,
        customer,
        metadata,
        rails,
        successUrl,
        cancelUrl,
        mode: "embedded",
        container,
      },
      {
        onStart: callbacks.onStart,
        onOpen: callbacks.onOpen,
        onComplete: (event) => callbacksRef.current.onComplete?.(event),
        onFailed: (event) => callbacksRef.current.onFailed?.(event),
        onExpired: (event) => callbacksRef.current.onExpired?.(event),
        onCanceled: (event) => callbacksRef.current.onCanceled?.(event),
        onClosed: (event) => callbacksRef.current.onClosed?.(event),
      }
    )
      .then((checkout) => {
        if (disposed) {
          destroyReactCheckout(checkout)
          return
        }
        checkoutRef.current = checkout
      })
      .catch((error) => {
        if (!disposed) callbacksRef.current.onError?.(error)
      })

    return () => {
      disposed = true
      destroyReactCheckout(checkoutRef.current)
      checkoutRef.current = null
    }
  }, [
    amount,
    cancelUrl,
    currency,
    customer,
    metadata,
    pinetree,
    rails,
    reference,
    successUrl,
  ])

  return <div ref={containerRef} className={className} />
}
