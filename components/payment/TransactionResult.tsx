"use client"

import type { ReactNode } from "react"
import {
  Ban,
  Check,
  CirclePause,
  Clock3,
  LoaderCircle,
  TimerOff,
  X,
} from "lucide-react"
import Button from "@/components/ui/Button"
import { getPaymentDisplayStatus } from "@/lib/utils/paymentStatus"

export type TransactionResultState =
  | "pending"
  | "processing"
  | "confirmed"
  | "failed"
  | "incomplete"
  | "expired"
  | "cancelled"

type TransactionResultAction = {
  label: string
  onClick?: () => void
  href?: string
  variant?: "primary" | "secondary" | "danger"
  disabled?: boolean
}

type Props = {
  state: TransactionResultState | string
  description?: string
  actions?: TransactionResultAction[]
  className?: string
  compact?: boolean
  children?: ReactNode
}

type StateConfig = {
  title: string
  description: string
  iconBgClassName: string
  iconClassName: string
  isWaiting?: boolean
  spin?: boolean
  Icon: typeof Check
}

const STATE_CONFIG: Record<TransactionResultState, StateConfig> = {
  pending: {
    title: "Pending",
    description: "Awaiting customer action.",
    iconBgClassName: "bg-transparent",
    iconClassName: "text-[#2f5bea]",
    isWaiting: true,
    Icon: Clock3,
  },
  processing: {
    title: "Processing",
    description: "Payment detected and awaiting confirmation.",
    iconBgClassName: "bg-blue-100",
    iconClassName: "text-blue-700",
    spin: true,
    Icon: LoaderCircle,
  },
  confirmed: {
    title: "Confirmed",
    description: "Payment successfully completed.",
    iconBgClassName: "bg-green-50",
    iconClassName: "text-green-600",
    Icon: Check,
  },
  failed: {
    title: "Failed",
    description: "Payment attempt failed validation, was rejected, or could not complete.",
    iconBgClassName: "bg-red-50",
    iconClassName: "text-red-600",
    Icon: X,
  },
  incomplete: {
    title: "Incomplete",
    description: "The payment was not completed before the request ended.",
    iconBgClassName: "bg-amber-50",
    iconClassName: "text-amber-700",
    Icon: CirclePause,
  },
  expired: {
    title: "Expired",
    description: "The payment request timed out.",
    iconBgClassName: "bg-amber-50",
    iconClassName: "text-amber-700",
    Icon: TimerOff,
  },
  cancelled: {
    title: "Cancelled",
    description: "The payment was cancelled before completion.",
    iconBgClassName: "bg-gray-50",
    iconClassName: "text-gray-600",
    Icon: Ban,
  },
}

function normalizeTransactionResultState(state: TransactionResultState | string): TransactionResultState {
  const tone = getPaymentDisplayStatus(state).tone
  if (tone === "waiting") return "pending"
  if (tone === "canceled") return "cancelled"
  if (
    tone === "processing" ||
    tone === "confirmed" ||
    tone === "failed" ||
    tone === "incomplete" ||
    tone === "expired"
  ) {
    return tone
  }
  return "incomplete"
}

export function TransactionResult({
  state,
  description,
  actions = [],
  className = "",
  compact = false,
  children,
}: Props) {
  const normalized = normalizeTransactionResultState(state)
  const config = STATE_CONFIG[normalized]
  const Icon = config.Icon
  const resolvedIconSize = compact ? 34 : 56

  return (
    <section
      className={`w-full rounded-[1.35rem] border border-[#0052FF]/10 bg-[radial-gradient(circle_at_top_right,rgba(0,82,255,0.10),transparent_34%),linear-gradient(135deg,#ffffff_0%,#f8fbff_52%,#eef5ff_100%)] px-5 ${compact ? "py-5" : "py-7"} text-center shadow-[0_18px_60px_rgba(0,82,255,0.12)] sm:px-7 ${compact ? "sm:py-6" : "sm:py-8"} ${className}`}
      aria-live="polite"
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-[#0052FF]">
        PineTree Checkout
      </p>

      <div className={`mx-auto mt-4 flex flex-col items-center ${compact ? "gap-2" : "gap-3"}`}>
        <div className={`rounded-full ${compact ? "p-2" : "p-3"} ${config.iconBgClassName} shadow-sm ring-1 ring-white/80`}>
          <span className={`inline-flex ${config.isWaiting ? "pinetree-waiting-glow" : ""}`}>
            <Icon
              size={resolvedIconSize}
              className={`${config.iconClassName} ${config.spin ? "animate-spin" : ""} ${config.isWaiting ? "pinetree-waiting-indicator" : ""}`}
              strokeWidth={1.8}
            />
          </span>
        </div>

        <div className="space-y-0.5">
          <h1 className={`${compact ? "text-lg" : "text-xl sm:text-2xl"} font-semibold ${config.isWaiting ? "text-[#2f5bea]" : "text-gray-950"}`}>
            {config.title}
          </h1>
          <p className={`${compact ? "text-xs" : "text-sm"} leading-6 text-gray-600`}>
            {description || config.description}
          </p>
        </div>
      </div>

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
