"use client"

import { useState } from "react"
import {
  Code2,
  KeyRound,
  Plug,
  Webhook,
} from "lucide-react"
import {
  DashboardSection,
  ProviderStatusPill,
  dashboardPageTitleClass,
  dashboardSupportingTextClass,
} from "@/components/dashboard/DashboardPrimitives"
import { CheckoutWorkspace } from "../checkout/page"
import PublicKeysPanel from "./PublicKeysPanel"

type DeveloperTab = "keys" | "webhooks" | "sdks" | "integrations"

const tabs: Array<{ id: DeveloperTab; label: string }> = [
  { id: "keys", label: "Keys" },
  { id: "webhooks", label: "Webhooks" },
  { id: "sdks", label: "SDKs" },
  { id: "integrations", label: "Integrations" },
]

const overviewCards = [
  {
    id: "keys" as const,
    title: "API Keys",
    description: "Manage secret server keys and public browser keys.",
    action: "Manage keys",
    icon: KeyRound,
  },
  {
    id: "webhooks" as const,
    title: "Webhooks",
    description: "Configure an endpoint, deliveries, retry, and tests.",
    action: "Manage webhooks",
    icon: Webhook,
  },
  {
    id: "sdks" as const,
    title: "SDKs",
    description: "Build with REST, Node, JavaScript, or React.",
    action: "View SDKs",
    icon: Code2,
  },
  {
    id: "integrations" as const,
    title: "Integrations",
    description: "Connect PineTree to supported commerce platforms.",
    action: "View integrations",
    icon: Plug,
  },
]

export default function DeveloperPage() {
  const [tab, setTab] = useState<DeveloperTab>("keys")

  return (
    <div className="space-y-5 md:space-y-7">
      <div>
        <h1 className={dashboardPageTitleClass}>Developer</h1>
        <p className={`mt-2 ${dashboardSupportingTextClass}`}>
          Manage API keys, webhooks, SDKs, and integrations.
        </p>
      </div>

      <DashboardSection title="Developer tools" titleTone="blue">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {overviewCards.map(({ id, title, description, action, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className="rounded-2xl border border-gray-200/80 bg-white p-4 text-left shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition hover:border-blue-200 hover:shadow-[0_14px_36px_rgba(37,99,235,0.10)] focus:outline-none focus:ring-4 focus:ring-blue-100"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                <Icon className="h-4 w-4" />
              </div>
              <h2 className="mt-3 text-sm font-semibold text-gray-950">{title}</h2>
              <p className="mt-1 text-xs leading-5 text-gray-500">{description}</p>
              <span className="mt-3 inline-flex text-xs font-semibold text-blue-700">{action}</span>
            </button>
          ))}
        </div>
      </DashboardSection>

      <div className="overflow-x-auto pb-1">
        <div className="inline-flex min-w-max gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`min-h-9 rounded-lg px-3.5 text-sm font-semibold transition focus:outline-none focus:ring-4 focus:ring-blue-100 ${
                tab === item.id
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "keys" && (
        <div className="space-y-5 md:space-y-7">
          <DashboardSection title="Getting Started" titleTone="blue">
            <div className="rounded-2xl border border-gray-200/80 bg-white px-4 py-3 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <div className="grid gap-3 sm:grid-cols-3 sm:divide-x sm:divide-gray-100">
                {[
                  ["1", "Create keys"],
                  ["2", "Choose REST or an SDK"],
                  ["3", "Configure webhooks"],
                ].map(([step, label]) => (
                  <div key={step} className="flex items-center gap-3 sm:px-4 sm:first:pl-0">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">{step}</span>
                    <p className="text-sm font-medium text-gray-800">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          </DashboardSection>

          <div className="rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-gray-700">
            <code className="font-mono text-xs font-semibold text-blue-800">pt_live_*</code>
            {" "}is server-side only.{" "}
            <code className="font-mono text-xs font-semibold text-blue-800">pk_live_*</code>
            {" "}is browser-safe and limited to checkout session creation.
          </div>

          <CheckoutWorkspace
            mode="developer"
            showHeader={false}
            showNavigation={false}
            activeSection="developer"
            compactDeveloper
          />
          <PublicKeysPanel />
        </div>
      )}

      {tab === "webhooks" && (
        <CheckoutWorkspace
          mode="developer"
          showHeader={false}
          showNavigation={false}
          activeSection="webhooks"
          compactDeveloper
        />
      )}

      {tab === "sdks" && <SdkCards />}
      {tab === "integrations" && <IntegrationCards />}
    </div>
  )
}

function SdkCards() {
  const cards = [
    {
      title: "REST API",
      status: "Live",
      tone: "green" as const,
      purpose: "Create and manage checkout sessions directly over HTTP.",
      setup: "Use Authorization: Bearer pt_live_* with /api/v1.",
    },
    {
      title: "Node SDK",
      status: "Private Beta",
      tone: "amber" as const,
      purpose: "Server-side checkout sessions, payments, and webhook verification.",
      setup: "Package: @pinetree/node",
    },
    {
      title: "JavaScript SDK",
      status: "Preview",
      tone: "blue" as const,
      purpose: "Open hosted checkout from browser applications with a public key.",
      setup: "Package: @pinetree/js",
    },
    {
      title: "React SDK",
      status: "Private Beta",
      tone: "blue" as const,
      purpose: "React provider, hooks, checkout button, and embedded checkout.",
      setup: "Package: @pinetree/react",
    },
  ]

  return (
    <DashboardSection title="SDKs & API" titleTone="blue">
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <details key={card.title} className="group rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
            <summary className="cursor-pointer list-none">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-gray-950">{card.title}</h2>
                  <p className="mt-1 text-xs leading-5 text-gray-500">{card.purpose}</p>
                </div>
                <ProviderStatusPill label={card.status} tone={card.tone} />
              </div>
              <span className="mt-3 inline-flex text-xs font-semibold text-blue-700 group-open:hidden">View setup</span>
            </summary>
            <div className="mt-3 border-t border-gray-100 pt-3">
              <p className="text-xs text-gray-600">{card.setup}</p>
            </div>
          </details>
        ))}
      </div>
    </DashboardSection>
  )
}

