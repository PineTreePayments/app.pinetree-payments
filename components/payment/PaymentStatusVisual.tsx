import { AlertTriangle, CheckCircle, CircleMinus, Clock3, LoaderCircle, RotateCcw, XCircle } from "lucide-react"
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
}

const STATUS_ICONS = {
  "check-circle": CheckCircle,
  "minus": CircleMinus,
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
}: Props) {
  const config = getPaymentDisplayStatus(status)
  const Icon = STATUS_ICONS[config.icon]
  const isCompact = size === "compact"
  const isWaiting = config.tone === "waiting"
  const resolvedIconSize = iconSize ?? (isCompact ? 28 : 56)
  const iconPadding = isCompact ? "p-2" : "p-3"
  const gapClass = isCompact ? "gap-2" : "gap-3"
  const isCard = variant === "card"
  const labelClass =
    labelClassName ||
    (isCard
      ? `text-xl font-semibold ${isWaiting ? "text-[#2f5bea]" : "text-gray-950"} sm:text-2xl`
      : isCompact
        ? `text-lg font-bold ${isWaiting ? "text-[#2f5bea]" : "text-gray-900"}`
        : `text-2xl font-bold ${isWaiting ? "text-[#2f5bea]" : "text-gray-900"}`)
  const messageClass = isCard ? "text-sm leading-6 text-gray-600" : isCompact ? "text-xs text-gray-500" : "text-sm text-gray-500"
  const variantClass = isCard
    ? "w-full rounded-[1.35rem] border border-[#0052FF]/10 bg-[radial-gradient(circle_at_top_right,rgba(0,82,255,0.10),transparent_34%),linear-gradient(135deg,#ffffff_0%,#f8fbff_52%,#eef5ff_100%)] px-5 py-7 shadow-[0_18px_60px_rgba(0,82,255,0.12)] sm:px-7 sm:py-8"
    : ""
  const iconSurfaceClass = isCard ? "shadow-sm ring-1 ring-white/80" : ""

  return (
    <div className={`flex flex-col items-center text-center ${gapClass} ${variantClass} ${className}`}>
      <div className={`rounded-full ${iconPadding} ${config.iconBgClassName} ${iconSurfaceClass}`}>
        <span className="inline-flex">
          <Icon
            size={resolvedIconSize}
            className={`${config.iconClassName} ${config.spin ? "animate-spin" : ""} ${isWaiting ? "pinetree-waiting-indicator" : ""}`}
            strokeWidth={1.8}
          />
        </span>
      </div>
      <div className="space-y-0.5">
        <h1 className={labelClass}>{labelOverride || config.label}</h1>
        {showMessage ? <p className={messageClass}>{messageOverride || config.message}</p> : null}
      </div>
    </div>
  )
}
