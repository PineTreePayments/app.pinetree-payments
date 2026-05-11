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
  iconSize?: number
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
    label: "Payment Processing",
    message: "Waiting for network confirmation.",
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
    message: "The payment was not completed.",
    iconClassName: "text-amber-600",
    iconBgClassName: "bg-amber-50",
  },
  FAILED: {
    Icon: XCircle,
    label: "Payment Failed",
    message: "The payment could not be completed.",
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
  iconSize,
  size = "default",
}: Props) {
  const normalizedStatus = normalizeStandardPaymentStatus(status)
  const config = PAYMENT_STATUS_VISUALS[normalizedStatus]
  const Icon = config.Icon

  const isCompact = size === "compact"
  const resolvedIconSize = iconSize ?? (isCompact ? 28 : 56)
  const iconPadding = isCompact ? "p-2" : "p-3"
  const gapClass = isCompact ? "gap-2" : "gap-3"
  const labelClass = isCompact ? "text-lg font-bold text-gray-900" : "text-2xl font-bold text-gray-900"
  const messageClass = isCompact ? "text-xs text-gray-500" : "text-sm text-gray-500"

  return (
    <div className={`flex flex-col items-center text-center ${gapClass} ${className}`}>
      <div className={`rounded-full ${iconPadding} ${config.iconBgClassName}`}>
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