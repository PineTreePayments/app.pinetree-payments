"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/database/supabase"

interface WalletBalance {
  id: string
  merchant_id: string
  asset: string
  balance: number
  last_updated: string
}

export function useWalletBalances() {
  const [balances, setBalances] = useState<WalletBalance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  async function fetchBalances() {
    try {
      setLoading(true)
      
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        setBalances([])
        return
      }

      const { data, error: fetchError } = await supabase
        .from("wallet_balances")
        .select("*")
        .eq("merchant_id", user.id)
        .order("asset", { ascending: true })

      if (fetchError) throw fetchError

      setBalances(data || [])
      setError(null)

    } catch (err) {
      setError(err as Error)
      console.error("Failed to load wallet balances:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchBalances()

    // Auto refresh balances every 30 seconds
    const interval = setInterval(fetchBalances, 30000)

    return () => clearInterval(interval)
  }, [])

  return {
    balances,
    loading,
    error,
    refresh: fetchBalances
  }
}