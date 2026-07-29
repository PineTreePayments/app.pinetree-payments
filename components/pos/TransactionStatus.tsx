"use client"

import { TransactionResult } from "@/components/payment/TransactionResult"

export default function TransactionStatus({
  status,
  resetPOS
}: {
  status: string
  resetPOS: () => void
}) {

  if (status === "pending" || status === "waiting") {
    return <TransactionResult state="PENDING" compact />
  }

  if (status === "processing") {
    return <TransactionResult state="PROCESSING" compact />
  }

  if (status === "confirmed") {
    return <TransactionResult state="CONFIRMED" compact actions={[{ label: "New Sale", onClick: resetPOS }]} />
  }

  if (status === "error" || status === "failed") {
    return <TransactionResult state="FAILED" compact actions={[{ label: "New Sale", onClick: resetPOS }]} />
  }

  if (status === "incomplete") {
    return <TransactionResult state="INCOMPLETE" compact actions={[{ label: "New Sale", onClick: resetPOS }]} />
  }

  if (status === "expired") {
    return <TransactionResult state="EXPIRED" compact actions={[{ label: "New Sale", onClick: resetPOS }]} />
  }

  if (status === "canceled" || status === "cancelled") {
    return <TransactionResult state="CANCELED" compact actions={[{ label: "New Sale", onClick: resetPOS }]} />
  }

  if (status === "refunded") {
    return <TransactionResult state="REFUNDED" compact actions={[{ label: "New Sale", onClick: resetPOS }]} />
  }

  return null
}
