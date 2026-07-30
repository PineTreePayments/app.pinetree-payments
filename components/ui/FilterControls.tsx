"use client"

// PineTree standard filter controls (search inputs, dropdown filters, reset and
// icon buttons). These carry the same PineTree-blue interaction treatment as
// components/ui/PaginationControls.tsx — blue border, faint blue field, blue
// hover, blue focus ring — so a filter bar and the Previous/Next controls
// directly beneath it read as one system.
//
// Fields stay light rather than solid blue; only the primary Apply action is
// solid (see components/ui/PrimaryActionButton.tsx).
//
// Sizing: 44px tall on touch viewports, 40px from `sm` up. Selects keep the
// native control (no appearance-none arrow substitute) so mobile pickers behave
// normally.

const filterFieldBase =
  "h-11 min-w-0 rounded-lg border border-blue-200 bg-blue-50/40 text-sm text-gray-700 shadow-sm transition placeholder:text-gray-400 hover:border-blue-300 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400 sm:h-10"

/** Text input inside a filter bar. */
export const filterInputClass = `${filterFieldBase} w-full px-3`

/** Text input that carries a leading search icon (icon sits at left-3). */
export const filterSearchInputClass = `${filterFieldBase} w-full pl-9 pr-3`

/** Native select inside a filter bar. */
export const filterSelectClass = `${filterFieldBase} px-3`

/** Secondary control: Reset / Clear. */
export const filterResetButtonClass =
  "inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50/60 px-3 text-sm font-normal text-gray-500 shadow-sm transition hover:border-blue-300 hover:bg-blue-100/80 hover:text-[#0052FF] focus:outline-none focus:ring-4 focus:ring-blue-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400 sm:h-10"

/** Square icon-only control inside a filter bar (Refresh). */
export const filterIconButtonClass =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-blue-50/60 text-gray-500 shadow-sm transition hover:border-blue-300 hover:bg-blue-100/80 hover:text-[#0052FF] focus:outline-none focus:ring-4 focus:ring-blue-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400 disabled:hover:border-gray-200 disabled:hover:bg-gray-50 sm:h-10 sm:w-10"

/** Applied-filter chip. */
export const filterChipClass =
  "inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700"

/** Wrapper for the leading icon of a search field. */
export const filterSearchIconClass =
  "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-blue-400"
