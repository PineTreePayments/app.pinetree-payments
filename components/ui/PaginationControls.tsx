"use client"

import type { ReactNode } from "react"

export const paginationControlClass =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-lg border border-blue-200 bg-blue-50/80 px-2 text-xs font-semibold text-[#0052FF] shadow-sm transition hover:border-blue-300 hover:bg-blue-100/80 focus:outline-none focus:ring-4 focus:ring-blue-50 disabled:cursor-not-allowed disabled:border-blue-100 disabled:bg-blue-50/30 disabled:text-blue-300 disabled:opacity-60 disabled:shadow-none sm:gap-1.5 sm:px-3 sm:text-sm"

export const paginationIndicatorClass =
  "inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-blue-50/80 px-2 text-xs font-semibold text-gray-700 shadow-sm sm:px-3 sm:text-sm"

export const paginationSelectClass =
  "h-9 min-w-0 shrink appearance-none rounded-lg border border-blue-200 bg-blue-50/80 pl-2 pr-6 text-xs font-semibold text-gray-700 shadow-sm outline-none transition hover:border-blue-300 hover:bg-blue-100/80 focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50 disabled:cursor-not-allowed disabled:border-blue-100 disabled:bg-blue-50/30 disabled:text-blue-300 sm:shrink-0 sm:pl-3 sm:pr-7 sm:text-sm"

export const paginationCountClass =
  "shrink-0 text-sm font-medium text-gray-600"

export const paginationFooterClass =
  "flex flex-col gap-2 border-t border-gray-100 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"

export const paginationControlsRowClass =
  "grid min-w-0 grid-cols-[minmax(88px,1fr)_auto_auto_auto] items-center gap-1.5 sm:flex sm:flex-wrap sm:justify-end sm:gap-2"

export const showMoreTransactionsButtonClass =
  "inline-flex min-h-10 w-auto min-w-[180px] items-center justify-center rounded-lg border border-blue-200 bg-blue-50/80 px-4 text-sm font-semibold text-[#0052FF] shadow-sm transition hover:border-blue-300 hover:bg-blue-100/80 focus:outline-none focus:ring-4 focus:ring-blue-50 disabled:cursor-not-allowed disabled:border-blue-100 disabled:bg-blue-50/30 disabled:text-blue-300 disabled:opacity-60 disabled:shadow-none"

export function PaginationControls({
  totalLabel,
  page,
  totalPages,
  onPrevious,
  onNext,
  previousDisabled,
  nextDisabled,
  pageSizeControl,
  previousContent = "Previous",
  nextContent = "Next",
}: {
  totalLabel?: ReactNode
  page: number | string
  totalPages: number | string
  onPrevious: () => void
  onNext: () => void
  previousDisabled?: boolean
  nextDisabled?: boolean
  pageSizeControl?: ReactNode
  previousContent?: ReactNode
  nextContent?: ReactNode
}) {
  return (
    <div className={paginationFooterClass}>
      {totalLabel ? <span className={paginationCountClass}>{totalLabel}</span> : null}
      <div className={paginationControlsRowClass}>
        {pageSizeControl}
        <button
          type="button"
          disabled={previousDisabled}
          onClick={onPrevious}
          className={paginationControlClass}
        >
          {previousContent}
        </button>
        <span className={paginationIndicatorClass} aria-live="polite">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          disabled={nextDisabled}
          onClick={onNext}
          className={paginationControlClass}
        >
          {nextContent}
        </button>
      </div>
    </div>
  )
}
