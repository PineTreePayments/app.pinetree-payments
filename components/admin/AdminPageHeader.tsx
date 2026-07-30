"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import type { ReactNode } from "react"
import {
  dashboardPageTitleClass,
  dashboardSectionLabelClass,
  dashboardSupportingTextClass,
} from "@/components/dashboard/DashboardPrimitives"

// PineTree standard Admin page header (source of truth for every page under
// /dashboard/admin). Structure, top to bottom:
//
//   Page title  →  hero card  →  the page's existing tabs and content
//
// The hero card reuses the Platform Reports hero styling verbatim — same blue
// PineTree gradient, top hairline, padding, radius, shadow and typography — and
// carries the "Internal Admin Command Center" eyebrow inside the card. The
// per-page title stays above the card so each surface names itself (Overview,
// Transaction Explorer, …). Do not fork these classes.

export type AdminHeaderMetric = {
  label: string
  value: ReactNode
}

export default function AdminPageHeader({
  eyebrow = "Internal Admin Command Center",
  title,
  description,
  lastUpdatedLabel = "Last Updated",
  lastUpdated,
  backHref,
  backLabel = "Admin",
  action,
  metrics,
}: {
  eyebrow?: string
  title: string
  description?: string
  lastUpdatedLabel?: string
  lastUpdated?: string | null
  backHref?: string
  backLabel?: string
  action?: ReactNode
  metrics?: AdminHeaderMetric[]
}) {
  return (
    <header className="space-y-3">
      {backHref && (
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 transition hover:text-blue-800"
        >
          <ArrowLeft size={12} aria-hidden="true" />
          {backLabel}
        </Link>
      )}

      <h1 className={dashboardPageTitleClass}>{title}</h1>

      {/* Hero card — Platform Reports styling */}
      <div className="relative overflow-hidden rounded-[1.35rem] border border-blue-200/80 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.16),transparent_34%),linear-gradient(135deg,#ffffff_0%,#f7fbff_48%,#eef5ff_100%)] p-5 shadow-[0_18px_60px_rgba(37,99,235,0.13)] sm:p-6">
        <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-blue-300/80 to-transparent" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className={dashboardSectionLabelClass}>{eyebrow}</p>
            {description && (
              <p className={`mt-2 ${dashboardSupportingTextClass}`}>{description}</p>
            )}
            {metrics && metrics.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-x-10 gap-y-3">
                {metrics.map((metric) => (
                  <div key={metric.label} className="min-w-0">
                    <p className="truncate text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-500">
                      {metric.label}
                    </p>
                    <div className="mt-0.5 truncate text-2xl font-semibold leading-tight tracking-tight text-gray-950 sm:text-3xl">
                      {metric.value}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-3 sm:flex-col sm:items-end">
            {/* Desktop only: there is no room for a timestamp beside the title on
                a phone, and it is the least useful thing in the card there. */}
            {lastUpdated && (
              <div className="hidden min-w-0 sm:block sm:text-right">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">
                  {lastUpdatedLabel}
                </p>
                <p className="mt-0.5 truncate text-sm text-gray-600">{lastUpdated}</p>
              </div>
            )}
            {action}
          </div>
        </div>
      </div>
    </header>
  )
}

// Shared compact icon button for admin header actions (Refresh). Matches the
// PineTree-blue pagination/filter interaction treatment.
const adminHeaderIconButtonBase =
  "h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-blue-50/60 text-gray-500 shadow-sm transition hover:border-blue-300 hover:bg-blue-100/80 hover:text-[#0052FF] focus:outline-none focus:ring-4 focus:ring-blue-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400 disabled:hover:border-gray-200 disabled:hover:bg-gray-50 sm:h-10 sm:w-10"

export const adminHeaderIconButtonClass = `inline-flex ${adminHeaderIconButtonBase}`

// Internal admin refresh controls are desktop-only: on a phone they crowd the
// header for a capability the browser's own reload already covers. Display is
// declared once here so `hidden` never competes with `inline-flex` in one class
// list.
export const adminHeaderIconButtonDesktopClass = `hidden sm:inline-flex ${adminHeaderIconButtonBase}`
