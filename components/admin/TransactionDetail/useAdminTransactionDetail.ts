"use client"

/**
 * The ONE admin transaction-detail data path.
 *
 * Every admin surface opens a transaction through this hook, so there is a
 * single fetch, a single error path and a single response shape. Surfaces own
 * only the click that calls `open(paymentId)`.
 */

import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabaseClient"
import type { AdminTransactionDetail } from "./types"

export type AdminTransactionDetailController = {
  /** Payment currently opened, or null when the panel is closed. */
  paymentId: string | null
  detail: AdminTransactionDetail | null
  loading: boolean
  error: string | null
  open: (paymentId: string) => void
  close: () => void
}

const LOAD_ERROR = "Failed to load transaction detail"

export function useAdminTransactionDetail(): AdminTransactionDetailController {
  const [paymentId, setPaymentId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminTransactionDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Guards a slow response for a payment the operator already navigated away
  // from: only the newest request may write state.
  const requestRef = useRef(0)

  const close = useCallback(() => {
    requestRef.current += 1
    setPaymentId(null)
    setDetail(null)
    setError(null)
    setLoading(false)
  }, [])

  const open = useCallback((id: string) => {
    const nextId = String(id || "").trim()
    if (!nextId) return

    const requestId = requestRef.current + 1
    requestRef.current = requestId

    setPaymentId(nextId)
    setDetail(null)
    setError(null)
    setLoading(true)

    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (requestRef.current !== requestId) return
        if (!session?.access_token) {
          setError("Sign in again to view this transaction")
          setLoading(false)
          return
        }

        const res = await fetch(`/api/admin/transactions/${encodeURIComponent(nextId)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (requestRef.current !== requestId) return

        if (!res.ok) {
          setError(res.status === 404 ? "Transaction not found" : LOAD_ERROR)
          toast.error(LOAD_ERROR)
          setLoading(false)
          return
        }

        const data = (await res.json()) as AdminTransactionDetail
        if (requestRef.current !== requestId) return
        setDetail(data)
      } catch {
        if (requestRef.current !== requestId) return
        setError(LOAD_ERROR)
        toast.error(LOAD_ERROR)
      } finally {
        if (requestRef.current === requestId) setLoading(false)
      }
    })()
  }, [])

  return { paymentId, detail, loading, error, open, close }
}
