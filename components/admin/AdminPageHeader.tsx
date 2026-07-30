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
// /dashboard/admin). Matches the merchant dashboard header pattern: a compact
// PineTree-blue eyebrow above the page title, the title itself, one line of
// supporting copy, and the "Last updated" value aligned to the right of the
// title row instead of inside the floating content cards below.
//
// The eyebrow carries the surface name ("Internal Admin Command Center") so the
// per-page title stays specific (Overview, Transaction Explorer, …). Do not
// fork these classes or re-introduce a full-bleed hero card for the title.

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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          {backHref && (
            <Link
              href={backHref}
              className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 transition hover:text-blue-800"
            >
              <ArrowLeft size={12} aria-hidden="true" />
              {backLabel}
            </Link>
          )}
          <p className={dashboardSectionLabelClass}>{eyebrow}</p>
          <h1 className={`mt-1 ${dashboardPageTitleClass}`}>{title}</h1>
          {description && (
            <p className={`mt-1 ${dashboardSupportingTextClass}`}>{description}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3 sm:justify-end">
          {lastUpdated && (
            <div className="min-w-0 sm:text-right">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700">
                {lastUpdatedLabel}
              </p>
              <p className="mt-0.5 truncate text-xs text-gray-600 sm:text-sm">{lastUpdated}</p>
            </div>
          )}
          {action}
        </div>
      </div>

      {metrics && metrics.length > 0 && (
        <div className="relative overflow-hidden rounded-2xl border border-blue-200/80 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.13),transparent_34%),linear-gradient(135deg,#ffffff_0%,#f7fbff_48%,#eef5ff_100%)] px-4 py-3 shadow-[0_10px_28px_rgba(37,99,235,0.09)] sm:px-5">
          <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-blue-300/80 to-transparent" />
          <div className="relative grid gap-3 sm:grid-cols-2 sm:gap-6">
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
        </div>
      )}
    </header>
  )
}

// Shared compact icon button for admin header actions (Refresh). Matches the
// PineTree-blue pagination/filter interaction treatment.
export const adminHeaderIconButtonClass =
  "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-blue-50/60 text-gray-500 shadow-sm transition hover:border-blue-300 hover:bg-blue-100/80 hover:text-[#0052FF] focus:outline-none focus:ring-4 focus:ring-blue-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-400 disabled:hover:border-gray-200 disabled:hover:bg-gray-50 sm:h-10 sm:w-10"
