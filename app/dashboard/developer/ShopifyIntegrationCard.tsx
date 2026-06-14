"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import {
  ShopifyIntegrationCardView,
  type ShopifyStatus,
} from "./ShopifyIntegrationCardView"

export default function ShopifyIntegrationCard() {
  const [status, setStatus] = useState<ShopifyStatus | null>(null)
  const [shop, setShop] = useState("")
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState("")

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? ""
  }, [])

  const loadStatus = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const token = await getToken()
      if (!token) throw new Error("Sign in again to manage Shopify.")
      const response = await fetch("/api/shopify/status", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      const payload = await response.json() as ShopifyStatus & { error?: string }
      if (!response.ok) throw new Error(payload.error || "Could not load Shopify status.")
      setStatus(payload)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Shopify status.")
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  async function connectShopify() {
    setWorking(true)
    setError("")
    try {
      const token = await getToken()
      if (!token) throw new Error("Sign in again to connect Shopify.")
      const response = await fetch("/api/shopify/auth", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ shop: shop.trim() }),
      })
      const payload = await response.json() as { authUrl?: string; error?: string }
      if (!response.ok || !payload.authUrl) {
        throw new Error(payload.error || "Could not start the Shopify connection.")
      }
      window.location.assign(payload.authUrl)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the Shopify connection.")
      setWorking(false)
    }
  }

  async function disconnectShopify() {
    if (!status?.shop) return
    setWorking(true)
    setError("")
    try {
      const token = await getToken()
      if (!token) throw new Error("Sign in again to disconnect Shopify.")
      const response = await fetch("/api/shopify/disconnect", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ shop: status.shop }),
      })
      const payload = await response.json() as { error?: string }
      if (!response.ok) throw new Error(payload.error || "Could not disconnect Shopify.")
      await loadStatus()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect Shopify.")
    } finally {
      setWorking(false)
    }
  }

  return (
    <ShopifyIntegrationCardView
      status={status}
      shop={shop}
      loading={loading}
      working={working}
      error={error}
      onShopChange={setShop}
      onConnect={() => void connectShopify()}
      onDisconnect={() => void disconnectShopify()}
    />
  )
}
