"use client"

import { useState } from "react"
import { ProviderStatusPill } from "@/components/dashboard/DashboardPrimitives"
import { supabase } from "@/lib/supabaseClient"

const WEBHOOK_FORMAT = "/?wc-api=pinetree_webhook"

const setupSteps = [
  "Download the PineTree WooCommerce plugin from this dashboard.",
  "Install and activate it in a WooCommerce test store.",
  "Add a PineTree secret API key in the payment settings.",
  "Add the webhook signing secret.",
  {
    text: "Copy the webhook URL shown in WooCommerce settings into PineTree Developer → Webhooks.",
    note: WEBHOOK_FORMAT,
  },
  "Place a test order with PineTree selected at checkout.",
  "Confirm the checkout redirect opens PineTree Checkout.",
  "Confirm the signed webhook updates the WooCommerce order.",
  "Confirm that resending the same webhook event does not duplicate notes or status changes.",
  "Use Manual sync on the order if a delivery needs to be refreshed.",
]

export default function WooCommerceIntegrationCard() {
  const [copied, setCopied] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState("")

  function copyWebhookFormat() {
    void navigator.clipboard.writeText(WEBHOOK_FORMAT).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  async function downloadPlugin() {
    setDownloading(true)
    setDownloadError("")
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token ?? ""
      if (!token) throw new Error("Sign in again to download the plugin.")
      const response = await fetch("/api/woocommerce/plugin/download", {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string }
        throw new Error(payload.error ?? "Plugin download failed.")
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "pinetree-woocommerce.zip"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : "Plugin download failed.")
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-950">WooCommerce</h2>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            Install the PineTree WooCommerce plugin in a test store to validate checkout and webhooks.
          </p>
        </div>
        <ProviderStatusPill label="Not connected" tone="slate" />
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => void downloadPlugin()}
          disabled={downloading}
          className="inline-flex min-h-9 items-center justify-center rounded-xl bg-blue-600 px-3.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {downloading ? "Downloading..." : "Download plugin"}
        </button>
        {downloadError && (
          <p className="mt-2 text-xs leading-5 text-red-600">{downloadError}</p>
        )}
      </div>

      <details id="woocommerce-setup-guide" className="mt-auto border-t border-gray-100 pt-3">
        <summary className="cursor-pointer list-none text-xs font-semibold text-blue-700">
          View setup guide
        </summary>
        <ol className="mt-3 space-y-2 pl-4 text-xs leading-5 text-gray-600">
          {setupSteps.map((step, i) => {
            if (typeof step === "string") {
              return (
                <li key={i} className="list-decimal pl-1">
                  {step}
                </li>
              )
            }
            return (
              <li key={i} className="list-decimal pl-1">
                {step.text}{" "}
                <span className="inline-flex items-center gap-1">
                  <code className="font-mono text-[10px] text-gray-800">{step.note}</code>
                  <button
                    type="button"
                    onClick={copyWebhookFormat}
                    className="text-[10px] font-semibold text-blue-600 hover:text-blue-700"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </span>
              </li>
            )
          })}
        </ol>
      </details>
    </div>
  )
}
