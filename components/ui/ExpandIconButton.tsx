"use client"

import { Maximize } from "lucide-react"

// PineTree standard "expand chart to full view" control — the collapsed-state
// counterpart to modalCloseButtonClass (components/ui/ModalCloseButton.tsx).
// Four-corner fullscreen bracket icon, top-right of the card header, aligned
// with the title. Use on every analytics/chart card — do not fork a text
// "Expand" button.
export const expandIconButtonClass =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 shadow-sm transition hover:border-blue-200 hover:text-[#0052FF] focus:outline-none focus:ring-4 focus:ring-blue-100"

export function ExpandIconButton({
  onClick,
  className = "",
  ariaLabel = "Expand chart"
}: {
  onClick?: React.MouseEventHandler<HTMLButtonElement>
  className?: string
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`${expandIconButtonClass} ${className}`}
    >
      <Maximize size={15} aria-hidden="true" />
    </button>
  )
}
