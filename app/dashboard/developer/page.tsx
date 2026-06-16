"use client"

import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { Book, Code2, KeyRound, Plug, Webhook } from "lucide-react"
import {
  DashboardSection,
  ProviderStatusPill,
  dashboardPageTitleClass,
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
        <button
          type="button"
          onClick={() => setTab("docs")}
          aria-pressed={tab === "docs"}
          className={`w-full rounded-2xl border p-4 text-left shadow-[0_8px_24px_rgba(15,23,42,0.04)] transition ${
            tab === "docs"
              ? "border-blue-200 bg-blue-50/60"
              : "border-gray-200/80 bg-white hover:border-blue-200 hover:bg-blue-50/30"
          } focus:outline-none focus:ring-4 focus:ring-blue-100`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
              <Book className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-gray-950">API Reference</h2>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Live</span>
              </div>
              <p className="mt-0.5 text-[12px] leading-5 text-gray-500">
                Full documentation — endpoints, authentication, webhooks, SDKs, and integration guides.
              </p>
            </div>
            <span className="hidden shrink-0 text-[11.5px] font-semibold text-blue-700 sm:inline">View docs →</span>
          </div>
        </button>
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
      {tab === "docs" && <ApiReferencePanel />}
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
  | "checkout-sessions"
  | "payments"
  | "webhooks"
  | "webhook-deliveries"
  | "errors"
  | "idempotency"
  | "testing"
  | "go-live"

const docNav: { id: DocSection; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "quickstart", label: "Quickstart" },
  { id: "authentication", label: "Authentication" },
  { id: "checkout-sessions", label: "Checkout Sessions" },
  { id: "payments", label: "Payments" },
  { id: "webhooks", label: "Webhooks" },
  { id: "webhook-deliveries", label: "Webhook Deliveries" },
  { id: "errors", label: "Errors" },
  { id: "idempotency", label: "Idempotency" },
  { id: "testing", label: "Testing" },
  { id: "go-live", label: "Go Live" },
]

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative my-3 max-w-full">
      <pre className="max-w-full overflow-x-auto rounded-xl bg-gray-900 px-4 py-3 text-[11.5px] leading-relaxed text-gray-200 font-mono [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <code className="block min-w-0">{children}</code>
      </pre>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(children).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1600)
          })
        }}
        className="absolute right-2.5 top-2.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10.5px] text-gray-400 transition hover:bg-white/10 hover:text-gray-200"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  )
}

function DocH2({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-8 mb-2.5 border-b border-gray-100 pb-2 text-[15px] font-700 text-gray-900 tracking-tight">
      {children}
    </h2>
  )
}

function DocTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="my-3 max-w-full overflow-x-auto rounded-xl border border-gray-200 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            {headers.map((h) => (
              <th key={h} className="px-3 py-2.5 text-left text-xs font-600 text-gray-500 tracking-wide">
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
                  <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-blue-800 font-mono">{cell}</code>
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
    <div className="my-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-2">
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-700 font-mono ${method === "POST" ? "bg-green-100 text-green-800" : "bg-blue-50 text-blue-800"}`}>
          {method}
        </span>
        <code className="min-w-0 break-all text-[12.5px] font-semibold text-gray-900">{path}</code>
      </div>
      <p className="break-words text-[12px] text-gray-500">{description}</p>
    </div>
  )
}

// Doc section components
function DocSectionOverview() {
  return (
    <div>
      <div className="mb-1 inline-block rounded-full bg-blue-50 px-3 py-1 text-[11px] font-700 text-blue-700">
        REST · Production
      </div>
      <h1 className="mb-2 text-2xl font-800 tracking-tight text-gray-950">PineTree API</h1>
      <p className="mb-6 text-[13.5px] leading-relaxed text-gray-500">
        Accept crypto payments across Solana, Base, Lightning, and more. The PineTree API gives you checkout sessions,
        real-time webhooks, and a hosted payment page — so your customers can pay with any wallet in under 60 seconds.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Base URL", "app.pinetree-payments.com"],
          ["API prefix", "Versioned REST routes"],
          ["Auth", "Bearer pt_live_..."],
          ["Flat fee", "$0.15 / tx"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <p className="mb-1 text-[11px] font-700 text-gray-500">{label}</p>
            <code className="text-[11.5px] text-gray-900">{value}</code>
          </div>
        ))}
      </div>
      <DocH2>Supported networks</DocH2>
      <DocTable
        headers={["Network", "Rail", "Status"]}
        rows={[
          ["Solana", "sol", "Live"],
          ["Base ETH", "base", "Live"],
          ["Base USDC", "base-usdc", "Live"],
          ["Lightning", "lightning", "Live"],
          ["Coinbase Commerce", "coinbase", "Live"],
          ["Shift4", "shift4", "Live"],
        ]}
      />
      <DocH2>Core concepts</DocH2>
      {[
        ["Checkout Session", "A payment intent with a hosted checkout URL. Customers pick a network and pay. Sessions expire after 24 hours."],
        ["Payment", "Tracks on-chain status. Lifecycle: open → processing → paid | failed | incomplete."],
        ["Webhook Event", "HMAC-signed HTTP POST when payment status changes. Use payment.confirmed to fulfill orders."],
      ].map(([title, desc]) => (
        <div key={title} className="mb-2.5 rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm">
          <p className="mb-1 text-[12.5px] font-700 text-gray-900">{title}</p>
          <p className="text-[12px] text-gray-500 leading-relaxed">{desc}</p>
        </div>
      ))}
    </div>
  )
}

function DocSectionQuickstart() {
  return (
    <div>
      <h1 className="mb-2 text-2xl font-800 tracking-tight text-gray-950">Quickstart</h1>
      <p className="mb-5 text-[13.5px] text-gray-500">Integrate PineTree in minutes.</p>
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
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[11px] font-700 text-blue-700 mt-0.5">
            {step}
          </div>
          <div className="flex-1 min-w-0">
            <p className="mb-1 text-[13px] font-700 text-gray-900">{title}</p>
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
      <h1 className="mb-2 text-2xl font-800 tracking-tight text-gray-950">Authentication</h1>
      <p className="mb-5 text-[13.5px] text-gray-500">Secret keys for server use. Public keys for browser use. Never mix them.</p>
      <DocH2>Authorization header</DocH2>
      <CodeBlock>{`Authorization: Bearer pt_live_your_api_key_here
