"use client"

import { useEffect } from "react"
import { PaymentStatusVisual } from "@/components/payment/PaymentStatusVisual"

export default function TransactionStatus({
  status,
  resetPOS
}: {
  status: string
  resetPOS: () => void
}) {

  useEffect(() => {

    if (status === "confirmed") {
      const timer = setTimeout(() => {
        resetPOS()
      }, 3000)

      return () => clearTimeout(timer)
    }

  }, [status, resetPOS])

  if (status === "pending" || status === "waiting") {
    return <PaymentStatusVisual status="PENDING" iconSize={34} />
  }

  if (status === "confirmed") {
    return <PaymentStatusVisual status="CONFIRMED" iconSize={34} />
  }

  if (status === "error" || status === "failed") {
    return <PaymentStatusVisual status="FAILED" iconSize={34} />
  }

  if (status === "incomplete") {
    return <PaymentStatusVisual status="INCOMPLETE" iconSize={34} />
  }

  if (status === "expired") {
    return <PaymentStatusVisual status="EXPIRED" iconSize={34} />
  }

  return null
}