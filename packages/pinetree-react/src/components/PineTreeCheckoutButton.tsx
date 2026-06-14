"use client"

import { useEffect, useRef, useState } from "react"
import type { CheckoutOpenResult } from "@pinetreepayments/js"
import {
  destroyReactCheckout,
  isCheckoutButtonDisabled,
  openReactCheckoutWithError,
  usePineTree,
} from "../hooks"
import type { PineTreeCheckoutButtonProps } from "../types"

export function PineTreeCheckoutButton({
  children = "Pay with PineTree",
  disabled,
  className,
  type = "button",
  onStart,
  onOpen,
  onComplete,
  onFailed,
  onExpired,
  onCanceled,
  onClosed,
  onError,
  ...options
}: PineTreeCheckoutButtonProps) {
  const pinetree = usePineTree()
  const [opening, setOpening] = useState(false)
  const checkoutRef = useRef<CheckoutOpenResult | null>(null)

  useEffect(() => {
    return () => destroyReactCheckout(checkoutRef.current)
  }, [])

  async function handleClick() {
    if (disabled || opening) return
    setOpening(true)
    try {
      destroyReactCheckout(checkoutRef.current)
      checkoutRef.current = await openReactCheckoutWithError(pinetree, options, {
        onStart,
        onOpen,
        onComplete,
        onFailed,
        onExpired,
        onCanceled,
        onClosed,
        onError,
      })
    } catch {
      // The typed onError callback receives the original failure.
    } finally {
      setOpening(false)
    }
  }

  return (
    <button
      type={type}
      className={className}
      disabled={isCheckoutButtonDisabled(disabled, opening)}
      aria-busy={opening}
      onClick={() => void handleClick()}
    >
      {children}
    </button>
  )
}
