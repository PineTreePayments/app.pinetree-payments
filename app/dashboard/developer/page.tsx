"use client"

import { useState } from "react"
import type { ReactNode } from "react"
import { Code2, KeyRound, Plug, Webhook } from "lucide-react"
import {
  DashboardSection,
  ProviderStatusPill,
  dashboardPageTitleClass,
  dashboardSupportingTextClass,
} from "@/components/dashboard/DashboardPrimitives"
import { CheckoutWorkspace } from "../checkout/page"
import PublicKeysPanel from "./PublicKeysPanel"
import ShopifyIntegrationCard from "./ShopifyIntegrationCard"

type DeveloperTab = "keys" | "webhooks" | "sdks" | "integrations"

const overviewCards = [
  {
    id: "keys" as const,
    title: "API Keys",
    description: "Server and browser keys.",
    action: "Manage keys",
    icon: KeyRound,
  },
  {
    id: "webhooks" as const,
    title: "Webhooks",
    description: "Delivery settings and retries.",
    action: "Manage webhooks",
    icon: Webhook,
  },
  {
    id: "sdks" as const,
    title: "SDKs",
    description: "REST, Node, JavaScript, and React.",
    action: "View SDKs",
    icon: Code2,
  },
  {
    id: "integrations" as const,
    title: "Integrations",
    description: "Commerce platform connections.",
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
        <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
          {overviewCards.map(({ id, title, description, action, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={`min-h-28 rounded-2xl border p-3 text-left shadow-[0_8px_24px_rgba(15,23,42,0.04)] transition sm:min-h-0 sm:p-3.5 ${
                tab === id
                  ? "border-blue-200 bg-blue-50/60"
                  : "border-gray-200/80 bg-white hover:border-blue-200 hover:bg-blue-50/30"
              } focus:outline-none focus:ring-4 focus:ring-blue-100`}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                <Icon className="h-3.5 w-3.5" />
              </div>
              <h2 className="mt-2.5 text-sm font-semibold text-gray-950">{title}</h2>
              <p className="mt-0.5 text-[11px] leading-4 text-gray-500 sm:text-xs">{description}</p>
              <span className="mt-2 inline-flex text-[11px] font-semibold text-blue-700">{action}</span>
            </button>
          ))}
        </div>
      </DashboardSection>

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

          <div className="grid gap-2 rounded-2xl border border-blue-100 bg-blue-50/60 p-3 sm:grid-cols-2 sm:p-4">
            <KeyHelper title="Secret API keys" prefix="pt_live_*">
              Use these only on your server. They can create sessions, retrieve payments, and manage webhooks.
            </KeyHelper>
            <KeyHelper title="Public browser keys" prefix="pk_live_*">
              Use these on websites, checkout buttons, or React apps. They can start customer checkout sessions but cannot access private account data.
            </KeyHelper>
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

function KeyHelper({
  title,
  prefix,
  children,
}: {
  title: string
  prefix: string
  children: ReactNode
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-900">
        {title} <code className="font-mono text-[11px] text-blue-800">{prefix}</code>
      </p>
      <p className="mt-1 text-xs leading-5 text-gray-600">{children}</p>
    </div>
  )
}

function SdkCards() {
  const cards = [
    {
      title: "REST API",
      status: "Ready",
      tone: "green" as const,
      purpose: "Connect directly from your server.",
      setup: "Use a secret API key from your server.",
    },
    {
      title: "Node SDK",
      status: "Ready",
      tone: "green" as const,
      purpose: "Server tools for checkout and webhooks.",
      setup: "Package: @pinetree/node",
    },
    {
      title: "JavaScript SDK",
      status: "Ready",
      tone: "green" as const,
      purpose: "Start checkout from a website.",
      setup: "Package: @pinetree/js",
    },
    {
      title: "React SDK",
      status: "Ready",
      tone: "green" as const,
      purpose: "Add checkout to a React app.",
      setup: "Package: @pinetree/react",
    },
  ]

  return (
    <DashboardSection title="SDKs & API" titleTone="blue">
      <div className="mb-3 rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm text-gray-700">
        Packages are ready for release; npm publication pending.
      </div>
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
          description="Install the private plugin in a WooCommerce test store to validate checkout and webhooks."
          status="Ready for install testing"
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
