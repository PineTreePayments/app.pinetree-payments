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
 * Layout contract — one component, two renderings, no duplicated data logic:
 *
 *  - Desktop (sm and up): one `gridTemplateColumns` string, built once from the
 *    column definitions and applied to BOTH the header and every row, so header
 *    and body can never drift. Numeric columns are right-aligned and tabular.
 *
 *  - Mobile (below sm): showing every metric on every row turned a concise
 *    report into a stack of mini dashboards. Each row is now a compact
 *    (56px minimum) button carrying only the row name and its summary metric,
 *    so several rails or providers fit on screen at once. The remaining
 *    metrics open in a detail panel built from the SAME column definitions —
 *    no second formatting path and no per-table mobile markup.
 *
 * Both renderings call `column.render(row)`, so a value can never differ
 * between breakpoints, and neither computes anything: totals, fees, conversion
 * and sort order all arrive already decided by the caller.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { ChevronRight, X } from "lucide-react"
import { modalCloseButtonClass } from "@/components/ui/ModalCloseButton"

export type AdminMetricColumn<Row> = {
  /** Stable key; also the React key for the cell. */
  key: string
  header: string
  /**
   * Longer label for the mobile detail panel ("Confirmed volume" where the
   * desktop column header reads "Volume"). Falls back to `header`, so desktop
   * column headers stay short and unchanged.
   */
  detailHeader?: string
  /** Desktop track width. The first column should use "1fr". */
  width: string
  /** Numeric columns right-align and use tabular figures. */
  numeric?: boolean
  /** Rendered value. Keep it a string so both layouts stay identical. */
  render: (row: Row) => ReactNode
  /** Emphasised (darker/semibold) value — e.g. Volume. */
  emphasis?: boolean
  /**
   * The single metric shown on the collapsed mobile row. Defaults to the first
   * emphasised column, then to the last column.
   */
  summary?: boolean
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Breakpoint the mobile rendering is scoped to; matches Tailwind's `sm`. */
const DESKTOP_MEDIA_QUERY = "(min-width: 640px)"

function detailLabel<Row>(column: AdminMetricColumn<Row>): string {
  return column.detailHeader ?? column.header
}

// ─── Mobile detail panel ───────────────────────────────────────────────────────

/**
 * Reuses the established PineTree modal shell: `pinetree-modal-backdrop`
 * overlay, white rounded panel, and the shared `modalCloseButtonClass` circular
 * X — the same chrome as the transaction and support panels. No new design.
 */
function AdminMetricDetailPanel<Row>({
  panelId,
  titleId,
  eyebrow,
  title,
  columns,
  row,
  onClose,
}: {
  panelId: string
  titleId: string
  eyebrow: string
  title: ReactNode
  columns: AdminMetricColumn<Row>[]
  row: Row
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  // Return focus to the row that opened the panel.
  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      returnFocusRef.current?.focus?.()
    }
  }, [])

  // Background must not scroll behind the panel; the previous value is restored
  // rather than assumed to be "".
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  // Escape closes; Tab is trapped inside the panel.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation()
        onClose()
        return
      }

      if (event.key !== "Tab") return
      const container = panelRef.current
      if (!container) return

      const focusable = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((element) => element.offsetParent !== null || element === document.activeElement)
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  // Move focus into the panel when it opens.
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus()
  }, [])

  return (
    <div
      data-pinetree-overlay="true"
      className="pinetree-modal-backdrop fixed inset-0 z-50 flex items-center justify-center overflow-hidden p-3"
      onMouseDown={onClose}
    >
      <div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto overflow-x-hidden overscroll-contain rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_24px_80px_rgba(15,23,42,0.22)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">
              {eyebrow}
            </p>
            <h2
              id={titleId}
              className="mt-1 min-w-0 break-words text-base font-semibold leading-snug text-gray-900"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className={modalCloseButtonClass}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <dl className="mt-4 min-w-0 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-100 bg-gray-50/60">
          {columns.map((column) => (
            <div
              key={column.key}
              className="flex min-w-0 items-baseline justify-between gap-4 px-3.5 py-2.5"
            >
              <dt className="min-w-0 truncate text-xs text-gray-500">{detailLabel(column)}</dt>
              <dd
                className={`shrink-0 whitespace-nowrap text-sm tabular-nums ${
                  column.emphasis ? "font-semibold text-gray-900" : "text-gray-700"
                }`}
              >
                {column.render(row)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

// ─── Table ─────────────────────────────────────────────────────────────────────

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

  // Exactly one detail panel can be open, so this is a single key, not a set.
  const [openKey, setOpenKey] = useState<string | null>(null)
  const idPrefix = useId()

  const close = useCallback(() => setOpenKey(null), [])

  // The panel belongs to the mobile rendering. If the viewport grows past the
  // breakpoint while it is open, close it rather than leaving a dialog (and a
  // scroll lock) attached to a layout that no longer shows expandable rows.
  // Subscription only: a panel can only be opened from an `sm:hidden` row, so
  // crossing the breakpoint is the sole way to reach the desktop layout.
  useEffect(() => {
    if (!openKey || typeof window === "undefined" || !window.matchMedia) return
    const query = window.matchMedia(DESKTOP_MEDIA_QUERY)
    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) close()
    }
    query.addEventListener("change", handleChange)
    return () => query.removeEventListener("change", handleChange)
  }, [openKey, close])

  // The one metric a collapsed mobile row shows.
  const summaryColumn =
    columns.find((column) => column.summary) ??
    columns.find((column) => column.emphasis) ??
    columns[columns.length - 1]

  const openIndex = rows.findIndex((row, index) => rowKey(row, index) === openKey)
  const openRow = openIndex >= 0 ? rows[openIndex] : null

  return (
    <>
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
        {rows.map((row, index) => {
          const key = rowKey(row, index)
          const isOpen = openKey === key
          const panelId = `${idPrefix}-${index}-panel`

          return (
            <div key={key} className="min-w-0">
              {/* Desktop: fixed tracks, numbers right-aligned and tabular. */}
              <div
                style={{ gridTemplateColumns }}
                className="hidden items-center gap-4 px-5 py-3 sm:grid"
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

              {/* Mobile: the whole row is one compact control — name, summary
                  metric, expand indicator. Everything else lives in the panel. */}
              {summaryColumn && (
                <button
                  type="button"
                  onClick={() => setOpenKey(key)}
                  aria-haspopup="dialog"
                  aria-expanded={isOpen}
                  aria-controls={isOpen ? panelId : undefined}
                  className="flex min-h-[3.5rem] w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#0052FF]/[0.04] focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-blue-100 active:bg-[#0052FF]/[0.08] sm:hidden"
                >
                  <div className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                    {rowLabel(row, index)}
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-gray-900">
                    {summaryColumn.render(row)}
                  </span>
                  <ChevronRight
                    size={16}
                    aria-hidden="true"
                    className="shrink-0 text-gray-400"
                  />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>

    {/* Rendered as a sibling of the card, never inside it: the card is
        `overflow-hidden`, and a fixed overlay has no business being a
        descendant of a clipping container. */}
    {openRow !== null && openKey && (
      <AdminMetricDetailPanel
        panelId={`${idPrefix}-${openIndex}-panel`}
        titleId={`${idPrefix}-${openIndex}-title`}
        eyebrow={leadingLabel}
        title={rowLabel(openRow, openIndex)}
        columns={columns}
        row={openRow}
        onClose={close}
      />
    )}
    </>
  )
}

export default AdminMetricTable
