"use client"

import Link from "next/link"
import {
  DashboardSection,
  dashboardPageTitleClass,
  dashboardSupportingTextClass,
} from "@/components/dashboard/DashboardPrimitives"

export default function DeveloperGuidesPage() {
  return (
    <div className="space-y-5 md:space-y-7">
      <div>
        <Link href="/dashboard/developer" className="text-sm font-semibold text-blue-700 hover:text-blue-800">
          Back to Developer
        </Link>
        <h1 className={`mt-2 ${dashboardPageTitleClass}`}>Developer Guides</h1>
        <p className={`mt-1 max-w-2xl ${dashboardSupportingTextClass}`}>
          API references, quickstarts, webhook events, and go-live guidance.
        </p>
      </div>

      <DashboardSection title="Quickstart" titleTone="blue">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["1", "Create keys", "Create a secret API key for your server and a public key only for browser checkout."],
            ["2", "Build checkout", "Create checkout sessions server-side, redirect customers, and keep secret keys out of frontend code."],
            ["3", "Configure webhooks", "Add an HTTPS endpoint, select events, and verify signatures before fulfillment."],
          ].map(([step, title, detail]) => (
            <div key={step} className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">{step}</span>
              <h2 className="mt-3 text-sm font-semibold text-gray-950">{title}</h2>
              <p className="mt-1 text-xs leading-5 text-gray-500">{detail}</p>
            </div>
          ))}
        </div>
      </DashboardSection>

      <DashboardSection title="Reference" titleTone="blue">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["API keys", "Secret and public-key usage.", "/dashboard/developer/api-keys"],
            ["Webhooks", "Endpoint setup, events, delivery history, and retries.", "/dashboard/developer/webhooks"],
            ["SDKs", "Package names and installation commands.", "/dashboard/developer/sdks"],
            ["Payment states", "CREATED, PENDING, PROCESSING, CONFIRMED, FAILED, and INCOMPLETE.", "/dashboard/help"],
            ["Go live", "Validate keys, webhooks, payment flows, and environment readiness.", "/dashboard/help"],
            ["Support", "Find integration help and troubleshooting material.", "/dashboard/help"],
          ].map(([title, detail, href]) => (
            <Link key={title} href={href} className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition hover:border-blue-200 hover:bg-blue-50/30">
              <h2 className="text-sm font-semibold text-gray-950">{title}</h2>
              <p className="mt-1 text-xs leading-5 text-gray-500">{detail}</p>
              <span className="mt-3 inline-flex text-xs font-semibold text-blue-700">Open</span>
            </Link>
          ))}
        </div>
      </DashboardSection>
    </div>
  )
}