function IntegrationCards() {
  return (
    <DashboardSection title="Commerce integrations" titleTone="blue">
      <div className="grid gap-3 sm:grid-cols-2">
        <IntegrationCard
          title="WooCommerce"
          description="Accept PineTree payments in WooCommerce stores."
          status="Private Beta"
          tone="blue"
        />
        <ShopifyIntegrationCard />
      </div>
    </DashboardSection>
  )
}

function IntegrationCard({
  title,
  description,
  status,
  tone,
}: {
  title: string
  description: string
  status: string
  tone: "blue" | "slate" | "amber"
}) {
  return (
    <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-950">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-gray-500">{description}</p>
        </div>
        <ProviderStatusPill label={status} tone={tone} />
      </div>
    </div>
  )
}

function ShopifyIntegrationCard() {
  const done = [
    "HMAC verification (webhooks + OAuth callback)",
    "OAuth initiation with CSRF state cookie",
    "CSRF state cookie verification in callback",
    "AES-256-GCM token encryption utility",
    "Authorization code → access token exchange",
    "Webhook receiver with topic dispatch stubs",
    "Database migration (shopify_connections)",
    "Safe disconnect route stub",
    "Connection status route stub",
  ]
  const required = [
    "Merchant session lookup in OAuth callback",
    "Actual DB persistence (shopify_connections INSERT)",
    "Webhook handlers → checkout session status updates",
    "Merchant API key injection in /api/shopify/session",
    "Shopify checkout extension (storefront-side component)",
    "End-to-end private install test with a real Shopify store",
  ]

  return (
    <details className="group rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
      <summary className="cursor-pointer list-none">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-950">Shopify</h2>
            <p className="mt-1 text-xs leading-5 text-gray-500">
              Private OAuth app foundation — not yet end-to-end usable.
            </p>
          </div>
          <ProviderStatusPill label="Foundation" tone="amber" />
        </div>
        <span className="mt-3 inline-flex text-xs font-semibold text-blue-700 group-open:hidden">
          View status
        </span>
      </summary>

      <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
        <div>
          <p className="mb-1.5 text-xs font-semibold text-gray-700">Done</p>
          <ul className="space-y-1">
            {done.map((item) => (
              <li key={item} className="flex items-start gap-2 text-xs text-gray-600">
                <span className="mt-px shrink-0 text-emerald-500">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-gray-700">Required before Private Beta</p>
          <ul className="space-y-1">
            {required.map((item) => (
              <li key={item} className="flex items-start gap-2 text-xs text-gray-500">
                <span className="mt-px shrink-0 text-gray-300">○</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-gray-400">
          See <code className="font-mono">integrations/shopify/README.md</code> for the full checklist.
        </p>
      </div>
    </details>
  )
}
