"use client"

import { useCallback, useEffect, useState } from "react"
import { ProviderStatusPill } from "@/components/dashboard/DashboardPrimitives"
import { supabase } from "@/lib/supabaseClient"

type ShopifyStatus = {
  connected: boolean
  status: "connected" | "not_connected"
  shop: string | null
  connectedAt: string | null
  updatedAt: string | null
  configured: boolean
}

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
    <div className="flex h-full flex-col rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-950">Shopify</h2>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            Connect a Shopify store to use PineTree Checkout.
          </p>
        </div>
        <ProviderStatusPill
          label={status?.connected ? "Connected" : "Not connected"}
          tone={status?.connected ? "green" : "slate"}
        />
      </div>

      {loading ? (
        <p className="mt-4 text-xs text-gray-500">Loading connection...</p>
      ) : status?.connected && status.shop ? (
        <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50/70 p-3">
          <p className="truncate text-sm font-semibold text-gray-900">{status.shop}</p>
          {status.connectedAt && (
            <p className="mt-1 text-xs text-gray-500">
              Connected {new Date(status.connectedAt).toLocaleString()}
            </p>
          )}
          <button
            type="button"
            onClick={() => void disconnectShopify()}
            disabled={working}
            className="mt-3 inline-flex min-h-9 items-center justify-center rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 transition hover:border-red-200 hover:text-red-600 disabled:opacity-60"
          >
            {working ? "Disconnecting..." : "Disconnect"}
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <input
            value={shop}
            onChange={(event) => setShop(event.target.value)}
            placeholder="mystore.myshopify.com"
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
          <button
            type="button"
            onClick={() => void connectShopify()}
            disabled={working || !shop.trim() || status?.configured === false}
            className="inline-flex min-h-9 items-center justify-center rounded-xl bg-blue-600 px-3.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {working ? "Connecting..." : "Connect Shopify"}
          </button>
          {status && !status.configured && (
            <p className="text-xs leading-5 text-amber-700">
              Shopify connections need app credentials before a store can be connected.
            </p>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-xs leading-5 text-red-600">{error}</p>}

      <details id="shopify-setup-guide" className="mt-4 border-t border-gray-100 pt-3 sm:mt-auto">
        <summary className="cursor-pointer list-none text-xs font-semibold text-blue-700">
          View setup guide
        </summary>
        <div className="mt-2 space-y-2 text-xs leading-5 text-gray-600">
          <p>Create a Shopify app, add the PineTree callback and webhook URLs, then configure the required credentials in your PineTree environment.</p>
          <p>A Shopify storefront or payment extension is still required to present PineTree Checkout to customers.</p>
        </div>
      </details>
    </div>
  )
}