Content-Type: application/json`}</CodeBlock>
      <DocH2>Key permissions</DocH2>
      <DocTable
        headers={["Permission", "Grants"]}
        rows={[
          ["checkout.sessions:create", "Create checkout sessions"],
          ["checkout.sessions:read", "List and retrieve sessions"],
          ["payments:read", "Retrieve payment objects"],
          ["webhooks:read", "List webhook deliveries"],
          ["webhooks:write", "Retry webhook deliveries"],
        ]}
      />
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-[12.5px] text-amber-800">
        <strong>Security:</strong> Never use <code className="rounded bg-amber-100 px-1 text-xs">pt_live_*</code> keys in browser code.
        Use <code className="rounded bg-amber-100 px-1 text-xs">pk_live_*</code> public keys with the Browser SDK for frontend checkout flows.
      </div>
    </div>
  )
}

function DocSectionCheckoutSessions() {
  return (
    <div>
      <h1 className="mb-2 text-2xl font-800 tracking-tight text-gray-950">Checkout Sessions</h1>
      <p className="mb-5 text-[13.5px] text-gray-500">Create a session server-side, redirect the customer to <code className="rounded bg-gray-100 px-1.5 text-xs text-blue-800">checkoutUrl</code>, and receive a webhook when payment is confirmed.</p>
      <RouteRow method="POST" path="/checkout/sessions" description="Create a session. Requires checkout.sessions:create." />
      <RouteRow method="GET" path="/checkout/sessions" description="List sessions. Supports status, reference, limit, date filters." />
      <RouteRow method="GET" path="/checkout/sessions/{id}" description="Retrieve a single session by ID." />
      <RouteRow method="POST" path="/checkout/sessions/{id}/cancel" description="Cancel an open session." />
      <RouteRow method="POST" path="/checkout/sessions/{id}/expire" description="Immediately expire a session." />
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
      <h1 className="mb-2 text-2xl font-800 tracking-tight text-gray-950">Payments</h1>
      <p className="mb-5 text-[13.5px] text-gray-500">Tracks on-chain payment status, network, and amount.</p>
      <RouteRow method="GET" path="/payments/{id}" description="Retrieve a payment. Requires payments:read." />
      <DocH2>Payment object</DocH2>
      <CodeBlock>{`{
  "id": "pay_01abc...",
  "object": "payment",
  "status": "paid",
  "amount": 2500,
  "currency": "USD",
  "network": "solana",
  "rail": "sol",
  "reference": "order_1042",
  "createdAt": "2026-06-16T12:01:00Z",
  "updatedAt": "2026-06-16T12:02:30Z"
}`}</CodeBlock>
      <DocH2>Payment lifecycle</DocH2>
      <CodeBlock>{`CREATED → PENDING → PROCESSING → CONFIRMED (status: "paid")
                             └→ FAILED    (status: "failed")
              └→ INCOMPLETE               (status: "incomplete")`}</CodeBlock>
      <p className="mt-3 text-[12.5px] text-gray-500">Terminal states are permanent. Use <code className="rounded bg-gray-100 px-1 text-xs text-blue-800">payment.confirmed</code> webhook for order fulfillment.</p>
    </div>
  )
}

function DocSectionWebhooks() {
  return (
    <div>
      <h1 className="mb-2 text-2xl font-800 tracking-tight text-gray-950">Webhooks</h1>
      <p className="mb-5 text-[13.5px] text-gray-500">HMAC-signed events delivered to your HTTPS endpoint when payment status changes.</p>
      <DocH2>Webhook headers</DocH2>
      <DocTable
        headers={["Header", "Description"]}
        rows={[
          ["PineTree-Signature", "HMAC-SHA256 hex of raw body"],
          ["PineTree-Timestamp", "ISO 8601 — must be within 5 minutes"],
          ["PineTree-Event-Id", "Unique event ID for deduplication"],
          ["PineTree-Webhook-Version", "2026-06-12"],
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
          ["payment.incomplete", "Session expired before payment"],
          ["payment.processing", "Transaction broadcast; awaiting confirmation"],
          ["payment.pending", "Customer wallet action detected"],
          ["payment.created", "Payment object first created"],
        ]}
      />
    </div>
  )
}

function DocSectionWebhookDeliveries() {
  return (
    <div>
      <h1 className="mb-2 text-2xl font-800 tracking-tight text-gray-950">Webhook Deliveries</h1>
      <p className="mb-5 text-[13.5px] text-gray-500">Inspect delivery history and retry failed events.</p>
      <RouteRow method="GET" path="/webhook-deliveries" description="List deliveries. Filter by status or eventType. Requires webhooks:read." />
      <RouteRow method="POST" path="/webhook-deliveries/{id}/retry" description="Manually retry a delivery. Requires webhooks:write." />
      <DocH2>Delivery statuses</DocH2>
      <DocTable
        headers={["Status", "Description"]}
        rows={[
          ["pending", "Not yet attempted or queued for retry"],
          ["delivered", "Your endpoint returned 2xx"],
          ["failed", "All attempts exhausted"],
        ]}
      />
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
      <h1 className="mb-2 text-2xl font-800 tracking-tight text-gray-950">Errors</h1>
      <p className="mb-5 text-[13.5px] text-gray-500">All errors return a consistent JSON structure.</p>
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
      <h1 className="mb-2 text-2xl font-800 tracking-tight text-gray-950">Idempotency</h1>
      <p className="mb-5 text-[13.5px] text-gray-500">Safely retry checkout session creation without duplicates.</p>
      <DocH2>Idempotency-Key header</DocH2>
      <p className="mb-2 text-[12.5px] text-gray-600">Add to <code className="rounded bg-gray-100 px-1 text-xs text-blue-800">POST /checkout/sessions</code>. Use your order ID as the key.</p>
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

function DocSectionTesting() {
  return (
    <div>
      <h1 className="mb-2 text-2xl font-800 tracking-tight text-gray-950">Testing</h1>
      <p className="mb-5 text-[13.5px] text-gray-500">PineTree uses live keys only. Test with small amounts and ngrok for local webhooks.</p>
      <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50/60 p-3.5 text-[12.5px] text-blue-800">
        <strong>No sandbox mode.</strong> Use amounts like <code className="rounded bg-blue-100 px-1 text-xs">1</code> ($0.01) for integration testing.
      </div>
      <DocH2>Platform test suite</DocH2>
      <CodeBlock>{`npm run lint       # 0 errors
