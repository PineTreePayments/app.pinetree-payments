"use client"

import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { Activity, BookOpen, Code2, KeyRound, Plug, Webhook } from "lucide-react"
import {
  DashboardSection,
  ProviderStatusPill,
  dashboardCardTitleClass,
  dashboardPageTitleClass,
  dashboardSectionLabelClass,
  dashboardSupportingTextClass,
} from "@/components/dashboard/DashboardPrimitives"
import { CheckoutWorkspace } from "../checkout/page"
import PublicKeysPanel from "./PublicKeysPanel"
import ShopifyIntegrationCard from "./ShopifyIntegrationCard"
import WooCommerceIntegrationCard from "./WooCommerceIntegrationCard"

type DeveloperTab = "keys" | "webhooks" | "sdks" | "integrations" | "docs"

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
  const [docSection, setDocSection] = useState<DocSection>("overview")

  useEffect(() => {
    const shopifyResult = new URLSearchParams(window.location.search).get("shopify")
    if (shopifyResult !== "connected") return
    const timer = window.setTimeout(() => setTab("integrations"), 0)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div className="space-y-5 md:space-y-7">
      <div>
        <h1 className={dashboardPageTitleClass}>Developer</h1>
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
        <div className="grid gap-2 sm:gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={() => {
              setDocSection("quickstart")
              setTab("docs")
            }}
            aria-pressed={tab === "docs" && docSection === "quickstart"}
            className={`rounded-2xl border p-4 text-left shadow-[0_8px_24px_rgba(15,23,42,0.04)] transition ${
              tab === "docs" && docSection === "quickstart"
                ? "border-blue-200 bg-blue-50/60"
                : "border-gray-200/80 bg-white hover:border-blue-200 hover:bg-blue-50/30"
            } focus:outline-none focus:ring-4 focus:ring-blue-100`}
          >
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                <BookOpen className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-gray-950">Developer Guides</h2>
                <p className="mt-1 text-[12px] leading-5 text-gray-500">
                  Step-by-step setup for API keys, checkout sessions, webhooks, SDKs, and integrations.
                </p>
                <div className="mt-3 space-y-2">
                  {["Create keys", "Build checkout", "Configure webhooks"].map((item) => (
                    <div key={item} className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-medium text-gray-600">{item}</span>
                    </div>
                  ))}
                </div>
                <span className="mt-3 inline-flex text-[11.5px] font-semibold leading-5 text-blue-700">Start quickstart</span>
              </div>
            </div>
          </button>
          <div className="rounded-2xl border border-gray-200/80 bg-white p-4 text-left shadow-[0_8px_24px_rgba(15,23,42,0.04)] transition hover:border-blue-200 hover:bg-blue-50/30">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                <Activity className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-gray-950">Developer Status</h2>
                <p className="mt-1 text-[12px] leading-5 text-gray-500">
                  Developer account setup and connection health.
                </p>
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium text-gray-600">API Keys</span>
                    <button type="button" onClick={() => setTab("keys")} className="font-semibold leading-5 text-blue-700 hover:text-blue-800">
                      Manage keys
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium text-gray-600">Webhooks</span>
                    <button type="button" onClick={() => setTab("webhooks")} className="font-semibold leading-5 text-blue-700 hover:text-blue-800">
                      Manage webhooks
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium text-gray-600">SDKs</span>
                    <span className="font-semibold leading-5 text-gray-700">Ready</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
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
      {tab === "docs" && <ApiReferencePanel activeDoc={docSection} setActiveDoc={setDocSection} />}
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
      command: null as string | null,
      description: "No package required. Use a secret API key from your server to create checkout sessions.",
    },
    {
      title: "Node SDK",
      status: "Ready",
      tone: "green" as const,
      purpose: "Server tools for checkout and webhooks.",
      command: "npm install @pinetreepayments/node",
      description: "Use this on your server for checkout sessions, payments, and webhook verification.",
    },
    {
      title: "JavaScript SDK",
      status: "Ready",
      tone: "green" as const,
      purpose: "Start checkout from a website.",
      command: "npm install @pinetreepayments/js",
      description: "Use this in browser checkout flows with a public browser key.",
    },
    {
      title: "React SDK",
      status: "Ready",
      tone: "green" as const,
      purpose: "Add checkout to a React app.",
      command: "npm install @pinetreepayments/react",
      description: "Use this in React apps for checkout buttons and embedded checkout.",
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
            <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
              {card.command && (
                <code className="block overflow-x-auto rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-mono text-[11px] font-medium text-gray-950 shadow-[0_4px_14px_rgba(15,23,42,0.04)]">
                  {card.command}
                </code>
              )}
              <p className="text-xs text-gray-600">{card.description}</p>
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
        <WooCommerceIntegrationCard />
        <ShopifyIntegrationCard />
      </div>
    </DashboardSection>
  )
}

type DocSection =
  | "overview"
  | "quickstart"
  | "authentication"
  | "api-keys"
  | "checkout-sessions"
  | "browser-checkout"
  | "payments"
  | "session-statuses"
  | "rails-assets"
  | "payment-states"
  | "webhooks"
  | "webhook-payload"
  | "webhook-events"
  | "webhook-deliveries"
  | "errors"
  | "idempotency"
  | "sdks"
  | "testing"
  | "go-live"
  | "not-yet-supported"
  | "support"

