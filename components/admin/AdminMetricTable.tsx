"use client"

/**
 * Shared Admin metric table — the one implementation behind every
 * "label + numbers" report table in Admin (Volume by Rail, Volume by Provider,
 * Top Merchants, and any future metric breakdown).
 *
 * Why one component: the report tables previously each declared their own
 * `grid-cols-[…]` template inline, applied at every breakpoint. Two problems
 * followed — the fixed pixel tracks were far wider than a phone viewport, so
 * rows ran off the right edge; and numeric cells were left-aligned, so digits
 * of different widths zig-zagged instead of lining up.
 *
 * Layout contract:
 *  - Desktop (sm and up): one `gridTemplateColumns` string, built once from the
 *    column definitions and applied to BOTH the header and every row, so header
 *    and body can never drift. Numeric columns are right-aligned and tabular.
 *  - Mobile: the fixed tracks are dropped entirely. Each row becomes the label
 *    followed by a two-up metric grid whose values are right-aligned and
 *    tabular, so numbers still line up in a column and nothing is clipped.
 */

import type { ReactNode } from "react"

export type AdminMetricColumn<Row> = {
  /** Stable key; also the React key for the cell. */
  key: string
  header: string
  /** Desktop track width. The first column should use "1fr". */
  width: string
  /** Numeric columns right-align and use tabular figures. */
  numeric?: boolean
  /** Rendered value. Keep it a string so both layouts stay identical. */
  render: (row: Row) => ReactNode
  /** Emphasised (darker/semibold) value — e.g. Volume. */
  emphasis?: boolean
}

export function AdminMetricTable<Row>({
  columns,
  rows,
  rowKey,
  rowLabel,
  leadingLabel,
}: {
  /** The first column is the row's name; the rest are its metrics. */
  columns: AdminMetricColumn<Row>[]
  rows: Row[]
  rowKey: (row: Row, index: number) => string
  /** The row's name cell (first column) on both layouts. */
  rowLabel: (row: Row, index: number) => ReactNode
  /** Header text for the name column. */
  leadingLabel: string
}) {
  // One template string for the header and every row — identical widths by
  // construction rather than by two lists that have to be kept in sync.
  const gridTemplateColumns = [`minmax(0, 1fr)`, ...columns.map((column) => column.width)].join(" ")

  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
      {/* Desktop header */}
      <div
        style={{ gridTemplateColumns }}
        className="hidden gap-4 bg-gray-50/60 px-5 py-2.5 sm:grid"
      >
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          {leadingLabel}
        </div>
        {columns.map((column) => (
          <div
            key={column.key}
            className={`text-[11px] font-semibold uppercase tracking-wider text-gray-400 ${
              column.numeric ? "text-right" : ""
            }`}
          >
            {column.header}
          </div>
        ))}
      </div>

      <div className="min-w-0 divide-y divide-gray-100">
        {rows.map((row, index) => (
          <div key={rowKey(row, index)} className="min-w-0 px-4 py-3 sm:px-5">
            {/* Desktop: fixed tracks, numbers right-aligned and tabular. */}
            <div
              style={{ gridTemplateColumns }}
              className="hidden items-center gap-4 sm:grid"
            >
              <div className="min-w-0 text-sm font-medium text-gray-900">
                {rowLabel(row, index)}
              </div>
              {columns.map((column) => (
                <div
                  key={column.key}
                  className={`min-w-0 whitespace-nowrap text-sm ${
                    column.numeric ? "text-right tabular-nums" : ""
                  } ${column.emphasis ? "font-medium text-gray-900" : "text-gray-600"}`}
                >
                  {column.render(row)}
                </div>
              ))}
            </div>

            {/* Mobile: name on its own line, then a two-up metric grid whose
                values right-align so digits stay in one column. */}
            <div className="min-w-0 sm:hidden">
              <div className="min-w-0 text-sm font-medium text-gray-900">
                {rowLabel(row, index)}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                {columns.map((column) => (
                  <div
                    key={column.key}
                    className="flex min-w-0 items-baseline justify-between gap-2"
                  >
                    <dt className="truncate text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                      {column.header}
                    </dt>
                    <dd
                      className={`shrink-0 whitespace-nowrap text-sm tabular-nums ${
                        column.emphasis ? "font-medium text-gray-900" : "text-gray-600"
                      }`}
                    >
                      {column.render(row)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default AdminMetricTable
