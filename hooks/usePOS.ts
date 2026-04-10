"use client"

import { useMemo, useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/database/supabase"

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

  const numericAmount = Number(amount || 0)

  const taxAmount = useMemo(() => {
    if (!taxEnabled) return 0
    return numericAmount * (taxRate / 100)
  }, [numericAmount, taxEnabled, taxRate])

  const total = useMemo(() => numericAmount + taxAmount, [numericAmount, taxAmount])

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

    let stopped = false

    async function pollPaymentStatus() {
      try {
        const qs = new URLSearchParams({ mode: "status", paymentId })
        const res = await fetch(`/api/pos/payment?${qs.toString()}`, {
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
      } catch {
        // ignore transient polling errors
      }
    }

    pollPaymentStatus()
    const interval = setInterval(pollPaymentStatus, 2000)

    return () => {
      stopped = true
      clearInterval(interval)
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
    taxAmount,
    total,

    qrUrl,
    createCharge,
    confirmAmount,

    status,
    resetPOS

  }

}