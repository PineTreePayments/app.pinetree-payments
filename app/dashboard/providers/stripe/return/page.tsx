"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabaseClient"

type SyncStatus = "loading" | "connected" | "pending" | "error"

export default function StripeConnectReturnPage() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("loading")
  const [errorMessage, setErrorMessage] = useState("")

  useEffect(() => {
    async function syncAccount() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token

        if (!token) {
          setErrorMessage("Please sign in to continue.")
          setSyncStatus("error")
          return
        }

        const res = await fetch("/api/providers/stripe/connect/sync", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          credentials: "include",
          cache: "no-store"
        })

        const payload = await res.json().catch(() => null)

        if (!res.ok || !payload?.ok) {
          setErrorMessage(payload?.error || "Failed to update Stripe account status.")
          setSyncStatus("error")
          return
        }

        setSyncStatus(payload.readyForPayments ? "connected" : "pending")
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Unexpected error updating Stripe status.")
        setSyncStatus("error")
      }
    }

    void syncAccount()
  }, [])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        {syncStatus === "loading" && (
          <div className="space-y-3 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <p className="text-sm font-medium text-gray-600">Updating your Stripe account status…</p>
          </div>
        )}

        {syncStatus === "connected" && (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
              <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-950">Stripe Connected</h1>
              <p className="mt-1 text-sm leading-5 text-gray-600">
                Your Stripe account is connected and ready to accept payments.
              </p>
            </div>
            <Link
              href="/dashboard/providers"
              className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              Back to Providers
            </Link>
          </div>
        )}

        {syncStatus === "pending" && (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
              <svg className="h-6 w-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-950">Stripe Setup Received</h1>
              <p className="mt-1 text-sm leading-5 text-gray-600">
                Your Stripe account is pending review. PineTree will update your provider status once Stripe completes verification.
              </p>
            </div>
            <Link
              href="/dashboard/providers"
              className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
            >
              Back to Providers
            </Link>
          </div>
        )}

        {syncStatus === "error" && (
          <div className="space-y-4 text-center">
            <div>
              <h1 className="text-lg font-semibold text-gray-950">Setup Update Failed</h1>
              <p className="mt-1 text-sm leading-5 text-gray-600">{errorMessage}</p>
            </div>
            <Link
              href="/dashboard/providers"
              className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
            >
              Back to Providers
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