const docNav: { id: DocSection; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "quickstart", label: "Quickstart" },
  { id: "authentication", label: "Authentication" },
  { id: "api-keys", label: "API Keys" },
  { id: "checkout-sessions", label: "Checkout Sessions" },
  { id: "browser-checkout", label: "Browser Checkout" },
  { id: "payments", label: "Payments" },
  { id: "session-statuses", label: "Session Statuses" },
  { id: "rails-assets", label: "Rails & Assets" },
  { id: "payment-states", label: "Payment States" },
  { id: "webhooks", label: "Webhooks" },
  { id: "webhook-payload", label: "Webhook Payload" },
  { id: "webhook-events", label: "Webhook Events" },
  { id: "webhook-deliveries", label: "Webhook Deliveries" },
  { id: "errors", label: "Errors" },
  { id: "idempotency", label: "Idempotency" },
  { id: "sdks", label: "SDKs" },
  { id: "testing", label: "Testing" },
  { id: "go-live", label: "Go Live" },
  { id: "not-yet-supported", label: "Not Yet Supported" },
  { id: "support", label: "Support" },
]

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative my-3 max-w-full">
      <pre className="max-w-full overflow-x-auto rounded-xl border border-blue-100/80 bg-slate-50/90 px-4 py-3.5 font-mono text-[11.5px] leading-relaxed text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_8px_24px_rgba(15,23,42,0.04)] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <code className="block min-w-0 whitespace-pre">{children}</code>
      </pre>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(children).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          })
        }}
        className="absolute right-2.5 top-2.5 rounded-lg border border-blue-100 bg-white/90 px-2 py-1 text-[10.5px] font-semibold text-blue-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 focus:outline-none focus:ring-4 focus:ring-blue-100"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  )
}

function DocH1({ eyebrow, children, description }: { eyebrow?: string; children: ReactNode; description?: ReactNode }) {
  return (
    <div className="mb-5">
      {eyebrow && <p className={dashboardSectionLabelClass}>{eyebrow}</p>}
      <h1 className="mt-1 text-2xl font-semibold leading-tight tracking-tight text-gray-950 md:text-[1.7rem]">
        {children}
      </h1>
      {description && <p className={`mt-2 max-w-2xl ${dashboardSupportingTextClass}`}>{description}</p>}
    </div>
  )
}

function DocH2({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 mt-8 border-b border-gray-100 pb-2 text-sm font-semibold leading-tight tracking-tight text-gray-950">
      {children}
    </h2>
  )
}

function DocTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  function renderCell(cell: string, header: string) {
    const normalizedHeader = header.toLowerCase()

    if (normalizedHeader === "asset") {
      return <span className="font-semibold text-blue-700">{cell}</span>
    }

    if (normalizedHeader === "rail") {
      return <code className="font-mono text-[11.5px] font-semibold text-slate-700">{cell}</code>
    }

    if (normalizedHeader === "status") {
      return (
        <span className="inline-flex rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1 text-[11px] font-semibold leading-5 text-emerald-700">
          {cell}
        </span>
      )
    }

    const textCols = ["description", "meaning", "notes", "grants", "when", "use", "terminal", "capability"]
    if (textCols.includes(normalizedHeader)) {
      return <span className="text-[12.5px] leading-5 text-gray-600">{cell}</span>
    }

    return <code className="font-mono text-[11px] font-semibold text-blue-800">{cell}</code>
  }

  return (
    <div className="my-3 max-w-full overflow-x-auto rounded-2xl border border-gray-200/80 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-blue-100 bg-blue-50/55">
            {headers.map((h) => (
              <th key={h} className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.13em] text-blue-700">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-gray-100 last:border-0">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2.5 text-gray-700 align-top">
                  {renderCell(cell, headers[j] || "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RouteRow({ method, path, description }: { method: "GET" | "POST"; path: string; description: string }) {
  return (
    <div className="my-3 rounded-2xl border border-gray-200/80 bg-white px-4 py-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)] transition hover:border-blue-200 hover:bg-blue-50/20">
      <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-2">
        <span className={`shrink-0 rounded-lg border px-2 py-1 font-mono text-[10px] font-semibold ${method === "POST" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-blue-200 bg-blue-50 text-blue-700"}`}>
          {method}
        </span>
        <code className="min-w-0 break-all text-[12.5px] font-semibold text-gray-950">{path}</code>
      </div>
      <p className="break-words text-xs leading-5 text-gray-600">{description}</p>
    </div>
  )
}

// Doc section components
function DocSectionOverview() {
  return (
    <div>
      <div className="mb-2 inline-flex rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700">
        REST · Production
      </div>
      <h1 className="mb-2 text-2xl font-semibold leading-tight tracking-tight text-gray-950 md:text-[1.7rem]">PineTree API</h1>
      <p className="mb-6 max-w-2xl text-sm leading-5 text-gray-600">
        Accept crypto payments across Solana, Base, Lightning, and more. The PineTree API gives you checkout sessions,
        real-time webhooks, and a hosted payment page — so your customers can pay with any wallet in under 60 seconds.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Base URL", "app.pinetree-payments.com"],
          ["API prefix", "Versioned REST routes"],
          ["Auth", "Bearer pt_live_..."],
          ["Service fee", "$0.15 / tx"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-gray-200/80 bg-gradient-to-br from-white to-blue-50/35 p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-500">{label}</p>
            <code className="text-[11.5px] font-semibold text-gray-950">{value}</code>
          </div>
        ))}
      </div>
      <DocH2>Supported assets</DocH2>
      <DocTable
        headers={["Asset", "Rail", "Status"]}
        rows={[
          ["SOL on Solana", "solana", "Ready"],
          ["USDC on Solana", "solana", "Ready"],
          ["ETH on Base", "base", "Ready"],
          ["USDC on Base", "base", "Ready"],
          ["BTC over Lightning", "bitcoin_lightning", "Ready"],
          ["Cards / Shift4", "shift4", "Approved merchants"],
        ]}
      />
      <DocH2>Core concepts</DocH2>
      {[
        ["Checkout Session", "A payment intent with a hosted checkout URL. Customers pick a network and pay. Sessions expire after 24 hours."],
        ["Payment", "Tracks on-chain status. Lifecycle: open → processing → paid | failed | incomplete."],
        ["Webhook Event", "HMAC-signed HTTP POST when payment status changes. Use payment.confirmed to fulfill orders."],
      ].map(([title, desc]) => (
        <div key={title} className="mb-2.5 rounded-2xl border border-gray-200/80 bg-white p-3.5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
          <p className="mb-1 text-sm font-semibold text-gray-950">{title}</p>
          <p className="text-xs leading-5 text-gray-600">{desc}</p>
        </div>
      ))}
    </div>
  )
}

function DocSectionQuickstart() {
  return (
    <div>
      <DocH1 eyebrow="Getting Started" description="Integrate PineTree in minutes. Start with a server-side checkout session, then verify the payment webhook before fulfillment.">
        Quickstart
      </DocH1>
      {[
        {
          step: "1",
          title: "Install the Node SDK",
          content: <CodeBlock>npm install @pinetreepayments/node</CodeBlock>,
        },
        {
          step: "2",
          title: "Create a checkout session",
          content: (
            <CodeBlock>{`import { PineTree } from "@pinetreepayments/node"

const pinetree = new PineTree(process.env.PINETREE_API_KEY!)

const session = await pinetree.checkout.sessions.create({
  amount: 2500,    // $25.00 in cents
  currency: "USD",
  reference: "order_1042",
  successUrl: "https://yoursite.com/success",
  cancelUrl: "https://yoursite.com/cancel",
})

res.redirect(session.checkoutUrl)`}</CodeBlock>
          ),
        },
        {
          step: "3",
          title: "Verify webhooks",
          content: (
            <CodeBlock>{`app.post("/webhooks/pinetree",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const event = pinetree.webhooks.constructEvent(
      req.body,
      req.headers,
      process.env.PINETREE_WEBHOOK_SECRET!
    )
    if (event.type === "payment.confirmed") {
      fulfillOrder(event.data.object.reference)
    }
    res.json({ received: true })
  }
)`}</CodeBlock>
          ),
        },
      ].map(({ step, title, content }) => (
        <div key={step} className="mb-5 flex gap-4">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[11px] font-semibold text-blue-700 ring-1 ring-blue-100">
            {step}
          </div>
          <div className="flex-1 min-w-0">
            <p className="mb-1 text-sm font-semibold text-gray-950">{title}</p>
            {content}
          </div>
        </div>
      ))}
    </div>
  )
}

function DocSectionAuthentication() {
  return (
    <div>
      <DocH1 eyebrow="Security" description="Secret keys are for server use. Public keys are for browser checkout flows. Never mix them.">
        Authentication
      </DocH1>
      <DocH2>Authorization header</DocH2>
      <CodeBlock>{`Authorization: Bearer pt_live_your_api_key_here
Content-Type: application/json`}</CodeBlock>
      <DocH2>Key permissions</DocH2>
      <DocTable
        headers={["Permission", "Grants"]}
        rows={[
          ["checkout.sessions:create", "Create checkout sessions"],
          ["checkout.sessions:read", "List and retrieve sessions"],
          ["checkout.sessions:write", "Cancel or expire sessions"],
          ["payments:read", "Retrieve payment objects"],
          ["checkout.links:create", "Create payment links where enabled"],
          ["webhooks:read", "List webhook deliveries"],
          ["webhooks:write", "Retry webhook deliveries"],
        ]}
      />
      <div className="mt-4 rounded-2xl border border-amber-200/80 bg-amber-50/70 p-3.5 text-xs leading-5 text-amber-800">
        <strong>Security:</strong> Never use <code className="rounded bg-amber-100 px-1 text-xs">pt_live_*</code> keys in browser code.
        Use <code className="rounded bg-amber-100 px-1 text-xs">pk_live_*</code> public keys with the Browser SDK for frontend checkout flows.
      </div>
    </div>
  )
}

function DocSectionApiKeys() {
  return (
    <div>
      <DocH1 eyebrow="Credentials" description="Secret keys belong on servers. Public keys belong in browser checkout flows.">
        API Keys
      </DocH1>
      <DocTable
        headers={["Key", "Prefix", "Use"]}
        rows={[
          ["Secret API key", "pt_live_*", "Server REST API calls"],
          ["Browser public key", "pk_live_*", "Browser SDK checkout creation"],
        ]}
      />
      <DocH2>Permissions</DocH2>
      <DocTable
        headers={["Permission", "Grants"]}
        rows={[
          ["checkout.sessions:create", "Create checkout sessions"],
          ["checkout.sessions:read", "List and retrieve sessions"],
          ["checkout.sessions:write", "Cancel or expire sessions"],
          ["payments:read", "Retrieve payments"],
          ["checkout.links:create", "Create payment links where enabled"],
          ["webhooks:read", "List webhook deliveries"],
          ["webhooks:write", "Retry webhook deliveries"],
        ]}
      />
    </div>
  )
}

function DocSectionCheckoutSessions() {
  return (
    <div>
      <DocH1
        eyebrow="Hosted Checkout"
        description={<>Create a session server-side, redirect the customer to <code className="rounded-lg bg-blue-50 px-1.5 text-xs font-semibold text-blue-800 ring-1 ring-blue-100">checkoutUrl</code>, and receive a webhook when payment is confirmed.</>}
      >
        Checkout Sessions
      </DocH1>
      <RouteRow method="POST" path="/checkout/sessions" description="Create a session. Requires checkout.sessions:create." />
      <RouteRow method="GET" path="/checkout/sessions" description="List sessions. Supports status, reference, limit, date filters." />
      <RouteRow method="GET" path="/checkout/sessions/{id}" description="Retrieve a single session by ID." />
      <RouteRow method="POST" path="/checkout/sessions/{id}/cancel" description="Cancel an open session." />
      <RouteRow method="POST" path="/checkout/sessions/{id}/expire" description="Immediately expire a session." />
      <RouteRow method="POST" path="/browser/checkout/sessions" description="Create a session from browser code. Authenticate with X-PineTree-Public-Key: pk_live_* (no secret key)." />
      <div className="my-3 rounded-2xl border border-blue-200/80 bg-blue-50/60 p-3.5 text-xs leading-5 text-blue-800">
        <strong>checkoutUrl is opaque.</strong> Always redirect customers directly to the <code className="rounded bg-blue-100 px-1 text-xs">checkoutUrl</code> value returned in the response.
        Do not construct checkout URLs manually — the format is an internal token path that may change between API versions.
      </div>
      <DocH2>Create session example</DocH2>
      <CodeBlock>{`const session = await pinetree.checkout.sessions.create(
  {
    amount: 2500,
    currency: "USD",
    reference: "order_1042",
    customer: { email: "jane@example.com" },
    successUrl: "https://yoursite.com/success",
    cancelUrl: "https://yoursite.com/cancel",
  },
  { idempotencyKey: "order_1042" }
)
console.log(session.checkoutUrl)  // redirect customer here`}</CodeBlock>
      <DocH2>Session statuses</DocH2>
      <DocTable
        headers={["Status", "Description"]}
        rows={[
          ["open", "Waiting for customer payment"],
          ["processing", "Payment broadcast; awaiting confirmation"],
          ["paid", "Confirmed — fulfill the order"],
          ["failed", "Payment failed"],
          ["expired", "Session expired without payment"],
          ["canceled", "Explicitly canceled by merchant"],
        ]}
      />
    </div>
  )
}

function DocSectionPayments() {
  return (
    <div>
      <DocH1 eyebrow="Payment Objects" description="Track on-chain payment status, network, amount, and fulfillment reference.">
        Payments
      </DocH1>
      <RouteRow method="GET" path="/payments/{id}" description="Retrieve a payment. Requires payments:read." />
      <DocH2>Payment object</DocH2>
      <CodeBlock>{`{
  "id": "pay_01abc...",
  "object": "payment",
  "status": "paid",
  "amount": 2500,
  "currency": "USD",
  "network": "solana",
  "rail": "solana",
  "reference": "order_1042",
  "createdAt": "2026-06-16T12:01:00Z",
  "updatedAt": "2026-06-16T12:02:30Z"
}`}</CodeBlock>
      <DocH2>Payment lifecycle</DocH2>
      <CodeBlock>{`CREATED → PENDING → PROCESSING → CONFIRMED (status: "paid")
                             └→ FAILED    (status: "failed")
              └→ INCOMPLETE               (status: "incomplete")`}</CodeBlock>
      <div className="mt-3 rounded-2xl border border-amber-200/80 bg-amber-50/70 p-3.5 text-xs leading-5 text-amber-800">
        <strong>Status naming:</strong> The API returns <code className="rounded bg-amber-100 px-1 text-xs">status: &quot;paid&quot;</code> when a payment is confirmed — not <code className="rounded bg-amber-100 px-1 text-xs">&quot;confirmed&quot;</code>.
        The visible merchant state is called <strong>Confirmed</strong>. For fulfillment use the <code className="rounded bg-amber-100 px-1 text-xs">payment.confirmed</code> webhook. For polling, check <code className="rounded bg-amber-100 px-1 text-xs">status === &quot;paid&quot;</code>.
      </div>
    </div>
  )
}

function DocSectionRailsAssets() {
  return (
    <div>
      <DocH1 eyebrow="Payment Methods" description="Rails are network/provider paths. Assets are what the customer pays on that rail.">
        Rails & Assets
      </DocH1>
      <DocTable
        headers={["Rail", "Assets"]}
        rows={[
          ["solana", "SOL on Solana, USDC on Solana"],
          ["base", "ETH on Base, USDC on Base"],
          ["bitcoin_lightning", "BTC over Lightning"],
          ["shift4", "Card/USD through Shift4 — approved merchants only"],
        ]}
      />
      <DocH2>Hosted checkout selections</DocH2>
      <DocTable
        headers={["Network", "Asset"]}
        rows={[
          ["solana", "SOL"],
          ["solana", "USDC"],
          ["base", "ETH"],
          ["base", "USDC"],
          ["bitcoin_lightning", "BTC"],
        ]}
      />
    </div>
  )
}

function DocSectionPaymentStates() {
  return (
    <div>
      <DocH1 eyebrow="Lifecycle" description="Confirmed is the successful visible payment state. Public API objects use paid for compatibility.">
        Payment States
      </DocH1>
      <DocTable
        headers={["Visible State", "Meaning", "Terminal", "Color"]}
        rows={[
          ["Waiting", "Payment request open, no funds detected", "No", "Blue"],
          ["Processing", "Payment detected, awaiting final confirmation", "No", "Darker blue"],
          ["Confirmed", "Payment completed", "Yes", "Green"],
          ["Failed", "Provider/network/payment attempt failed", "Yes", "Red"],
          ["Expired", "Payment window timed out", "Yes", "Red"],
          ["Canceled", "Customer abandoned/backed out/no funds sent", "Yes", "Gray"],
          ["Refunded", "Settled funds were returned", "Yes", "Orange"],
          ["Unknown", "Status is not recognized", "No", "Neutral gray"],
        ]}
      />
    </div>
  )
}

function DocSectionWebhooks() {
  return (
    <div>
      <DocH1 eyebrow="Events" description="HMAC-signed events delivered to your HTTPS endpoint when payment status changes.">
        Webhooks
      </DocH1>
      <DocH2>Webhook headers</DocH2>
      <DocTable
        headers={["Header", "Description"]}
        rows={[
          ["PineTree-Signature", "HMAC-SHA256 hex of PineTree-Timestamp + '.' + raw body"],
          ["PineTree-Timestamp", "ISO 8601 — must be within 5 minutes"],
          ["PineTree-Event-Id", "Unique event ID for deduplication"],
          ["PineTree-Event-Schema", "payments-v1"],
          ["PineTree-Webhook-Version", "Legacy compatibility — also payments-v1. Prefer PineTree-Event-Schema."],
        ]}
      />
      <DocH2>Signature verification</DocH2>
      <CodeBlock>{`// Use express.raw() — do not JSON.parse() before verification
const event = pinetree.webhooks.constructEvent(
  req.body,
  req.headers,
  process.env.PINETREE_WEBHOOK_SECRET!
)`}</CodeBlock>
      <DocH2>Event types</DocH2>
      <DocTable
        headers={["Event", "When"]}
        rows={[
          ["payment.confirmed", "On-chain confirmed — fulfill the order ✓"],
          ["payment.failed", "Payment failed at the network level"],
          ["payment.expired", "Payment expired before completion"],
          ["payment.canceled", "Payment was canceled"],
          ["payment.refunded", "Payment was refunded"],
          ["payment.incomplete", "Payment ended without more specific terminal evidence"],
          ["payment.processing", "Transaction broadcast; awaiting confirmation"],
          ["payment.pending", "Customer wallet action detected"],
          ["payment.created", "Payment object first created"],
          ["checkout.session.created", "Checkout session created"],
          ["checkout.session.processing", "Checkout session processing"],
          ["checkout.session.completed", "Checkout session completed"],
          ["checkout.session.failed", "Checkout session failed"],
          ["checkout.session.expired", "Checkout session expired"],
          ["checkout.session.canceled", "Checkout session canceled"],
          ["payment_link.created", "Payment link created"],
          ["payment_link.disabled", "Payment link disabled"],
          ["payment_link.expired", "Payment link expired"],
        ]}
      />
    </div>
  )
}

function DocSectionWebhookEvents() {
  return (
    <div>
      <DocH1 eyebrow="Event Catalog" description="Every implemented merchant webhook event type in the payments-v1 envelope.">
        Webhook Events
      </DocH1>
      <DocTable
        headers={["Event", "Object"]}
        rows={[
          ["payment.created", "payment"],
          ["payment.pending", "payment"],
          ["payment.processing", "payment"],
          ["payment.confirmed", "payment"],
          ["payment.failed", "payment"],
          ["payment.expired", "payment"],
          ["payment.canceled", "payment"],
          ["payment.incomplete", "payment"],
          ["payment.refunded", "payment"],
          ["checkout.session.created", "checkout.session"],
          ["checkout.session.processing", "checkout.session"],
          ["checkout.session.completed", "checkout.session"],
          ["checkout.session.failed", "checkout.session"],
          ["checkout.session.expired", "checkout.session"],
          ["checkout.session.canceled", "checkout.session"],
          ["payment_link.created", "payment_link"],
          ["payment_link.disabled", "payment_link"],
          ["payment_link.expired", "payment_link"],
        ]}
      />
      <DocH2>Envelope</DocH2>
      <CodeBlock>{`{
  "eventId": "evt_...",
  "object": "event",
  "type": "payment.confirmed",
  "schema": "payments-v1",
  "createdAt": "2026-06-16T00:00:00.000Z",
  "livemode": true,
  "data": { "object": { "id": "pay_...", "object": "payment" } }
}`}</CodeBlock>
    </div>
  )
}

function DocSectionWebhookDeliveries() {
  return (
    <div>
      <DocH1 eyebrow="Reliability" description="Inspect delivery history and retry failed events from your server tooling.">
        Webhook Deliveries
      </DocH1>
      <RouteRow method="GET" path="/webhook-deliveries" description="List deliveries. Filter by status or eventType. Requires webhooks:read." />
      <RouteRow method="POST" path="/webhook-deliveries/{id}/retry" description="Manually retry a delivery. Requires webhooks:write." />
      <DocH2>Delivery statuses</DocH2>
      <DocTable
        headers={["Status", "Description"]}
        rows={[
          ["pending", "Not yet attempted or queued for retry"],
          ["delivered", "Your endpoint returned 2xx"],
          ["failed", "Last attempt failed"],
          ["dead_letter", "Delivery requires operator attention"],
        ]}
      />
      <DocH2>Retry schedule</DocH2>
      <p className="mb-2 text-xs leading-5 text-gray-600">
        Failed deliveries are retried with exponential backoff. After 10 attempts the delivery moves to <code className="rounded-lg bg-blue-50 px-1 text-xs text-blue-800 ring-1 ring-blue-100">dead_letter</code>.
        Delay sequence: 60s → 120s → 240s → 480s → 960s → 1800s → 3600s (×4).
      </p>
      <DocH2>Retry a failed delivery</DocH2>
      <CodeBlock>{`const delivery = await pinetree.webhookDeliveries.retry("wdel_01abc...")
console.log(delivery.status)       // "delivered" if retry succeeded
console.log(delivery.attemptCount) // total delivery attempts`}</CodeBlock>
    </div>
  )
}

function DocSectionErrors() {
  return (
    <div>
      <DocH1 eyebrow="Error Handling" description="All errors return a consistent JSON structure with a type, code, message, and request ID.">
        Errors
      </DocH1>
      <CodeBlock>{`{
  "error": {
    "type": "authentication_error",
    "code": "missing_api_key",
    "message": "A PineTree API key is required.",
    "requestId": "req_01abc..."
  }
}`}</CodeBlock>
      <DocH2>Error types</DocH2>
      <DocTable
        headers={["Type", "Status"]}
        rows={[
          ["authentication_error", "401"],
          ["authorization_error", "403"],
          ["invalid_request_error", "400"],
          ["idempotency_error", "409"],
          ["not_found_error", "404"],
          ["api_error", "500"],
        ]}
      />
      <DocH2>Node SDK error classes</DocH2>
      <CodeBlock>{`import { AuthenticationError, PermissionError,
  InvalidRequestError, IdempotencyConflictError,
  APIConnectionError } from "@pinetreepayments/node"

try {
  const session = await pinetree.checkout.sessions.create(...)
} catch (err) {
  if (err instanceof AuthenticationError) { /* invalid key */ }
  if (err instanceof PermissionError)     { /* wrong scope */ }
  if (err instanceof IdempotencyConflictError) { /* don't retry */ }
  if (err instanceof APIConnectionError)  { /* safe to retry */ }
}`}</CodeBlock>
    </div>
  )
}

function DocSectionIdempotency() {
  return (
    <div>
      <DocH1 eyebrow="Retries" description="Safely retry checkout session creation without duplicates.">
        Idempotency
      </DocH1>
      <DocH2>Idempotency-Key header</DocH2>
      <p className="mb-2 text-xs leading-5 text-gray-600">Add to <code className="rounded-lg bg-blue-50 px-1 text-xs text-blue-800 ring-1 ring-blue-100">POST /checkout/sessions</code>. Use your order ID as the key.</p>
      <CodeBlock>{`const session = await pinetree.checkout.sessions.create(
  { amount: 2500, reference: "order_1042" },
  { idempotencyKey: "order_1042" }  // same key + same body = same session`}</CodeBlock>
      <DocH2>Behavior</DocH2>
      <DocTable
        headers={["Scenario", "Result"]}
        rows={[
          ["Same key + same body", "Returns original session (no duplicate created)"],
          ["Same key + different body", "409 idempotency_key_conflict"],
          ["Request in progress", "409 idempotency_request_in_progress"],
        ]}
      />
    </div>
  )
}

function DocSectionSdks() {
  return (
    <div>
      <DocH1 eyebrow="Libraries" description="Use the Node SDK on servers, JavaScript SDK in browser flows, and React SDK for components.">
        SDKs
      </DocH1>
      <DocTable
        headers={["SDK", "Package"]}
        rows={[
          ["Node SDK", "@pinetreepayments/node"],
          ["JavaScript SDK", "@pinetreepayments/js"],
          ["React SDK", "@pinetreepayments/react"],
        ]}
      />
      <CodeBlock>{`npm install @pinetreepayments/node
npm install @pinetreepayments/js
npm install @pinetreepayments/react`}</CodeBlock>
    </div>
  )
}

function DocSectionTesting() {
  return (
    <div>
      <DocH1 eyebrow="Validation" description="PineTree uses live keys only. Test with small amounts and ngrok for local webhooks.">
        Testing
      </DocH1>
      <div className="mb-4 rounded-2xl border border-blue-200 bg-blue-50/60 p-3.5 text-xs leading-5 text-blue-800">
        <strong>No sandbox mode.</strong> Use amounts like <code className="rounded bg-blue-100 px-1 text-xs">1</code> ($0.01) for integration testing.
      </div>
      <DocH2>Platform test suite</DocH2>
      <CodeBlock>{`npm run lint       # 0 errors
npm run typecheck  # 0 errors
npx vitest run     # all tests pass
npm run build      # clean build`}</CodeBlock>
      <DocH2>Test webhooks locally</DocH2>
      <CodeBlock>{`ngrok http 3000
# Register https://abc123.ngrok-free.app/webhooks/pinetree in Developer → Webhooks`}</CodeBlock>
    </div>
  )
}

function DocSectionGoLive() {
  return (
    <div>
      <DocH1 eyebrow="Launch" description="Complete these checks before accepting real payments.">
        Go-Live Checklist
      </DocH1>
      {[
        {
          title: "API & Keys",
          items: [
            "Secret API key created with minimal permissions",
            "API key stored in environment variables, not source code",
            "No pt_live_* keys in frontend code",
          ],
        },
        {
          title: "Webhooks",
          items: [
            "Webhook endpoint registered (HTTPS only)",
            "Signing secret stored as PINETREE_WEBHOOK_SECRET",
            "PineTree-Signature verified on every event",
            "Duplicate events handled via eventId",
          ],
        },
        {
          title: "Payment flows tested",
          items: [
            "Happy path: session → paid → order fulfilled",
            "Failed payment: order not fulfilled",
            "Expired/incomplete: order not fulfilled",
          ],
        },
        {
          title: "Environment",
          items: [
            "CHECKOUT_SESSION_SECRET set in production",
            "At least one payment rail configured",
            "Treasury wallet addresses verified",
          ],
        },
      ].map(({ title, items }) => (
        <div key={title} className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-gray-950">{title}</h2>
          <div className="rounded-2xl border border-gray-200/80 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
            {items.map((item, i) => (
              <div key={i} className="flex items-start gap-3 border-b border-gray-100 px-4 py-3 text-xs leading-5 text-gray-700 last:border-0">
                <span className="mt-0.5 text-gray-300">□</span>
                {item}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function DocSectionBrowserCheckout() {
  return (
    <div>
      <DocH1 eyebrow="Frontend Integration" description="Create checkout sessions from browser code using a pk_live_* public key. Never use secret keys in the browser.">
        Browser Checkout
      </DocH1>
      <div className="mb-4 rounded-2xl border border-amber-200/80 bg-amber-50/70 p-3.5 text-xs leading-5 text-amber-800">
        <strong>Public keys only.</strong> Never use <code className="rounded bg-amber-100 px-1 text-xs">pt_live_*</code> secret keys in browser code.
        Use <code className="rounded bg-amber-100 px-1 text-xs">pk_live_*</code> public keys for all frontend checkout flows. Public keys can only create checkout sessions.
      </div>
      <RouteRow method="POST" path="/browser/checkout/sessions" description="Create a checkout session using a pk_live_* public key. Authenticate with X-PineTree-Public-Key header." />
      <DocH2>Browser header</DocH2>
      <CodeBlock>{`X-PineTree-Public-Key: pk_live_your_public_key_here
Content-Type: application/json`}</CodeBlock>
      <DocH2>JavaScript SDK</DocH2>
      <CodeBlock>{`import { PineTreeJS } from "@pinetreepayments/js"

const ptjs = new PineTreeJS("pk_live_your_public_key_here")

const session = await ptjs.checkout.createSession({
  amount: 2500,
  currency: "USD",
  reference: "order_1042",
  successUrl: window.location.origin + "/paid",
  cancelUrl:  window.location.origin + "/cancel",
})
ptjs.checkout.open(session)  // redirects to hosted checkout`}</CodeBlock>
      <DocH2>React SDK</DocH2>
      <CodeBlock>{`import { PineTreeProvider, PineTreeCheckoutButton } from "@pinetreepayments/react"

<PineTreeProvider publicKey="pk_live_your_public_key_here">
  <PineTreeCheckoutButton
    amount={2500}
    currency="USD"
    reference="order_1042"
    successUrl={window.location.origin + "/paid"}
    cancelUrl={window.location.origin + "/cancel"}
  >
    Pay with Crypto
  </PineTreeCheckoutButton>
</PineTreeProvider>`}</CodeBlock>
    </div>
  )
}

function DocSectionSessionStatuses() {
  return (
    <div>
      <DocH1 eyebrow="Checkout Sessions" description="Session status tracks the aggregate lifecycle of a checkout session. Session and Payment statuses use similar but not identical labels.">
        Session Statuses
      </DocH1>
      <DocTable
        headers={["Status", "Meaning", "Terminal"]}
        rows={[
          ["open", "Session created — waiting for customer to begin payment", "No"],
          ["processing", "Customer submitted payment — awaiting on-chain confirmation", "No"],
          ["paid", "Payment confirmed — fulfill order on payment.confirmed event", "Yes"],
          ["failed", "Payment attempt failed", "Yes"],
          ["expired", "Session expired after 24 hours without confirmed payment", "Yes"],
          ["canceled", "Session canceled by merchant via API or dashboard", "Yes"],
        ]}
      />
      <div className="mt-4 rounded-2xl border border-blue-200/80 bg-blue-50/60 p-3.5 text-xs leading-5 text-blue-800">
        <strong>Prefer webhooks over polling.</strong> Use the <code className="rounded bg-blue-100 px-1 text-xs">checkout.session.completed</code> or <code className="rounded bg-blue-100 px-1 text-xs">payment.confirmed</code> webhook event for fulfillment.
        Session status <code className="rounded bg-blue-100 px-1 text-xs">paid</code> maps to the <code className="rounded bg-blue-100 px-1 text-xs">payment.confirmed</code> event.
      </div>
    </div>
  )
}

function DocSectionWebhookPayload() {
  return (
    <div>
      <DocH1 eyebrow="Event Structure" description="Every PineTree webhook is a JSON object with a standard payments-v1 envelope. The event type, schema, and event ID are at the top level.">
        Webhook Payload
      </DocH1>
      <DocH2>Event envelope</DocH2>
      <CodeBlock>{`{
  "eventId":   "evt_01abc...",           // store for deduplication
  "object":    "event",
  "type":      "payment.confirmed",
  "schema":    "payments-v1",
  "createdAt": "2026-06-22T18:00:00.000Z",
  "livemode":  true,
  "data": {
    "object": { /* payment or checkout.session or payment_link */ }
  }
}`}</CodeBlock>
      <DocH2>Payment event — data.object</DocH2>
      <CodeBlock>{`{
  "id":             "pay_01abc",
  "object":         "payment",
  "merchantId":     "mer_01abc",
  "amount":         2500,
  "currency":       "USD",
  "status":         "paid",
  "network":        "solana",      // rail identifier in webhook events
  "reference":      "order_1042",
  "checkoutLinkId": "cs_01abc",
  "confirmedAt":    "2026-06-22T18:00:05.000Z",
  "metadata":       {}
}`}</CodeBlock>
      <div className="mt-3 rounded-2xl border border-amber-200/80 bg-amber-50/70 p-3.5 text-xs leading-5 text-amber-800">
        <strong>network vs rail:</strong> Webhook payment events use <code className="rounded bg-amber-100 px-1 text-xs">network</code> for the rail identifier.
        The REST API Payment object uses <code className="rounded bg-amber-100 px-1 text-xs">rail</code> for the same value (e.g., <code className="rounded bg-amber-100 px-1 text-xs">solana</code>, <code className="rounded bg-amber-100 px-1 text-xs">base</code>).
        Use <code className="rounded bg-amber-100 px-1 text-xs">event.data.object.network</code> in webhook handlers.
      </div>
    </div>
  )
}

function DocSectionNotYetSupported() {
  return (
    <div>
      <DocH1 eyebrow="Roadmap" description="These capabilities are planned but not yet available. None are required for the current hosted checkout and webhook integration.">
        Not Yet Supported
      </DocH1>
      <DocTable
        headers={["Capability", "Notes"]}
        rows={[
          ["Refund API", "Refunds processed via dashboard. REST endpoint planned."],
          ["Payout / settlement API", "Settlement configured in dashboard. API planned."],
          ["Disputes API", "Available after card processing is generally available."],
          ["Sandbox / test-mode keys", "Live keys only. A test environment is on the roadmap."],
          ["Advanced reporting API", "Reports available for download from dashboard."],
          ["Stripe card processing", "In early access. Contact support for access."],
          ["Fluid Pay card processing", "In early access. Contact support for access."],
          ["Recurring billing", "One-time sessions only. Subscriptions are planned."],
          ["Customer objects API", "Customer data lives on sessions/payments as metadata."],
          ["Invoice API", "Not yet available."],
        ]}
      />
    </div>
  )
}

function DocSectionSupport() {
  return (
    <div>
      <DocH1 eyebrow="Help" description="Contact PineTree for integration help, API access, and merchant onboarding.">
        Support
      </DocH1>
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        {[
          ["Email", "info@pinetree-payments.com"],
          ["Phone", "417-718-2692"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-gray-200/80 bg-white p-3.5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-500">{label}</p>
            <p className="text-sm font-semibold text-gray-950">{value}</p>
          </div>
        ))}
      </div>
      <DocH2>Include in support requests</DocH2>
      <div className="rounded-2xl border border-gray-200/80 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
        {[
          "Merchant account email or ID",
          "API endpoint and HTTP method",
          "requestId from the error response JSON",
          "Checkout Session ID (cs_...)",
          "Payment ID (pay_...)",
          "Webhook Event ID (eventId from event envelope)",
          "Error type and code",
          "Approximate timestamp (UTC)",
        ].map((item, i) => (
          <div key={i} className="flex items-start gap-3 border-b border-gray-100 px-4 py-3 text-xs leading-5 text-gray-700 last:border-0">
            <span className="mt-0.5 shrink-0 text-gray-300">•</span>
            {item}
          </div>
        ))}
      </div>
    </div>
  )
}

const docSectionComponents: Record<DocSection, () => ReactNode> = {
  "overview": DocSectionOverview,
  "quickstart": DocSectionQuickstart,
  "authentication": DocSectionAuthentication,
  "api-keys": DocSectionApiKeys,
  "checkout-sessions": DocSectionCheckoutSessions,
  "browser-checkout": DocSectionBrowserCheckout,
  "payments": DocSectionPayments,
  "session-statuses": DocSectionSessionStatuses,
  "rails-assets": DocSectionRailsAssets,
  "payment-states": DocSectionPaymentStates,
  "webhooks": DocSectionWebhooks,
  "webhook-payload": DocSectionWebhookPayload,
  "webhook-events": DocSectionWebhookEvents,
  "webhook-deliveries": DocSectionWebhookDeliveries,
  "errors": DocSectionErrors,
  "idempotency": DocSectionIdempotency,
  "sdks": DocSectionSdks,
  "testing": DocSectionTesting,
  "go-live": DocSectionGoLive,
  "not-yet-supported": DocSectionNotYetSupported,
  "support": DocSectionSupport,
}

const headerChipClass =
  "inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-semibold leading-5 text-blue-700"

function ApiReferencePanel({
  activeDoc,
  setActiveDoc,
}: {
  activeDoc: DocSection
  setActiveDoc: (section: DocSection) => void
}) {
  const SectionComponent = docSectionComponents[activeDoc]

  return (
    <DashboardSection title="Documents" titleTone="blue">
      <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        {/* Intro banner */}
        <div className="relative overflow-hidden border-b border-blue-100/80 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.13),transparent_34%),linear-gradient(135deg,#ffffff_0%,#f7fbff_48%,#eef5ff_100%)] px-5 py-5 sm:px-6">
          <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-blue-300/80 to-transparent" />
          <div className="relative">
            <p className={dashboardSectionLabelClass}>Documents</p>
            <h2 className={`mt-2 ${dashboardCardTitleClass}`}>PineTree API Reference</h2>
            <p className={`mt-1 max-w-2xl ${dashboardSupportingTextClass}`}>
              Accept crypto payments using API keys, checkout sessions, real-time webhooks, and SDKs for Node and browsers.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {["REST API", "Webhooks", "Node SDK", "Browser SDK"].map((pill) => (
                <span key={pill} className={headerChipClass}>{pill}</span>
              ))}
              <span className={headerChipClass}>app.pinetree-payments.com</span>
            </div>
          </div>
        </div>

        {/* Docs layout: stacked on mobile, sidebar+content on lg+ */}
        <div className="flex min-h-[480px] flex-col lg:flex-row">
          {/* Desktop sidebar — hidden on mobile */}
          <nav className="hidden w-56 shrink-0 border-r border-gray-100 bg-slate-50/45 py-3 lg:block lg:max-h-[calc(100dvh-260px)] lg:overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {docNav.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveDoc(id)}
                className={`block w-full min-w-0 border-l-2 px-4 py-2 text-left text-xs font-medium transition ${
                  activeDoc === id
                    ? "border-blue-600 bg-blue-50/80 font-semibold text-blue-700"
                    : "border-transparent text-gray-500 hover:bg-white hover:text-gray-950"
                }`}
              >
                <span className="block truncate">{label}</span>
              </button>
            ))}
          </nav>

          {/* Mobile dropdown — hidden on lg+ */}
          <div className="border-b border-gray-100 bg-slate-50/60 px-4 py-3 lg:hidden">
            <select
              value={activeDoc}
              onChange={(e) => setActiveDoc(e.target.value as DocSection)}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 shadow-sm focus:outline-none focus:ring-4 focus:ring-blue-100"
            >
              {docNav.map(({ id, label }) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:overflow-y-auto lg:px-8">
            <SectionComponent />
          </div>
        </div>
      </div>
    </DashboardSection>
  )
}
