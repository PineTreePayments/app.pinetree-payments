"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"

type ReadinessResponse = {
  ok?: boolean
  data?: {
    authenticated: boolean
    processingEnabled: boolean
    flags: { restApi: boolean }
    capabilities: Record<string, { state: string; ready: boolean; reason: string }>
  }
}

export default function Shift4RestReadinessCard() {
  const [readiness, setReadiness] = useState<ReadinessResponse["data"] | null>(null)
  useEffect(() => {
    let active = true
    void (async () => {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) return
      const response = await fetch("/api/internal/shift4/readiness", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" })
      const body = await response.json().catch(() => null) as ReadinessResponse | null
      if (active && response.ok && body?.data?.flags.restApi) setReadiness(body.data)
    })()
    return () => { active = false }
  }, [])
  if (!readiness) return null
  const capabilities = ["merchant_authentication", "ecommerce", "retail", "manual_authorization", "partial_approval", "split_tender", "apple_pay", "google_pay", "terminal", "certification", "production_processing"]
  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-gray-950">Shift4 REST readiness</p>
          <p className="mt-1 text-xs text-gray-600">Connected credentials do not imply certified payment processing.</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${readiness.processingEnabled ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
          {readiness.processingEnabled ? "Enabled" : "Not enabled"}
        </span>
      </div>
      <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {capabilities.map((name) => {
          const item = readiness.capabilities[name]
          return item ? (
            <div key={name} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{name.replaceAll("_", " ")}</dt>
              <dd className={`mt-1 text-sm font-medium ${item.ready ? "text-emerald-700" : "text-gray-700"}`}>{item.state.replaceAll("_", " ")}</dd>
            </div>
          ) : null
        })}
      </dl>
    </div>
  )
}
