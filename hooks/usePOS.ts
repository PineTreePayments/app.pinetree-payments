"use client"

import { useMemo, useState, useEffect, useCallback } from "react"
import { supabase } from "@/database/supabase"
import { AUTO_POLLING_ENABLED } from "@/lib/utils/polling"

type Status =
  | "idle"
  | "confirm"
  | "creating"
  | "pending"
  | "confirmed"
  | "error"

export function usePOS() {

  const [amount, setAmount] = useState<string>("")

  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [paymentId, setPaymentId] = useState<string | null>(null)

  const [status, setStatus] = useState<Status>("idle")

  /* TAX SETTINGS */

  const [taxEnabled, setTaxEnabled] = useState(false)
  const [taxRate, setTaxRate] = useState(0)
  const [breakdown, setBreakdown] = useState<{
    subtotalAmount: number
    taxAmount: number
    serviceFee: number
    grossAmount: number
    totalAmount: number
  } | null>(null)

  const numericAmount = Number(amount || 0)

  /* LOAD TAX SETTINGS */

  const loadTaxSettings = useCallback(async () => {
    try {
      const {
        data: { user }
      } = await supabase.auth.getUser()

      if (!user) return

      const qs = new URLSearchParams({ merchantId: user.id })
      const res = await fetch(`/api/pos/payment?${qs.toString()}`, {
        cache: "no-store"
      })
      const payload = await res.json().catch(() => null)

      if (res.ok && payload?.tax) {
        setTaxEnabled(Boolean(payload.tax.taxEnabled))
        setTaxRate(Number(payload.tax.taxRate || 0))
      }
    } catch (err) {
      console.error("Failed to load tax settings:", err)
    }
  }, [])

  /* CONFIRM AMOUNT */

  function confirmAmount() {

    if (!amount) return

    setStatus("confirm")

  }

  /* CREATE PAYMENT */

  async function createCharge() {

    if (!amount) return

    try {

      setStatus("creating")

      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        setStatus("error")
        return
      }

      const res = await fetch("/api/pos/payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          amount: numericAmount,
          currency: "USD",
          terminal: {
            merchantId: user.id,
            provider: "solana"
          }
        })
      })

      const data = await res.json()

      if (data?.paymentId) {

        setPaymentId(data.paymentId)

        if (data.qrCodeUrl) {
          setQrUrl(data.qrCodeUrl)
        }

        if (data.paymentUrl) {
          setQrUrl(data.paymentUrl)
        }

        // Store breakdown from API response
        if (data.breakdown) {
          setBreakdown({
            subtotalAmount: Number(data.breakdown.subtotalAmount || 0),
            taxAmount: Number(data.breakdown.taxAmount || 0),
            serviceFee: Number(data.breakdown.serviceFee || 0),
            grossAmount: Number(data.breakdown.grossAmount || 0),
            totalAmount: Number(data.breakdown.totalAmount || 0)
          })
        }

        setStatus("pending")

      } else {

        setStatus("error")

      }

    } catch (err) {

      console.error("Charge creation failed:", err)
      setStatus("error")

    }

  }

  /* RESET POS */

  function resetPOS() {

    setAmount("")
    setQrUrl(null)
    setPaymentId(null)

    setStatus("idle")

  }

/* REALTIME PAYMENT STATUS */

useEffect(() => {

  if (!paymentId) return
  if (status !== "pending") return
  if (!AUTO_POLLING_ENABLED) return

  let stopped = false
  let pollingInterval: NodeJS.Timeout

  async function pollPaymentStatus() {
    try {
      const res = await fetch(`/api/payments/${paymentId}`, {
        cache: "no-store"
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok || !payload || stopped) return

      const remoteStatus = String(payload.status || "").toUpperCase()
      if (remoteStatus === "CREATED" || remoteStatus === "PENDING") {
        return
      }

      if (remoteStatus === "CONFIRMED") {
        setStatus("confirmed")
      }

      if (
        remoteStatus === "FAILED" ||
        remoteStatus === "EXPIRED" ||
        remoteStatus === "INCOMPLETE"
      ) {
        setStatus("error")
      }

      // Stop polling when payment reaches terminal state
      if (["CONFIRMED", "FAILED", "INCOMPLETE"].includes(remoteStatus)) {
        stopped = true
        clearInterval(pollingInterval)
      }
    } catch {
      // ignore transient polling errors
    }
  }

  pollPaymentStatus()
  pollingInterval = setInterval(pollPaymentStatus, 3000)

  return () => {
    stopped = true
    clearInterval(pollingInterval)
  }

}, [paymentId, status])

  /* LOAD TAX SETTINGS ON START */

  useEffect(() => {
    queueMicrotask(() => {
      void loadTaxSettings()
    })
  }, [loadTaxSettings])

  return {

    amount,
    setAmount,

    taxEnabled,
    taxRate,
    taxAmount: breakdown?.taxAmount ?? 0,
    total: breakdown?.grossAmount ?? 0,
    breakdown,

    qrUrl,
    createCharge,
    confirmAmount,

    status,
    resetPOS

  }

}