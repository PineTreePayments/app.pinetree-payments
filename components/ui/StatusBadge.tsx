import { AlertTriangle, CheckCircle, CircleMinus, Clock3, LoaderCircle, RotateCcw, XCircle } from "lucide-react"
import { getPaymentDisplayStatus, type PaymentStatusIcon } from "@/lib/utils/paymentStatus"

type Props = {
  label?: string
  status?: string | null
  classes?: string
  showIcon?: boolean
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

export default function StatusBadge({ label, status, classes, showIcon = true }: Props) {
  const display = status === undefined ? null : getPaymentDisplayStatus(status)
  const Icon = display ? STATUS_ICONS[display.icon] : null
  const resolvedLabel = display?.label || label || ""
  const resolvedClasses = classes || display?.classes || "bg-gray-100 text-gray-700"

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${resolvedClasses}`}>
      {showIcon && Icon ? (
        <Icon
          aria-hidden="true"
          className={`h-3.5 w-3.5 ${display?.spin ? "animate-spin" : ""}`}
          strokeWidth={2}
        />
      ) : null}
      {resolvedLabel}
    </span>
  )
}
