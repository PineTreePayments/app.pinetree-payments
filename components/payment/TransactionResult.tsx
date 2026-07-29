"use client"

import type { ReactNode } from "react"
import Button from "@/components/ui/Button"
import { PaymentStatusVisual } from "@/components/payment/PaymentStatusVisual"

export type TransactionResultState =
  | "pending"
  | "processing"
  | "confirmed"
  | "failed"
  | "incomplete"
  | "expired"
  | "cancelled"
  | "refunded"
  | "unknown"

type TransactionResultAction = {
  label: string
  onClick?: () => void
  href?: string
  variant?: "primary" | "secondary" | "danger"
  disabled?: boolean
}

type Props = {
  state: TransactionResultState | string
  actions?: TransactionResultAction[]
  className?: string
  compact?: boolean
  children?: ReactNode
}

function normalizeTransactionResultState(state: TransactionResultState | string): TransactionResultState {
  const normalized = String(state || "").trim().toLowerCase()
  const tone = normalized === "cancelled" ? "canceled" : normalized
  if (tone === "waiting") return "pending"
  if (tone === "canceled") return "cancelled"
  if (
    tone === "processing" ||
    tone === "confirmed" ||
    tone === "failed" ||
    tone === "incomplete" ||
    tone === "expired" ||
    tone === "refunded" ||
    tone === "unknown"
  ) {
    return tone
  }
  return "unknown"
}

export function TransactionResult({
  state,
  actions = [],
  className = "",
  compact = false,
  children,
}: Props) {
  const normalized = normalizeTransactionResultState(state)

  return (
    <section
      className={`w-full rounded-[1.35rem] border border-[#0052FF]/10 bg-[radial-gradient(circle_at_top_right,rgba(0,82,255,0.10),transparent_34%),linear-gradient(135deg,#ffffff_0%,#f8fbff_52%,#eef5ff_100%)] px-5 ${compact ? "py-5" : "py-7"} text-center shadow-[0_18px_60px_rgba(0,82,255,0.12)] sm:px-7 ${compact ? "sm:py-6" : "sm:py-8"} ${className}`}
      aria-live="polite"
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-[#0052FF]">
        PineTree Checkout
      </p>

      <PaymentStatusVisual
        status={normalized}
        size={compact ? "compact" : "default"}
        className="mt-4"
      />

      {children ? <div className="mt-5 w-full">{children}</div> : null}

      {actions.length > 0 ? (
        <div className="mt-6 w-full space-y-2">
          {actions.map((action) => {
            if (action.href) {
              return (
                <a key={action.label} href={action.href} className="block">
                  <Button fullWidth variant={action.variant || "secondary"} disabled={action.disabled}>
                    {action.label}
                  </Button>
                </a>
              )
            }
            return (
              <Button
                key={action.label}
                fullWidth
                variant={action.variant}
                disabled={action.disabled}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
