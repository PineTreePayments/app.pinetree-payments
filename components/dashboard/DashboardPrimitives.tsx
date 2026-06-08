import type { ReactNode } from "react"

type Tone = "default" | "blue" | "green" | "amber" | "red" | "slate"

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ")
}

const surfaceClass =
  "border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]"

export const dashboardPageTitleClass =
  "text-2xl font-semibold leading-tight tracking-tight text-gray-950 md:text-3xl"

export const dashboardHeroValueClass =
  "text-3xl font-semibold leading-tight tracking-tight text-gray-950 sm:text-4xl"

export const dashboardMetricValueClass =
  "text-xl font-semibold leading-tight text-gray-950 sm:text-2xl"

export const dashboardSectionLabelClass =
  "text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]"

export const dashboardCardTitleClass =
  "text-base font-semibold leading-tight text-gray-950"

export const dashboardSupportingTextClass =
  "text-sm leading-5 text-gray-600"

export function DashboardSection({
  title,
  eyebrow,
  action,
  children,
  titleTone = "default",
  className = ""
}: {
  title?: string
  eyebrow?: string
  action?: ReactNode
  children: ReactNode
  titleTone?: "default" | "blue"
  className?: string
}) {
  const titleClass =
    titleTone === "blue"
      ? dashboardSectionLabelClass
      : dashboardCardTitleClass

  return (
    <section className={cx("space-y-3 md:space-y-4", className)}>
      {(title || eyebrow || action) && (
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            {eyebrow && (
              <p className={dashboardSectionLabelClass}>
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 className={titleClass}>
                {title}
              </h2>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function CompactMetricTile({
  label,
  value,
  detail,
  tone = "default",
  interactive = false,
  onClick,
  className = ""
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  tone?: Tone
  interactive?: boolean
  onClick?: () => void
  className?: string
}) {
  const toneClass: Record<Tone, string> = {
    default: "from-white to-gray-50/80",
    blue: "from-blue-50/80 to-white",
    green: "from-emerald-50/80 to-white",
    amber: "from-amber-50/80 to-white",
    red: "from-red-50/80 to-white",
    slate: "from-slate-50/80 to-white"
  }

  const content = (
    <>
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-500">
        {label}
      </p>
      <div className={cx("mt-1.5 min-w-0", dashboardMetricValueClass)}>
        {value}
      </div>
      {detail && (
        <div className="mt-1 text-xs leading-5 text-gray-500">
          {detail}
        </div>
      )}
    </>
  )

  const classes = cx(
    surfaceClass,
    "min-w-0 rounded-2xl bg-gradient-to-br p-3.5 sm:p-4",
    toneClass[tone],
    interactive &&
      "text-left transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_18px_50px_rgba(15,23,42,0.10),0_0_36px_rgba(37,99,235,0.14)] focus:outline-none focus:ring-4 focus:ring-blue-100",
    className
  )

  if (interactive) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {content}
      </button>
    )
  }

  return <div className={classes}>{content}</div>
}

export function MetricGrid({
  children,
  columns = "auto",
  className = ""
}: {
  children: ReactNode
  columns?: "auto" | "two" | "three" | "four"
  className?: string
}) {
  const columnsClass = {
    auto: "grid-cols-2 sm:grid-cols-2 xl:grid-cols-4",
    two: "grid-cols-2",
    three: "grid-cols-2 sm:grid-cols-3",
    four: "grid-cols-2 sm:grid-cols-4"
  }[columns]

  return <div className={cx("grid gap-3 md:gap-4", columnsClass, className)}>{children}</div>
}

export function GroupedMetricSurface({
  title,
  children,
  titleTone = "default",
  className = ""
}: {
  title?: string
  children: ReactNode
  titleTone?: "default" | "blue"
  className?: string
}) {
  return (
    <div className={cx(surfaceClass, "rounded-2xl p-4 sm:p-5", className)}>
      {title && (
        <p
          className={cx(
            "mb-3",
            titleTone === "blue"
              ? dashboardSectionLabelClass
              : "text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500"
          )}
        >
          {title}
        </p>
      )}
      {children}
    </div>
  )
}

export function InlineMetric({
  label,
  value,
  detail,
  className = ""
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  className?: string
}) {
  return (
    <div className={cx("min-w-0", className)}>
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-500">
        {label}
      </p>
      <div className={cx("mt-1 min-w-0", dashboardMetricValueClass)}>
        {value}
      </div>
      {detail && <div className="mt-1 text-xs leading-5 text-gray-500">{detail}</div>}
    </div>
  )
}

export function DashboardHeroCard({
  eyebrow,
  title,
  value,
  detail,
  action,
  secondary
}: {
  eyebrow: string
  title: string
  value: ReactNode
  detail?: ReactNode
  action?: ReactNode
  secondary?: ReactNode
}) {
  return (
    <div className="relative overflow-hidden rounded-[1.35rem] border border-blue-200/80 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.16),transparent_34%),linear-gradient(135deg,#ffffff_0%,#f7fbff_48%,#eef5ff_100%)] p-4 shadow-[0_18px_60px_rgba(37,99,235,0.13)] sm:p-5 md:p-6">
      <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-blue-300/80 to-transparent" />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className={dashboardSectionLabelClass}>
            {eyebrow}
          </p>
          <h2 className={cx("mt-2 font-medium", dashboardSupportingTextClass)}>{title}</h2>
          <div className={cx("mt-1", dashboardHeroValueClass)}>
            {value}
          </div>
          {detail && <div className={cx("mt-2", dashboardSupportingTextClass)}>{detail}</div>}
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          {secondary}
          {action}
        </div>
      </div>
    </div>
  )
}

export function InsightCard({
  title = "PineTree Insights",
  insights,
  emptyText = "Insights will appear as payment activity builds.",
  className = ""
}: {
  title?: string
  insights: string[]
  emptyText?: string
  className?: string
}) {
  const visibleInsights = insights.filter((insight) => insight.trim().length > 0)

  return (
    <div
      className={cx(
        "rounded-2xl border border-blue-200/80 bg-blue-50/80 px-3.5 py-3 shadow-[0_8px_24px_rgba(37,99,235,0.07)] backdrop-blur sm:px-4 sm:py-3.5",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={dashboardSectionLabelClass}>
          {title}
        </p>
        <span className="h-2 w-2 rounded-full bg-blue-600 shadow-[0_0_18px_rgba(37,99,235,0.7)]" />
      </div>
      <div className="mt-2 space-y-1.5">
        {(visibleInsights.length ? visibleInsights : [emptyText]).map((insight) => (
          <p key={insight} className="text-[13px] leading-5 text-gray-800 sm:text-sm">
            {insight}
          </p>
        ))}
      </div>
    </div>
  )
}

export const PineTreeInsightsCard = InsightCard

export function ProviderStatusPill({
  label,
  tone = "default",
  className = ""
}: {
  label: string
  tone?: Tone
  className?: string
}) {
  const toneClass: Record<Tone, string> = {
    default: "border-gray-200 bg-gray-50 text-gray-600",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    red: "border-red-200 bg-red-50 text-red-700",
    slate: "border-slate-200 bg-slate-50 text-slate-700"
  }

  return (
    <span
      className={cx(
        "inline-flex min-h-7 items-center rounded-full border px-2.5 text-[11px] font-semibold leading-none",
        toneClass[tone],
        className
      )}
    >
      {label}
    </span>
  )
}

export const NetworkStatusPill = ProviderStatusPill

export function ChartCard({
  title,
  subtitle,
  action,
  children,
  titleTone = "default",
  className = ""
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  titleTone?: "default" | "blue"
  className?: string
}) {
  return (
    <div className={cx(surfaceClass, "rounded-2xl p-4 sm:p-5", className)}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            className={cx(
              titleTone === "blue" ? dashboardSectionLabelClass : dashboardCardTitleClass
            )}
          >
            {title}
          </h2>
          {subtitle && <p className={cx("mt-1", dashboardSupportingTextClass)}>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

export const VolumeChartCard = ChartCard
