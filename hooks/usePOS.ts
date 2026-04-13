"use client"

import { useEffect, useState, useCallback } from "react"

export function usePOS(user: any) {
  const [taxRate, setTaxRate] = useState(0)
  const [taxEnabled, setTaxEnabled] = useState(false)
  const [loadingSettings, setLoadingSettings] = useState(true)

  const [paymentId, setPaymentId] = useState<string | null>(null)
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null)

  /* =========================
     LOAD MERCHANT SETTINGS (ONCE)
  ========================= */

  const loadSettings = useCallback(async () => {
    if (!user?.id) return

    try {
      const res = await fetch(
        `/api/merchant/settings?merchantId=${user.id}`,
        { cache: "no-store" }
      )

      const data = await res.json()

      if (data?.settings) {
        setTaxRate(data.settings.tax_rate || 0)
        setTaxEnabled(data.settings.tax_enabled || false)
      }
    } catch (err) {
      console.error("Failed to load settings", err)
    } finally {
      setLoadingSettings(false)
    }
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return
    loadSettings()
  }, [user?.id, loadSettings])

  /* =========================
     PAYMENT POLLING (CONTROLLED)
  ========================= */

  useEffect(() => {
    if (!paymentId) return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/payments/${paymentId}`, {
          cache: "no-store"
        })

        const data = await res.json()

        if (!data?.payment) return

        setPaymentStatus(data.payment.status)

        if (
          data.payment.status === "CONFIRMED" ||
          data.payment.status === "FAILED" ||
          data.payment.status === "INCOMPLETE"
        ) {
          clearInterval(interval)
        }
      } catch (err) {
        console.error("Polling error", err)
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [paymentId])

  return {
    taxRate,
    taxEnabled,
    loadingSettings,
    paymentId,
    setPaymentId,
    paymentStatus
  }
}