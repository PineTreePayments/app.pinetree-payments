import type { ReactNode } from "react"
import { AlertTriangle, CheckCircle, Clock3, LoaderCircle, RotateCcw, XCircle } from "lucide-react"
import {
  getPaymentDisplayStatus,
  type PaymentStatusIcon,
} from "@/lib/utils/paymentStatus"

type Props = {
  status: string
  className?: string
  showMessage?: boolean
  labelOverride?: string
  messageOverride?: string
  labelClassName?: string
  iconSize?: number
  variant?: "plain" | "card"
  size?: "default" | "compact"
  children?: ReactNode
}

const STATUS_ICONS = {
  "check-circle": CheckCircle,
  "clock": Clock3,
  "spinner": LoaderCircle,
  "x-circle": XCircle,
  refund: RotateCcw,
  "alert-triangle": AlertTriangle,
} satisfies Record<PaymentStatusIcon, typeof CheckCircle>

export function normalizeStandardPaymentStatus(status: string) {
  return getPaymentDisplayStatus(status).tone
}

export function PaymentStatusVisual({
  status,
  className = "",
  showMessage = true,
  labelOverride,
  messageOverride,
  labelClassName,
  iconSize,
  variant = "plain",
  size = "default",
  children,
}: Props) {
  const config = getPaymentDisplayStatus(status)
  const Icon = STATUS_ICONS[config.icon]
  const isCompact = size === "compact"
  const isCard = variant === "card"
  const resolvedIconSize = iconSize ?? (isCard ? 36 : isCompact ? 24 : 36)
  const gapClass = isCompact ? "gap-2.5" : "gap-3"
  const iconCircleClass = isCard
    ? "h-[72px] w-[72px] sm:h-20 sm:w-20"
    : isCompact
      ? "h-12 w-12"
      : "h-[72px] w-[72px] sm:h-20 sm:w-20"
  const labelClass =
    labelClassName ||
    (isCard
      ? "text-xl font-bold text-gray-950 sm:text-2xl"
      : isCompact
        ? "text-lg font-bold text-gray-950"
        : "text-xl font-bold text-gray-950 sm:text-2xl")
  const messageClass = isCompact
    ? "max-w-sm text-xs leading-5 text-gray-600"
    : "max-w-sm text-sm leading-6 text-gray-600"
  const variantClass = isCard
    ? "w-full max-w-md rounded-2xl border border-[#DDEBFF] bg-[#F7FAFF] px-5 py-7 shadow-sm sm:px-7 sm:py-8"
    : ""

  return (
    <section
      className={`flex flex-col items-center text-center ${gapClass} ${variantClass} ${className}`}
      aria-live="polite"
      data-payment-state-card={isCard ? "true" : undefined}
    >
      <div
        className={`inline-flex aspect-square flex-shrink-0 items-center justify-center overflow-hidden rounded-full ${iconCircleClass} ${config.iconBgClassName}`}
        data-payment-state-icon-circle="true"
      >
        <Icon
          size={resolvedIconSize}
          className={`${config.iconClassName} ${config.spin ? "animate-spin" : ""}`}
          strokeWidth={1.8}
          aria-hidden="true"
        />
      </div>
      <div className="space-y-0.5">
        <h1 className={labelClass}>{labelOverride || config.title}</h1>
        {showMessage ? <p className={messageClass}>{messageOverride || config.message}</p> : null}
      </div>
      {children ? <div className="mt-3 w-full">{children}</div> : null}
    </section>
  )
}
