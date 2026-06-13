import {
  DashboardSection,
  dashboardPageTitleClass,
  dashboardSectionLabelClass,
  dashboardSupportingTextClass,
} from "@/components/dashboard/DashboardPrimitives"
import {
  Globe,
  Package,
  ShoppingCart,
} from "lucide-react"

function StatusBadge({
  label,
  color,
}: {
  label: string
  color: "green" | "blue" | "amber" | "gray"
}) {
  const styles = {
    green: "bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20",
    blue: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-700/20",
    amber: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20",
    gray: "bg-gray-100 text-gray-500 ring-1 ring-inset ring-gray-500/20",
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[color]}`}
    >
      {label}
    </span>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-gray-950 px-4 py-3.5 text-sm leading-relaxed text-gray-100">
      <code>{code}</code>
    </pre>
  )
}

function Step({
  n,
  title,
  children,
}: {
  n: number
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-4">
      <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[#0052FF] text-xs font-semibold text-white">
        {n}
      </div>
      <div className="min-w-0 flex-1 pb-6">
        <p className="mb-2.5 text-sm font-semibold text-gray-900">{title}</p>
        <div className="space-y-2">{children}</div>
      </div>
    </div>
  )
}

function RouteRow({
  method,
  path,
  description,
}: {
  method: "GET" | "POST"
  path: string
  description: string
}) {
  const methodStyle =
    method === "POST"
      ? "bg-blue-50 text-blue-700"
      : "bg-gray-100 text-gray-600"
  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="py-2.5 pr-4">
        <span
          className={`inline-block rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${methodStyle}`}
        >
          {method}
        </span>
      </td>
      <td className="py-2.5 pr-4">
        <code className="font-mono text-xs text-gray-800">{path}</code>
      </td>
      <td className={`py-2.5 text-sm text-gray-600`}>{description}</td>
    </tr>
  )
}

export default function DeveloperPage() {
  return (
    <div className="space-y-10 px-4 py-8 md:px-8">
      <div>
        <p className={dashboardSectionLabelClass}>Developer</p>
        <h1 className={`mt-1 ${dashboardPageTitleClass}`}>API &amp; SDK Reference</h1>
        <p className={`mt-2 max-w-2xl ${dashboardSupportingTextClass}`}>
          Integrate PineTree payments using the stable v1 REST contract and
          private SDK release candidates. Packages are not published to npm yet.
        </p>
      </div>

      <DashboardSection eyebrow="Release Candidate" title="Developer Stack Status">
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["API", "/api/v1", "Release candidate"],
            ["Node SDK", "@pinetree/node", "Private Beta"],
            ["JavaScript SDK", "@pinetree/js", "Preview"],
            ["React SDK", "@pinetree/react", "Private Beta"],
            ["npm publish", "All SDK packages", "Not yet public"],
            ["WooCommerce", "Plugin", "Coming Soon"],
            ["Shopify", "Plugin", "Coming Soon"],
          ].map(([title, detail, status]) => (
            <div key={title} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-gray-800">{title}</p>
                <span className="rounded bg-white px-2 py-1 text-xs font-medium text-gray-600">
                  {status}
                </span>
              </div>
              <code className="mt-2 block font-mono text-xs text-gray-500">{detail}</code>
            </div>
          ))}
        </div>
      </DashboardSection>

      {/* Quick Start */}
      <DashboardSection eyebrow="Getting Started" title="Quick Start">
        <div className="mt-4 max-w-2xl space-y-0">
          <Step n={1} title="Add the SDK">
            <p className={dashboardSupportingTextClass}>
              The Node SDK is currently in private beta. Reference it from your
              monorepo or install from a local path:
            </p>
            <CodeBlock
              code={`// package.json
"dependencies": {
  "@pinetree/node": "file:../../packages/pinetree-node"
}

// Or, once published to npm:
// npm install @pinetree/node`}
            />
          </Step>

          <Step n={2} title="Initialize the client">
            <p className={dashboardSupportingTextClass}>
              Create a client with your API key from the PineTree dashboard.
            </p>
            <CodeBlock
              code={`import PineTree from "@pinetree/node"

const client = new PineTree(process.env.PINETREE_API_KEY!)`}
            />
          </Step>

          <Step n={3} title="Create a checkout session">
            <p className={dashboardSupportingTextClass}>
              Amounts are in the smallest currency unit (cents for USD).
              Redirect the customer to <code className="font-mono text-xs text-gray-800">session.checkoutUrl</code>.
            </p>
            <CodeBlock
              code={`const session = await client.checkout.sessions.create({
  amount: 2500,           // $25.00 USD
  currency: "USD",
  reference: "order_abc123",
  successUrl: "https://example.com/success",
  cancelUrl:  "https://example.com/cancel",
})

// Redirect the customer to complete payment
res.redirect(session.checkoutUrl)`}
            />
          </Step>

          <Step n={4} title="Verify incoming webhooks">
            <p className={dashboardSupportingTextClass}>
              PineTree signs every delivery with HMAC-SHA256. Use{" "}
              <code className="font-mono text-xs text-gray-800">constructEvent</code> to verify the
              signature before processing.
            </p>
            <CodeBlock
              code={`import { WebhookVerificationError } from "@pinetree/node"

// Express — read the raw body before JSON parsing
app.post(
  "/webhooks/pinetree",
  express.raw({ type: "*/*" }),
  (req, res) => {
    let event
    try {
      event = client.webhooks.constructEvent(
        req.body,
        req.headers as Record<string, string>,
        process.env.PINETREE_WEBHOOK_SECRET!
      )
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        return res.status(400).send("Signature verification failed")
      }
      throw err
    }

    switch (event.type) {
      case "checkout.session.paid":
        // Fulfill the order
        break
      case "checkout.session.expired":
        // Mark as expired in your system
        break
    }

    res.status(200).end()
  }
)`}
            />
          </Step>

          <Step n={5} title="Manage sessions">
            <CodeBlock
              code={`// Retrieve a session
const session = await client.checkout.sessions.retrieve("cs_...")

// Cancel an open session
await client.checkout.sessions.cancel("cs_...")

// Expire a session (platform-side)
await client.checkout.sessions.expire("cs_...")

// List recent sessions
const list = await client.checkout.sessions.list({
  status: "open",
  limit: 20,
})`}
            />
          </Step>
        </div>
      </DashboardSection>

      {/* REST API */}
      <DashboardSection
        eyebrow="API Reference"
        title="REST API"
        action={
          <div className="flex items-center gap-3">
            <StatusBadge label="Preview" color="blue" />
            <div className="flex items-center gap-1.5 text-sm text-gray-500">
              <Globe className="h-4 w-4" />
              <span>Base URL: api/v1</span>
            </div>
          </div>
        }
      >
        <div className="mt-4 space-y-6">
          <div>
            <p className={`mb-3 ${dashboardSupportingTextClass}`}>
              Authenticate every request with your API key in the{" "}
              <code className="font-mono text-xs text-gray-800">Authorization</code> header:
            </p>
            <CodeBlock code={`Authorization: Bearer pt_live_<your-api-key>`} />
          </div>

          <div>
            <p className="mb-3 text-sm font-medium text-gray-700">Checkout Sessions</p>
            <table className="w-full text-left">
              <tbody>
                <RouteRow
                  method="POST"
                  path="/api/v1/checkout/sessions"
                  description="Create a new checkout session"
                />
                <RouteRow
                  method="GET"
                  path="/api/v1/checkout/sessions"
                  description="List sessions (filterable by status, reference, date)"
                />
                <RouteRow
                  method="GET"
                  path="/api/v1/checkout/sessions/:id"
                  description="Retrieve a single session"
                />
                <RouteRow
                  method="POST"
                  path="/api/v1/checkout/sessions/:id/cancel"
                  description="Cancel an open session"
                />
                <RouteRow
                  method="POST"
                  path="/api/v1/checkout/sessions/:id/expire"
                  description="Expire a session"
                />
              </tbody>
            </table>
          </div>

          <div>
            <p className="mb-3 text-sm font-medium text-gray-700">Browser Checkout</p>
            <p className={`mb-2 ${dashboardSupportingTextClass}`}>
              Authenticate with a public key header instead of{" "}
              <code className="font-mono text-xs text-gray-800">Authorization: Bearer</code>.
            </p>
            <table className="w-full text-left">
              <tbody>
                <RouteRow
                  method="POST"
                  path="/api/v1/browser/checkout/sessions"
                  description="Create a checkout session using a public key (X-PineTree-Public-Key header)"
                />
              </tbody>
            </table>
          </div>

          <div>
            <p className="mb-3 text-sm font-medium text-gray-700">Payments</p>
            <table className="w-full text-left">
              <tbody>
                <RouteRow
                  method="GET"
                  path="/api/v1/payments/:id"
                  description="Retrieve a payment by ID"
                />
              </tbody>
            </table>
          </div>

          <div>
            <p className="mb-3 text-sm font-medium text-gray-700">Webhook Deliveries</p>
            <table className="w-full text-left">
              <tbody>
                <RouteRow
                  method="GET"
                  path="/api/v1/webhook-deliveries"
                  description="List webhook delivery attempts"
                />
                <RouteRow
                  method="GET"
                  path="/api/v1/webhook-deliveries/:id"
                  description="Retrieve a delivery attempt"
                />
                <RouteRow
                  method="POST"
                  path="/api/v1/webhook-deliveries/:id/retry"
                  description="Retry a failed delivery"
                />
              </tbody>
            </table>
          </div>

          <div>
            <p className="mb-3 text-sm font-medium text-gray-700">Idempotency</p>
            <p className={`mb-2 ${dashboardSupportingTextClass}`}>
              Pass an <code className="font-mono text-xs text-gray-800">Idempotency-Key</code> header
              on any mutating request to safely retry on network failure. Keys expire after 24 hours.
            </p>
            <CodeBlock
              code={`Idempotency-Key: order_abc123_attempt_1

// SDK shorthand
await client.checkout.sessions.create(
  { amount: 2500, currency: "USD" },
  { idempotencyKey: "order_abc123_attempt_1" }
)`}
            />
          </div>

          <div>
            <p className="mb-3 text-sm font-medium text-gray-700">Session Status Values</p>
            <div className="flex flex-wrap gap-2">
              {(["open", "processing", "paid", "failed", "expired", "canceled"] as const).map(
                (s) => (
                  <code
                    key={s}
                    className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700"
                  >
                    {s}
                  </code>
                )
              )}
            </div>
          </div>
        </div>
      </DashboardSection>

      {/* Node SDK */}
      <DashboardSection
        eyebrow="SDK Reference"
        title="Node SDK"
        action={
          <div className="flex items-center gap-3">
            <StatusBadge label="Private Beta" color="amber" />
            <div className="flex items-center gap-1.5 text-sm text-gray-500">
              <Package className="h-4 w-4" />
              <span>@pinetree/node · v0.1.0 · Node ≥ 18</span>
            </div>
          </div>
        }
      >
        <div className="mt-4 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              {
                name: "checkout.sessions.create(params, options?)",
                desc: "Create a checkout session. Pass idempotencyKey in options.",
              },
              {
                name: "checkout.sessions.retrieve(id)",
                desc: "Retrieve a session by ID.",
              },
              {
                name: "checkout.sessions.list(params?)",
                desc: "List sessions with optional filters.",
              },
              {
                name: "checkout.sessions.cancel(id)",
                desc: "Cancel an open session.",
              },
              {
                name: "checkout.sessions.expire(id)",
                desc: "Expire a session.",
              },
              {
                name: "payments.retrieve(id)",
                desc: "Retrieve a payment by ID.",
              },
              {
                name: "webhookDeliveries.retrieve(id)",
                desc: "Get a delivery attempt.",
              },
              {
                name: "webhookDeliveries.list(params?)",
                desc: "List delivery attempts.",
              },
              {
                name: "webhookDeliveries.retry(id)",
                desc: "Retry a failed delivery.",
              },
              {
                name: "webhooks.constructEvent(body, headers, secret)",
                desc: "Verify a webhook signature and parse the event.",
              },
            ].map((m) => (
              <div key={m.name} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <code className="block font-mono text-xs text-gray-800 break-all">{m.name}</code>
                <p className="mt-1.5 text-xs text-gray-500">{m.desc}</p>
              </div>
            ))}
          </div>

          <div>
            <p className="mb-3 text-sm font-medium text-gray-700">Error Classes</p>
            <div className="space-y-2">
              {[
                {
                  name: "AuthenticationError",
                  desc: "Invalid or missing API key (HTTP 401)",
                },
                {
                  name: "PermissionError",
                  desc: "Key lacks the required permission (HTTP 403)",
                },
                {
                  name: "InvalidRequestError",
                  desc: "Bad request, not found, or conflict (HTTP 400/404/409)",
                },
                {
                  name: "IdempotencyConflictError",
                  desc: "Idempotency key reused with different params",
                },
                {
                  name: "APIConnectionError",
                  desc: "Network or timeout failure",
                },
                {
                  name: "WebhookVerificationError",
                  desc: "Signature mismatch, stale timestamp, or malformed payload",
                },
              ].map((e) => (
                <div key={e.name} className="flex gap-3">
                  <code className="w-52 flex-none font-mono text-xs text-gray-800">{e.name}</code>
                  <p className="text-sm text-gray-500">{e.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DashboardSection>

      {/* JavaScript SDK */}
      <DashboardSection
        eyebrow="Browser SDK"
        title="JavaScript SDK"
        action={
          <div className="flex items-center gap-3">
            <StatusBadge label="Preview" color="blue" />
            <div className="flex items-center gap-1.5 text-sm text-gray-500">
              <Globe className="h-4 w-4" />
              <span>@pinetree/js · v0.3.0 · Browser</span>
            </div>
          </div>
        }
      >
        <div className="mt-4 space-y-5 max-w-2xl">
          <p className={dashboardSupportingTextClass}>
            The browser JavaScript SDK creates checkout sessions directly from
            browser code using a public key. No server-side proxy is required.
            Opens the PineTree hosted checkout via redirect (default), popup,
            or embedded iframe. All modes return an event-ready result object.
          </p>
          <p className={dashboardSupportingTextClass}>
            Redirect: Preview. Popup: Preview. Embedded iframe: Preview.
            Lifecycle postMessage events: Preview.
          </p>

          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">Constructor</p>
            <CodeBlock
              code={`import PineTree from "@pinetree/js"

// Public key — safe in browser code and NEXT_PUBLIC_ env vars
const pinetree = new PineTree(process.env.NEXT_PUBLIC_PINETREE_PUBLIC_KEY)

// Or with options
const pinetree = new PineTree({
  publicKey: "pk_live_...",
  baseUrl: "http://localhost:3000",  // for local development
})`}
            />
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">checkout.open() — modes</p>
            <CodeBlock
              code={`import { CheckoutSessionError, CheckoutInitializationError } from "@pinetree/js"

// Redirect (Preview, default)
await pinetree.checkout.open({
  amount: 2500, currency: "USD", reference: "order_abc123",
  successUrl: "https://example.com/success",
  cancelUrl: "https://example.com/cancel",
})

// Popup (Preview)
const result = await pinetree.checkout.open({ amount: 2500, mode: "popup" })
const handleComplete = ({ status }) => console.log("Checkout status:", status)
result.on("complete", handleComplete)
result.off("complete", handleComplete)
result.destroy()

// Embedded iframe (Preview)
const result2 = await pinetree.checkout.open({
  amount: 2500,
  mode: "embedded",
  container: "#checkout-container",  // CSS selector or HTMLElement
})
result2.on("complete", ({ status }) => console.log("Checkout status:", status))`}
            />
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">Public key management</p>
            <p className={`mb-2 ${dashboardSupportingTextClass}`}>
              Create and manage browser public keys via the dashboard or REST API.
              Public keys are not secret — they can only create checkout sessions.
            </p>
            <table className="w-full text-left">
              <tbody>
                <RouteRow
                  method="GET"
                  path="/api/merchant/public-keys"
                  description="List active public keys"
                />
                <RouteRow
                  method="POST"
                  path="/api/merchant/public-keys"
                  description="Create a new public key"
                />
              </tbody>
            </table>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">Browser error classes</p>
            <div className="space-y-2">
              {[
                {
                  name: "PineTreeBrowserError",
                  desc: "Base class for all browser SDK errors",
                },
                {
                  name: "CheckoutInitializationError",
                  desc: "Invalid or missing public key (HTTP 401), or constructor misconfiguration",
                },
                {
                  name: "CheckoutSessionError",
                  desc: "Session creation failed (400/422/500) or network error",
                },
              ].map((e) => (
                <div key={e.name} className="flex gap-3">
                  <code className="w-60 flex-none font-mono text-xs text-gray-800">{e.name}</code>
                  <p className="text-sm text-gray-500">{e.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <p className={dashboardSupportingTextClass}>
            See{" "}
            <code className="font-mono text-xs text-gray-800">docs/api/browser-sdk.md</code>{" "}
            for the full reference and roadmap.
          </p>
        </div>
      </DashboardSection>

      {/* React SDK */}
      <DashboardSection
        eyebrow="React SDK"
        title="React Components"
        action={
          <div className="flex items-center gap-3">
            <StatusBadge label="Private Beta" color="blue" />
            <div className="flex items-center gap-1.5 text-sm text-gray-500">
              <Package className="h-4 w-4" />
              <span>@pinetree/react · v0.1.0 · Local only</span>
            </div>
          </div>
        }
      >
        <div className="mt-4 max-w-2xl space-y-5">
          <p className={dashboardSupportingTextClass}>
            The private React package wraps @pinetree/js with a provider, hook,
            checkout button, and embedded checkout component. It is not
            published and is available only as a local package.
          </p>
          <CodeBlock
            code={`import {
  PineTreeProvider,
  PineTreeCheckoutButton,
  PineTreeCheckout,
} from "@pinetree/react"

<PineTreeProvider publicKey="pk_live_...">
  <PineTreeCheckoutButton amount={1000} mode="popup">
    Pay with PineTree
  </PineTreeCheckoutButton>

  <PineTreeCheckout
    amount={1000}
    rails={["base", "solana"]}
    onComplete={({ status }) => console.log(status)}
  />
</PineTreeProvider>`}
          />
          <p className={dashboardSupportingTextClass}>
            See{" "}
            <code className="font-mono text-xs text-gray-800">docs/api/react-sdk.md</code>{" "}
            for the private beta guide.
          </p>
        </div>
      </DashboardSection>

      {/* Webhooks */}
      <DashboardSection eyebrow="Webhooks" title="Webhook Events">
        <div className="mt-4 space-y-6 max-w-2xl">
          <div>
            <p className={dashboardSupportingTextClass}>
              PineTree sends an HTTP POST to your endpoint for each event. Every
              request includes these headers:
            </p>
            <div className="mt-3 space-y-1.5">
              {[
                ["PineTree-Signature", "sha256=<hmac-sha256 of raw body>"],
                ["PineTree-Timestamp", "ISO-8601 timestamp of the event"],
                ["PineTree-Event-Id", "Unique event identifier for deduplication"],
                ["PineTree-Webhook-Version", "2026-06-12"],
              ].map(([header, desc]) => (
                <div key={header} className="flex items-start gap-3">
                  <code className="w-56 flex-none font-mono text-xs text-gray-800">{header}</code>
                  <span className="text-sm text-gray-500">{desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-3 text-sm font-medium text-gray-700">Event Types</p>
            <div className="space-y-1.5">
              {[
                ["checkout.session.created", "A new checkout session was created"],
                ["checkout.session.paid", "Payment completed successfully"],
                ["checkout.session.failed", "Payment attempt failed"],
                ["checkout.session.expired", "Session expired without payment"],
                ["checkout.session.canceled", "Session was canceled by the merchant"],
              ].map(([type, desc]) => (
                <div key={type} className="flex items-start gap-3">
                  <code className="w-56 flex-none font-mono text-xs text-gray-800">{type}</code>
                  <span className="text-sm text-gray-500">{desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-gray-700">Event Payload Shape</p>
            <CodeBlock
              code={`{
  "eventId":   "evt_...",
  "type":      "checkout.session.paid",
  "createdAt": "2026-06-12T12:00:00.000Z",
  "data": {
    "object": { /* CheckoutSession or Payment */ }
  }
}`}
            />
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-medium text-amber-800">Replay window</p>
            <p className="mt-1 text-sm text-amber-700">
              Webhooks with a timestamp older than 5 minutes are rejected by{" "}
              <code className="font-mono text-xs">constructEvent</code>. Ensure your server
              clock is synchronized.
            </p>
          </div>
        </div>
      </DashboardSection>

      {/* Integration Testing */}
      <DashboardSection eyebrow="Testing" title="Integration Testing">
        <div className="mt-4 max-w-2xl space-y-4">
          <p className={dashboardSupportingTextClass}>
            The SDK ships an opt-in integration suite at{" "}
            <code className="font-mono text-xs text-gray-800">packages/pinetree-node/test/integration</code>.
            All integration tests require explicit opt-in — they never run as part of
            the normal test suite.
          </p>
          <CodeBlock
            code={`# 1. Start the dev server
npm run dev

# 2. Create a local integration key
node packages/pinetree-node/scripts/setup-integration.mjs \\
  --merchant-id <your-merchant-uuid>

# 3. Set the printed env vars, then run
npm run test:integration:local --workspace packages/pinetree-node`}
          />
          <p className={dashboardSupportingTextClass}>
            PineTree uses a single key format for all environments:{" "}
            <code className="font-mono text-xs text-gray-800">pt_live_&lt;64-hex&gt;</code>. Keys created
            in your local database are safe to use against a local server. See{" "}
            <code className="font-mono text-xs text-gray-800">docs/api/node-sdk-integration-testing.md</code>{" "}
            for the full guide.
          </p>
        </div>
      </DashboardSection>

      {/* Coming Soon */}
      <DashboardSection eyebrow="Roadmap" title="Coming Soon">
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              icon: ShoppingCart,
              title: "WooCommerce Plugin",
              description:
                "Accept crypto payments directly in WooCommerce stores with no custom code.",
            },
            {
              icon: ShoppingCart,
              title: "Shopify Plugin",
              description:
                "Native Shopify checkout integration for PineTree payment rails.",
            },
          ].map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="rounded-xl border border-gray-200 bg-gray-50 p-5 opacity-60"
            >
              <div className="mb-3 flex items-center gap-2.5">
                <Icon className="h-5 w-5 text-gray-400" />
                <span className="text-sm font-semibold text-gray-500">{title}</span>
                <StatusBadge label="Coming Soon" color="gray" />
              </div>
              <p className="text-xs leading-relaxed text-gray-400">{description}</p>
            </div>
          ))}
        </div>
      </DashboardSection>
    </div>
  )
}
