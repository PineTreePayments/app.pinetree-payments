"use client"

import type { ReactNode } from "react"

// PineTree standard segmented button (source of truth: Payment Providers page
// "All | Card Providers | Crypto Rails" filter). Every segmented button group
// across the app must reuse these exact classes — do not fork the styling.
// The "compact" size exists only for rows that must fit every option on one
// line without scrolling (e.g. Help Center nav); it changes metrics, never
// colors or states.
export function segmentedButtonClass(active: boolean, size: "default" | "compact" = "default") {
  const metrics = size === "compact" ? "px-2 py-2 text-xs" : "px-3 py-1.5 text-sm"
  return `shrink-0 rounded-lg border ${metrics} transition ${
    active
      ? "border-blue-600 bg-blue-600 font-semibold text-white shadow-sm"
      : "border-blue-200 bg-blue-50/70 font-medium text-blue-700 hover:border-blue-300 hover:bg-blue-100/70 hover:text-blue-600"
  }`
}

export type SegmentedOption<T extends string> = {
  value: T
  label: ReactNode
  disabled?: boolean
}

export function SegmentedButtons<T extends string>({
  options,
  value,
  onChange,
  className = "flex flex-wrap gap-1.5",
  ariaLabel,
}: {
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  onChange: (value: T) => void
  className?: string
  ariaLabel?: string
}) {
  return (
    <div className={className} aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={`${segmentedButtonClass(value === option.value)} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
