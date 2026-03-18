"use client"

import { useEffect } from "react"

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

  if (status === "pending") {
    return <p className="text-yellow-500">Waiting for payment…</p>
  }

  if (status === "confirmed") {
    return <p className="text-green-600">Payment confirmed</p>
  }

  if (status === "error" || status === "failed") {
    return <p className="text-red-600">Payment failed</p>
  }

  return null
}