import type { ReactNode } from "react"

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ")
}

export function PageHeader({
  title,
  description,
  eyebrow,
  action,
  className
}: {
  title: string
  description?: string
  eyebrow?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <header className={cx("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-700">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-semibold tracking-[-0.025em] text-slate-950 md:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-600">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  )
}

export function Surface({
  children,
  className,
  padding = "md",
  as: Element = "section"
}: {
  children: ReactNode
  className?: string
  padding?: "none" | "sm" | "md" | "lg"
  as?: "div" | "section" | "article"
}) {
  const paddingClass = {
    none: "",
    sm: "p-3.5 sm:p-4",
    md: "p-4 sm:p-5",
    lg: "p-5 sm:p-6"
  }[padding]

  return (
    <Element className={cx("app-surface min-w-0", paddingClass, className)}>
      {children}
    </Element>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  compact = false,
  className
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
  compact?: boolean
  className?: string
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-5 text-center",
        compact ? "py-7" : "py-12",
        className
      )}
    >
      {icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm ring-1 ring-slate-200/80">
          {icon}
        </div>
      )}
      <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
      {description && <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function LoadingSkeleton({
  rows = 3,
  className
}: {
  rows?: number
  className?: string
}) {
  return (
    <div className={cx("app-surface space-y-3 p-4 sm:p-5", className)} aria-label="Loading" aria-busy="true">
      <div className="h-5 w-32 animate-pulse rounded-lg bg-slate-200/80" />
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="h-12 animate-pulse rounded-xl bg-gradient-to-r from-slate-100 via-slate-200/70 to-slate-100"
        />
      ))}
    </div>
  )
}
