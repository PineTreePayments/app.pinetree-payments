"use client"

import type { ReactNode } from "react"

// PineTree standard primary action button (solid PineTree-blue, content-sized).
// Every dashboard "do the thing" button — Add Item, Save Settings, Create
// Terminal, Review Withdrawal, Generate API Key, … — must use this styling so
// the actions share one design language. Do not fork these classes.
//
// Not for: intentionally full-width actions (Cancel Sale, Complete Checkout,
// final/destructive confirmations), POS payment surfaces, or customer-facing
// payment pages — those keep their dedicated styling (components/ui/Button).
export const primaryActionButtonClass =
  "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#003FCC] hover:shadow-md active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"

export function PrimaryActionButton({
  children,
  onClick,
  type = "button",
  disabled = false,
  className = "",
  ariaLabel,
}: {
  children: ReactNode
  onClick?: React.MouseEventHandler<HTMLButtonElement>
  type?: "button" | "submit" | "reset"
  disabled?: boolean
  className?: string
  ariaLabel?: string
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      className={`${primaryActionButtonClass} ${className}`}
    >
      {children}
    </button>
  )
}
