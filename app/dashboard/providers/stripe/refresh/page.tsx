"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabaseClient"

export default function StripeConnectRefreshPage() {
  const [errorMessage, setErrorMessage] = useState("")

  useEffect(() => {
    async function restart() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token

        if (!token) {
          setErrorMessage("Please sign in to continue your Stripe setup.")
          return
        }

        const res = await fetch("/api/providers/stripe/connect/start", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
          cache: "no-store"
        })

        const payload = await res.json().catch(() => null)

        if (!res.ok || !payload?.url) {
          setErrorMessage(
            payload?.error || "Failed to create a new setup link. Please return to Providers and try again."
          )
          return
        }

        window.location.assign(String(payload.url))
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Unexpected error refreshing Stripe setup.")
      }
    }

    void restart()
  }, [])

  if (errorMessage) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm text-center space-y-4">
          <h1 className="text-lg font-semibold text-gray-950">Setup Link Expired</h1>
          <p className="text-sm leading-5 text-gray-600">{errorMessage}</p>
          <Link
            href="/dashboard/providers"
            className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
          >
            Back to Providers
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm text-center space-y-3">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        <p className="text-sm font-medium text-gray-600">Refreshing your Stripe setup link…</p>
      </div>
    </div>
  )
}
