import {
  AlertTriangle,
  CheckCircle,
  CircleX,
  Clock3,
  LoaderCircle,
  XCircle,
} from "lucide-react"

export type StandardPaymentStatus =
  | "CONFIRMED"
  | "PROCESSING"
  | "PENDING"
  | "INCOMPLETE"
  | "FAILED"
  | "EXPIRED"
  | "CANCELED"

type PaymentStatusVisualConfig = {
  label: string
  message: string
  iconClassName: string
  iconBgClassName: string
  Icon: typeof CheckCircle
  spin?: boolean
}

type Props = {
  status: string
  className?: string
  showMessage?: boolean
  labelOverride?: string
  messageOverride?: string
  labelClassName?: string
  iconSize?: number
  variant?: "plain" | "card"
  /** "compact" reduces icon size and uses smaller text — suited for POS cards. */
  size?: "default" | "compact"
}

export function normalizeStandardPaymentStatus(status: string): StandardPaymentStatus {
  const normalized = String(status || "").trim().toUpperCase()

  if (normalized === "CONFIRMED") return "CONFIRMED"
  if (normalized === "PROCESSING") return "PROCESSING"
  if (normalized === "INCOMPLETE") return "INCOMPLETE"
  if (normalized === "FAILED" || normalized === "ERROR") return "FAILED"
  if (normalized === "EXPIRED") return "EXPIRED"
  if (normalized === "CANCELED" || normalized === "CANCELLED") return "CANCELED"

  return "PENDING"
}

export const PAYMENT_STATUS_VISUALS: Record<StandardPaymentStatus, PaymentStatusVisualConfig> = {
  CONFIRMED: {
    Icon: CheckCircle,
    label: "Payment Confirmed",
    message: "Your payment was received successfully.",
    iconClassName: "text-green-600",
    iconBgClassName: "bg-green-50",
  },
  PROCESSING: {
    Icon: LoaderCircle,
    label: "Waiting for Payment",
    message: "Complete the payment in your wallet.",
    iconClassName: "text-[#0052FF]",
    iconBgClassName: "bg-blue-50",
    spin: true,
  },
  PENDING: {
    Icon: LoaderCircle,
    label: "Waiting for Payment",
    message: "Complete the payment in your wallet.",
    iconClassName: "text-[#0052FF]",
    iconBgClassName: "bg-blue-50",
    spin: true,
  },
  INCOMPLETE: {
    Icon: AlertTriangle,
    label: "Payment Incomplete",
    message: "This payment was not completed.",
    iconClassName: "text-amber-600",
    iconBgClassName: "bg-amber-50",
  },
  FAILED: {
    Icon: XCircle,
    label: "Payment Failed",
    message: "This payment could not be completed.",
    iconClassName: "text-red-600",
    iconBgClassName: "bg-red-50",
  },
  EXPIRED: {
    Icon: Clock3,
    label: "Payment Expired",
    message: "This payment session has expired.",
    iconClassName: "text-gray-500",
    iconBgClassName: "bg-gray-100",
  },
  CANCELED: {
    Icon: CircleX,
    label: "Payment Canceled",
    message: "This payment was canceled.",
    iconClassName: "text-gray-500",
    iconBgClassName: "bg-gray-100",
  },
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
  const normalizedStatus = normalizeStandardPaymentStatus(status)
  const config = PAYMENT_STATUS_VISUALS[normalizedStatus]
  const Icon = config.Icon

  const isCompact = size === "compact"
  const resolvedIconSize = iconSize ?? (isCompact ? 28 : 56)
  const iconPadding = isCompact ? "p-2" : "p-3"
  const gapClass = isCompact ? "gap-2" : "gap-3"
  const isCard = variant === "card"
  const labelClass =
    labelClassName ||
    (isCard
      ? "text-xl font-semibold text-gray-950 sm:text-2xl"
      : isCompact
        ? "text-lg font-bold text-gray-900"
        : "text-2xl font-bold text-gray-900")
  const messageClass = isCard ? "text-sm leading-6 text-gray-600" : isCompact ? "text-xs text-gray-500" : "text-sm text-gray-500"
  const variantClass = isCard
    ? "w-full rounded-[1.35rem] border border-[#0052FF]/10 bg-[radial-gradient(circle_at_top_right,rgba(0,82,255,0.10),transparent_34%),linear-gradient(135deg,#ffffff_0%,#f8fbff_52%,#eef5ff_100%)] px-5 py-7 shadow-[0_18px_60px_rgba(0,82,255,0.12)] sm:px-7 sm:py-8"
    : ""
  const iconSurfaceClass = isCard ? "shadow-sm ring-1 ring-white/80" : ""

  return (
    <div className={`flex flex-col items-center text-center ${gapClass} ${variantClass} ${className}`}>
      <div className={`rounded-full ${iconPadding} ${config.iconBgClassName} ${iconSurfaceClass}`}>
        <Icon
          size={resolvedIconSize}
          className={`${config.iconClassName} ${config.spin ? "animate-spin" : ""}`}
          strokeWidth={1.8}
        />
      </div>
      <div className="space-y-0.5">
        <h1 className={labelClass}>
          {labelOverride || config.label}
        </h1>
        {showMessage ? (
          <p className={messageClass}>
            {messageOverride || config.message}
          </p>
        ) : null}
      </div>
    </div>
  )
}
