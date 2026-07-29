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
    <PaymentStatusVisual
      status={normalized}
      size={compact ? "compact" : "default"}
      variant="card"
      className={className}
    >
      {children || actions.length > 0 ? (
        <div className="w-full space-y-5">
          {children ? <div className="w-full">{children}</div> : null}
          {actions.length > 0 ? (
            <div className="w-full space-y-2">
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
        </div>
      ) : null}
    </PaymentStatusVisual>
  )
}