npm run typecheck  # 0 errors
npx vitest run     # 506 tests pass
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
      <h1 className="mb-2 text-2xl font-800 tracking-tight text-gray-950">Go-Live Checklist</h1>
      <p className="mb-5 text-[13.5px] text-gray-500">Complete before accepting real payments.</p>
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
          <h2 className="mb-2 text-[13.5px] font-700 text-gray-900">{title}</h2>
          <div className="rounded-xl border border-gray-200 bg-white">
            {items.map((item, i) => (
              <div key={i} className="flex items-start gap-3 border-b border-gray-100 px-4 py-3 last:border-0 text-[12.5px] text-gray-700">
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

const docSectionComponents: Record<DocSection, () => ReactNode> = {
  "overview": DocSectionOverview,
  "quickstart": DocSectionQuickstart,
  "authentication": DocSectionAuthentication,
  "checkout-sessions": DocSectionCheckoutSessions,
  "payments": DocSectionPayments,
  "webhooks": DocSectionWebhooks,
  "webhook-deliveries": DocSectionWebhookDeliveries,
  "errors": DocSectionErrors,
  "idempotency": DocSectionIdempotency,
  "testing": DocSectionTesting,
  "go-live": DocSectionGoLive,
}

function ApiReferencePanel() {
  const [activeDoc, setActiveDoc] = useState<DocSection>("overview")
  const SectionComponent = docSectionComponents[activeDoc]

  return (
    <DashboardSection title="API Reference" titleTone="blue">
      <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        {/* Intro banner */}
        <div className="border-b border-gray-100 bg-gradient-to-r from-blue-50/40 to-white px-5 py-5 sm:px-6">
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-blue-500">Documentation</p>
          <h2 className="text-[15px] font-bold text-gray-950 sm:text-base">PineTree API Reference</h2>
          <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-gray-500">
            Accept crypto payments using API keys, checkout sessions, real-time webhooks, and SDKs for Node and browsers.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {["REST API", "Webhooks", "Node SDK", "Browser SDK"].map((pill) => (
              <span key={pill} className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700">
                {pill}
              </span>
            ))}
            <code className="rounded-full bg-gray-100 px-2.5 py-0.5 font-mono text-[10.5px] text-gray-500">
              app.pinetree-payments.com
            </code>
          </div>
        </div>

        {/* Docs layout: stacked on mobile, sidebar+content on lg+ */}
        <div className="flex min-h-[480px] flex-col lg:flex-row">
          {/* Desktop sidebar — hidden on mobile */}
          <nav className="hidden w-52 shrink-0 border-r border-gray-100 py-3 lg:block lg:max-h-[calc(100dvh-260px)] lg:overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {docNav.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveDoc(id)}
                className={`block w-full border-l-2 px-4 py-1.5 text-left text-[12.5px] transition ${
                  activeDoc === id
                    ? "border-blue-600 bg-blue-50/60 font-semibold text-blue-700"
                    : "border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* Mobile dropdown — hidden on lg+ */}
          <div className="border-b border-gray-100 px-4 py-3 lg:hidden">
            <select
              value={activeDoc}
              onChange={(e) => setActiveDoc(e.target.value as DocSection)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12.5px] text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-100"
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
