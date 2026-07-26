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
  glowClassName: string
  iconClassName: string
  animationClassName: string
  Icon: typeof Check
}

const STATE_CONFIG: Record<TransactionResultState, StateConfig> = {
  pending: {
    title: "Pending",
    description: "Awaiting customer action.",
    glowClassName: "from-[#0052FF]/28 via-[#0052FF]/12 to-transparent",
    iconClassName: "text-[#0052FF]",
    animationClassName: "pinetree-result-pulse",
    Icon: Clock3,
  },
  processing: {
    title: "Processing",
    description: "Payment detected and awaiting confirmation.",
    glowClassName: "from-[#0052FF]/30 via-[#0052FF]/13 to-transparent",
    iconClassName: "text-[#0052FF]",
    animationClassName: "pinetree-result-pulse",
    Icon: LoaderCircle,
  },
  confirmed: {
    title: "Confirmed",
    description: "Payment successfully completed.",
    glowClassName: "from-emerald-500/30 via-emerald-400/13 to-transparent",
    iconClassName: "text-emerald-600",
    animationClassName: "pinetree-result-confirmed",
    Icon: Check,
  },
  failed: {
    title: "Failed",
    description: "Payment attempt failed validation, was rejected, or could not complete.",
    glowClassName: "from-red-500/30 via-red-400/13 to-transparent",
    iconClassName: "text-red-600",
    animationClassName: "pinetree-result-shake",
    Icon: X,
  },
  incomplete: {
    title: "Incomplete",
    description: "The payment was not completed before the request ended.",
    glowClassName: "from-orange-500/30 via-orange-400/13 to-transparent",
    iconClassName: "text-orange-600",
    animationClassName: "pinetree-result-fade",
    Icon: CirclePause,
  },
  expired: {
    title: "Expired",
    description: "The payment request timed out.",
    glowClassName: "from-amber-500/30 via-amber-400/13 to-transparent",
    iconClassName: "text-amber-600",
    animationClassName: "pinetree-result-fade",
    Icon: TimerOff,
  },
  cancelled: {
    title: "Cancelled",
    description: "The payment was cancelled before completion.",
    glowClassName: "from-slate-400/30 via-slate-400/13 to-transparent",
    iconClassName: "text-slate-500",
    animationClassName: "pinetree-result-fade",
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

  return (
    <section
      className={`flex w-full flex-col rounded-[1.35rem] border border-white/80 bg-white/82 px-5 py-6 text-center shadow-[0_24px_70px_rgba(15,23,42,0.14)] ring-1 ring-[#0052FF]/8 backdrop-blur-xl sm:px-7 ${compact ? "min-h-[23.75rem] sm:py-7" : "min-h-[25rem] sm:py-8"} ${className}`}
      aria-live="polite"
    >
      <div className="mx-auto flex min-h-full w-full max-w-[19rem] flex-1 flex-col items-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0052FF]">
          PineTree Checkout
        </p>

        <div className={`relative mt-7 flex h-[7.25rem] w-[7.25rem] items-center justify-center ${config.animationClassName}`}>
          <span
            aria-hidden="true"
            className={`absolute left-1/2 top-1/2 h-[7.25rem] w-[7.25rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,var(--tw-gradient-stops))] ${config.glowClassName} blur-xl`}
          />
          {normalized === "processing" ? (
            <span
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 h-[5.35rem] w-[5.35rem] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-[#0052FF]/14 border-t-[#0052FF] animate-spin"
            />
          ) : null}
          <Icon className={`relative h-16 w-16 ${config.iconClassName}`} strokeWidth={1.75} />
        </div>

        <div className="mt-7 min-h-[7.625rem] space-y-3">
          <h1 className="text-[1.72rem] font-bold leading-tight text-gray-950 sm:text-[1.9rem]">
            {config.title}
          </h1>
          <p className="mx-auto max-w-[18rem] text-[15px] leading-6 text-gray-600">
            {description || config.description}
          </p>
        </div>

        {children ? <div className="mt-5 w-full">{children}</div> : null}

        <div className="mt-auto min-h-[7.25rem] w-full space-y-2 pt-7">
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
      </div>
    </section>
  )
}
