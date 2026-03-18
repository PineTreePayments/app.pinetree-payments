"use client"

import { useState, useEffect } from "react"
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

  const [taxAmount, setTaxAmount] = useState(0)
  const [total, setTotal] = useState(0)

  /* LOAD TAX SETTINGS */

  async function loadTaxSettings() {

    try {

      const { data: { user } } = await supabase.auth.getUser()

      if (!user) return

      const { data } = await supabase
        .from("merchant_tax_settings")
        .select("*")
        .eq("merchant_id", user.id)
        .single()

      if (data) {

        setTaxEnabled(data.tax_enabled)
        setTaxRate(Number(data.tax_rate))

      }

    } catch (err) {

      console.error("Failed to load tax settings:", err)

    }

  }

  /* CALCULATE TAX */

  useEffect(() => {

    const numericAmount = Number(amount || 0)

    if (!taxEnabled) {

      setTaxAmount(0)
      setTotal(numericAmount)

      return

    }

    const tax = numericAmount * (taxRate / 100)

    setTaxAmount(tax)
    setTotal(numericAmount + tax)

  }, [amount, taxRate, taxEnabled])

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

      const res = await fetch("/api/payments/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          amount: total,   // CHARGE TOTAL INCLUDING TAX
          currency: "USD",
          merchantId: "demo-merchant"
        })
      })

      const data = await res.json()

      if (data?.payment) {

        setPaymentId(data.payment.id)

        if (data.payment.qrCode) {
          setQrUrl(data.payment.qrCode)
        }

        if (data.payment.paymentUrl) {
          setQrUrl(data.payment.paymentUrl)
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

    setTaxAmount(0)
    setTotal(0)

    setStatus("idle")

  }

  /* REALTIME PAYMENT STATUS */

  useEffect(() => {

    if (!paymentId) return

    const channel = supabase
      .channel("payment-status")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "payments",
          filter: `id=eq.${paymentId}`
        },
        payload => {

          const newStatus = payload.new.status

          if (newStatus === "confirmed") {
            setStatus("confirmed")
          }

          if (newStatus === "failed") {
            setStatus("error")
          }

        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }

  }, [paymentId])

  /* LOAD TAX SETTINGS ON START */

  useEffect(() => {

    loadTaxSettings()

  }, [])

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