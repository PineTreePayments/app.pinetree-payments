"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { supabase } from "@/lib/supabaseClient"
import {
  CompactMetricTile,
  DashboardSection,
  MetricGrid,
  PineTreeInsightsCard,
} from "@/components/dashboard/DashboardPrimitives"
import Button from "@/components/ui/Button"

// ── Types ──────────────────────────────────────────────────────────────────────

type CheckoutLinkStatus = "active" | "disabled" | "expired"

type CheckoutLink = {
  id: string
  public_token: string
  name: string
  description: string | null
  amount: number
  currency: string
  customer_email: string | null
  reference: string | null
  status: CheckoutLinkStatus
  expires_at: string | null
  created_at: string
  checkoutUrl: string
  resolvedStatus: CheckoutLinkStatus
}

type Expiration = "never" | "24h" | "7d" | "30d"
type Tab = "links" | "integration" | "webhooks" | "developer"

type OnlineStats = {
  totalPayments: number
  confirmedPayments: number
  volumeUsd: number
  successRate: number | null
}

type WebhookConfig = {
  id: string
  url: string
  secret: string
  events: string[]
  enabled: boolean
} | null

// ── Constants ─────────────────────────────────────────────────────────────────

const EXPIRATION_LABELS: Record<Expiration, string> = {
  never: "Never",
  "24h": "24 Hours",
  "7d": "7 Days",
  "30d": "30 Days",
}

const ALL_WEBHOOK_EVENTS = [
  { id: "payment.confirmed", label: "payment.confirmed", description: "Fires when a payment is confirmed on-chain" },
  { id: "payment.failed", label: "payment.failed", description: "Fires when a payment fails or is rejected" },
  { id: "payment.incomplete", label: "payment.incomplete", description: "Fires when a payment is canceled mid-flow" },
  { id: "checkout.session.created", label: "checkout.session.created", description: "Fires when a new checkout session is created" },
]

const APP_BASE =
  (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "") ||
  "https://app.pinetree-payments.com"

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtUsd(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number.isFinite(n) ? n : 0
  )
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function statusPill(status: CheckoutLinkStatus) {
  const styles: Record<CheckoutLinkStatus, string> = {
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    disabled: "bg-gray-100 text-gray-500 border-gray-200",
    expired: "bg-amber-50 text-amber-700 border-amber-200",
  }
  const labels: Record<CheckoutLinkStatus, string> = {
    active: "Active",
    disabled: "Disabled",
    expired: "Expired",
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-none ${styles[status]}`}>
      {labels[status]}
    </span>
  )
}

// ── Badge variants ─────────────────────────────────────────────────────────────

function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
      Live
    </span>
  )
}

function PreviewBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
      Preview
    </span>
  )
}

function SoonBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
      Coming Soon
    </span>
  )
}

// ── CopyRow ───────────────────────────────────────────────────────────────────

function CopyRow({
  label,
  value,
  fieldId,
  copiedField,
  onCopy,
  badge,
  mono = true,
}: {
  label: string
  value: string
  fieldId: string
  copiedField: string | null
  onCopy: (id: string, value: string) => void
  badge?: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/60 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">
          {label}
          {badge}
        </p>
        <p className={`truncate text-xs text-gray-800 ${mono ? "font-mono" : ""}`}>{value}</p>
      </div>
      <button
        type="button"
        onClick={() => onCopy(fieldId, value)}
        className="shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 transition-colors hover:border-[#0052FF]/30 hover:text-[#0052FF]"
      >
        {copiedField === fieldId ? "Copied ✓" : "Copy"}
      </button>
    </div>
  )
}

// ── CodeBlock ─────────────────────────────────────────────────────────────────

function CodeBlock({
  code,
  fieldId,
  copiedField,
  onCopy,
  lang,
}: {
  code: string
  fieldId: string
  copiedField: string | null
  onCopy: (id: string, value: string) => void
  lang?: string
}) {
  return (
    <div className="relative rounded-xl border border-gray-800 bg-gray-950 p-4">
      {lang && (
        <span className="absolute left-4 top-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          {lang}
        </span>
      )}
      <pre className={`overflow-x-auto pr-16 text-[11px] leading-relaxed text-green-400 ${lang ? "mt-4" : ""}`}>
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={() => onCopy(fieldId, code)}
        className="absolute right-3 top-3 rounded-lg border border-gray-700 bg-gray-800 px-2.5 py-1 text-[11px] font-semibold text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
      >
        {copiedField === fieldId ? "Copied ✓" : "Copy"}
      </button>
    </div>
  )
}

// ── Integration Option Card ────────────────────────────────────────────────────

type IntegrationOption = {
  id: string
  title: string
  description: string
  useCase: string
  difficulty: "Easy" | "Medium" | "Advanced"
  status: "live" | "preview" | "soon"
  action?: string
}

function IntegrationCard({
  option,
  onAction,
}: {
  option: IntegrationOption
  onAction?: (id: string) => void
}) {
  const difficultyColor = {
    Easy: "text-emerald-600 bg-emerald-50 border-emerald-200",
    Medium: "text-amber-600 bg-amber-50 border-amber-200",
    Advanced: "text-blue-600 bg-blue-50 border-blue-200",
  }[option.difficulty]

  const statusEl =
    option.status === "live" ? <LiveBadge /> :
    option.status === "preview" ? <PreviewBadge /> :
    <SoonBadge />

  return (
    <div className={`flex flex-col rounded-2xl border bg-white p-5 shadow-sm transition-all ${
      option.status === "soon"
        ? "border-gray-100 opacity-60"
        : "border-gray-200/80 hover:border-[#0052FF]/25 hover:shadow-[0_8px_24px_rgba(0,82,255,0.08)]"
    }`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-950">{option.title}</h3>
        {statusEl}
      </div>
      <p className="mb-3 text-xs leading-relaxed text-gray-500">{option.description}</p>
      <div className="mt-auto space-y-2">
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <span className="font-medium text-gray-700">Best for:</span>
          {option.useCase}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-gray-700">Setup:</span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${difficultyColor}`}>
            {option.difficulty}
          </span>
        </div>
      </div>
      {option.action && option.status !== "soon" && onAction && (
        <button
          type="button"
          onClick={() => onAction(option.id)}
          className="mt-4 w-full rounded-xl border border-[#0052FF]/20 bg-[#0052FF]/5 px-3 py-2 text-xs font-semibold text-[#0052FF] transition-colors hover:bg-[#0052FF]/10"
        >
          {option.action}
        </button>
      )}
      {option.status === "soon" && (
        <div className="mt-4 w-full rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-center text-xs font-medium text-gray-400">
          Coming Soon
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OnlineCheckoutPage() {
  const [links, setLinks] = useState<CheckoutLink[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [disablingId, setDisablingId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("links")
  const [merchantId, setMerchantId] = useState("")
  const [copiedField, setCopiedField] = useState<string | null>(null)

  // Stats
  const [stats, setStats] = useState<OnlineStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)

  // Webhook config
  const [webhookConfig, setWebhookConfig] = useState<WebhookConfig>(null)
  const [webhookLoading, setWebhookLoading] = useState(true)
  const [webhookUrl, setWebhookUrl] = useState("")
  const [webhookEvents, setWebhookEvents] = useState<string[]>(ALL_WEBHOOK_EVENTS.map((e) => e.id))
  const [webhookSaving, setWebhookSaving] = useState(false)
  const [showSecret, setShowSecret] = useState(false)

  // Form state
  const [name, setName] = useState("")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [customerEmail, setCustomerEmail] = useState("")
  const [reference, setReference] = useState("")
  const [expiration, setExpiration] = useState<Expiration>("never")
  const [formError, setFormError] = useState("")

  const authRef = useRef<string>("")

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    authRef.current = data.session?.access_token ?? ""
    if (data.session?.user?.id && !merchantId) {
      setMerchantId(data.session.user.id)
    }
    return authRef.current
  }, [merchantId])

  const fetchLinks = useCallback(async () => {
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch("/api/checkout-links", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      if (!res.ok) return
      const data = (await res.json()) as { links: CheckoutLink[] }
      setLinks(data.links ?? [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [getToken])

  const fetchStats = useCallback(async () => {
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch("/api/checkout/stats", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      if (!res.ok) return
      const data = (await res.json()) as OnlineStats
      setStats(data)
    } catch {
      // silent
    } finally {
      setStatsLoading(false)
    }
  }, [getToken])

  const fetchWebhookConfig = useCallback(async () => {
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch("/api/merchant/webhooks", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      if (!res.ok) return
      const data = (await res.json()) as { webhook: WebhookConfig }
      const wh = data.webhook
      if (wh) {
        setWebhookConfig(wh)
        setWebhookUrl(wh.url)
        setWebhookEvents(wh.events)
      }
    } catch {
      // silent
    } finally {
      setWebhookLoading(false)
    }
  }, [getToken])

  useEffect(() => {
    void fetchLinks()
    void fetchStats()
  }, [fetchLinks, fetchStats])

  useEffect(() => {
    if (tab === "webhooks") {
      void fetchWebhookConfig()
    }
  }, [tab, fetchWebhookConfig])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError("")
    const parsedAmount = parseFloat(amount)
    if (!name.trim()) { setFormError("Link name is required."); return }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) { setFormError("Enter a valid amount."); return }
    setSubmitting(true)
    try {
      const token = await getToken()
      const res = await fetch("/api/checkout-links", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: name.trim(),
          amount: parsedAmount,
          description: description.trim() || undefined,
          customerEmail: customerEmail.trim() || undefined,
          reference: reference.trim() || undefined,
          expiration,
        }),
      })
      const data = (await res.json()) as { link?: CheckoutLink; error?: string }
      if (!res.ok) throw new Error(data.error || "Failed to create link")
      if (data.link) {
        setLinks((prev) => [data.link!, ...prev])
        toast.success("Payment link created")
        setName(""); setAmount(""); setDescription(""); setCustomerEmail(""); setReference(""); setExpiration("never")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create link")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDisable(id: string) {
    setDisablingId(id)
    try {
      const token = await getToken()
      const res = await fetch(`/api/checkout-links/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: "disabled" }),
      })
      const data = (await res.json()) as { link?: CheckoutLink; error?: string }
      if (!res.ok) throw new Error(data.error || "Failed to disable link")
      if (data.link) {
        setLinks((prev) => prev.map((l) => (l.id === id ? (data.link as CheckoutLink) : l)))
        toast.success("Link disabled")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disable link")
    } finally {
      setDisablingId(null)
    }
  }

  async function handleCopyLink(id: string, url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1800)
    } catch {
      toast.error("Could not copy to clipboard")
    }
  }

  function handleCopyField(fieldId: string, value: string) {
    navigator.clipboard
      .writeText(value)
      .then(() => { setCopiedField(fieldId); setTimeout(() => setCopiedField(null), 1800) })
      .catch(() => toast.error("Could not copy to clipboard"))
  }

  async function handleSaveWebhook(e: React.FormEvent) {
    e.preventDefault()
    const url = webhookUrl.trim()
    if (!url) { toast.error("Webhook URL is required"); return }
    setWebhookSaving(true)
    try {
      const token = await getToken()
      const res = await fetch("/api/merchant/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url, events: webhookEvents }),
      })
      const data = (await res.json()) as { webhook?: WebhookConfig; error?: string }
      if (!res.ok) throw new Error(data.error || "Failed to save webhook")
      if (data.webhook) {
        setWebhookConfig(data.webhook)
        toast.success("Webhook configuration saved")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save webhook")
    } finally {
      setWebhookSaving(false)
    }
  }

  async function handleRegenerateSecret() {
    const url = webhookConfig?.url || webhookUrl.trim()
    if (!url) { toast.error("Save a webhook URL first"); return }
    setWebhookSaving(true)
    try {
      const token = await getToken()
      const res = await fetch("/api/merchant/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url, events: webhookEvents, regenerateSecret: true }),
      })
      const data = (await res.json()) as { webhook?: WebhookConfig; error?: string }
      if (!res.ok) throw new Error(data.error || "Failed to regenerate secret")
      if (data.webhook) {
        setWebhookConfig(data.webhook)
        setShowSecret(true)
        toast.success("Signing secret regenerated")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to regenerate secret")
    } finally {
      setWebhookSaving(false)
    }
  }

  function toggleWebhookEvent(eventId: string) {
    setWebhookEvents((prev) =>
      prev.includes(eventId) ? prev.filter((e) => e !== eventId) : [...prev, eventId]
    )
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  const activeLinks = links.filter((l) => l.resolvedStatus === "active").length
  const isLoading = loading || statsLoading

  const insights: string[] = []
  if (activeLinks > 0) insights.push(`${activeLinks} active payment link${activeLinks !== 1 ? "s" : ""} ready to accept payments.`)
  if (links.length === 0 && !loading) insights.push("Create your first payment link to start accepting online payments.")
  const disabledCount = links.filter((l) => l.resolvedStatus === "disabled").length
  if (disabledCount > 0) insights.push(`${disabledCount} link${disabledCount !== 1 ? "s" : ""} currently disabled.`)
  if (stats && stats.confirmedPayments > 0) insights.push(`${stats.confirmedPayments} confirmed online payment${stats.confirmedPayments !== 1 ? "s" : ""} via checkout links.`)

  // ── Snippet content ──────────────────────────────────────────────────────────
  const sessionEndpoint = `${APP_BASE}/api/checkout/session`
  const checkoutUrlPattern = `${APP_BASE}/checkout/{token}`

  const htmlSnippet = `<!-- PineTree: link your existing checkout button to a payment link -->
<a href="${APP_BASE}/checkout/YOUR_LINK_TOKEN" target="_blank">
  <button>Pay with Crypto</button>
</a>`

  const jsSnippet = `// PineTree: create a session from your backend and redirect
const res = await fetch('${sessionEndpoint}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer <your_token>'
  },
  body: JSON.stringify({
    amount: 49.99,
    currency: 'USD',
    orderId: 'order_1042',
    customerEmail: 'customer@example.com',
    successUrl: 'https://yourstore.com/success',
    cancelUrl: 'https://yourstore.com/cancel'
  })
})
const { session } = await res.json()
window.location.href = session.checkoutUrl`

  const curlSnippet = `curl -X POST ${sessionEndpoint} \\
  -H "Authorization: Bearer <your_token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 49.99,
    "currency": "USD",
    "orderId": "order_1042",
    "customerEmail": "customer@example.com",
    "successUrl": "https://yourstore.com/success",
    "cancelUrl": "https://yourstore.com/cancel"
  }'`

  const reactSnippet = `// Future React SDK — not yet available as an npm package
import { PineTreeCheckoutButton } from '@pinetree/react'

export default function CheckoutPage() {
  return (
    <PineTreeCheckoutButton
      amount={49.99}
      orderId="order_1042"
      onSuccess={(session) => router.push('/success')}
    />
  )
}`

  const inputClass =
    "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-[#0052FF] focus:ring-2 focus:ring-[#0052FF]/10"
  const labelClass = "text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500"

  const TABS: { id: Tab; label: string }[] = [
    { id: "links", label: "Payment Links" },
    { id: "integration", label: "Integration" },
    { id: "webhooks", label: "Webhooks" },
    { id: "developer", label: "Developer" },
  ]

  const INTEGRATION_OPTIONS: IntegrationOption[] = [
    {
      id: "hosted-link",
      title: "Hosted Checkout Link",
      description: "Share a payment link via email, SMS, or invoice. Customers click and pay — no code required.",
      useCase: "Invoices, one-off payments",
      difficulty: "Easy",
      status: "live",
      action: "Create a Payment Link",
    },
    {
      id: "js-session",
      title: "JavaScript Checkout",
      description: "Create a checkout session from your backend and redirect customers to a hosted crypto payment page.",
      useCase: "E-commerce checkout flows",
      difficulty: "Medium",
      status: "preview",
      action: "View Code Example",
    },
    {
      id: "html-button",
      title: "Pay with Crypto Button",
      description: "Add a simple HTML link pointing to any active payment link. Drop it into any page with zero setup.",
      useCase: "Landing pages, simple sites",
      difficulty: "Easy",
      status: "live",
      action: "View HTML Snippet",
    },
    {
      id: "rest-api",
      title: "REST API",
      description: "Full server-side control: create sessions, list links, query payment status. Auth via bearer token.",
      useCase: "Custom integrations, marketplaces",
      difficulty: "Advanced",
      status: "preview",
      action: "View API Docs",
    },
    {
      id: "shopify",
      title: "Shopify Plugin",
      description: "Install PineTree as a payment method directly in your Shopify store checkout.",
      useCase: "Shopify merchants",
      difficulty: "Easy",
      status: "soon",
    },
    {
      id: "woocommerce",
      title: "WooCommerce Plugin",
      description: "Accept crypto payments natively inside your WooCommerce WordPress store.",
      useCase: "WooCommerce stores",
      difficulty: "Easy",
      status: "soon",
    },
    {
      id: "react-sdk",
      title: "React SDK",
      description: "Drop-in React component — mount a checkout button and PineTree handles the rest.",
      useCase: "React / Next.js apps",
      difficulty: "Easy",
      status: "soon",
    },
  ]

  function handleIntegrationAction(id: string) {
    if (id === "hosted-link") { setTab("links"); return }
    if (id === "js-session" || id === "html-button" || id === "rest-api") { setTab("developer"); return }
  }

  return (
    <div className="space-y-6 md:space-y-8">

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">Online Checkout</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-gray-950 sm:text-2xl">Online Payments</h1>
        <p className="mt-1 text-sm text-gray-500">
          Payment links, website integration, webhooks, and developer tools.
        </p>
      </div>

      {/* ── Summary metrics ──────────────────────────────────────────────── */}
      <MetricGrid columns="four">
        <CompactMetricTile
          label="Active Links"
          value={isLoading ? "—" : String(activeLinks)}
          tone="blue"
        />
        <CompactMetricTile
          label="Online Payments"
          value={isLoading ? "—" : String(stats?.confirmedPayments ?? 0)}
          detail={!isLoading && !stats?.confirmedPayments ? "No online payments yet" : undefined}
        />
        <CompactMetricTile
          label="Online Volume"
          value={isLoading ? "—" : fmtUsd(stats?.volumeUsd ?? 0)}
          tone="green"
          detail={!isLoading && !stats?.volumeUsd ? "No online payments yet" : undefined}
        />
        <CompactMetricTile
          label="Success Rate"
          value={isLoading ? "—" : stats?.successRate !== null && stats?.successRate !== undefined ? `${String(stats.successRate)}%` : "—"}
          detail="Confirmed vs total"
        />
      </MetricGrid>

      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div className="flex gap-1 rounded-xl border border-gray-200 bg-gray-50/80 p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-all ${
              tab === t.id
                ? "bg-white text-gray-950 shadow-sm ring-1 ring-gray-200/80"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PAYMENT LINKS TAB                                                  */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === "links" && (
        <>
          <DashboardSection title="New Payment Link">
            <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-6">
              <form onSubmit={(e) => void handleCreate(e)} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className={labelClass}>Link Name <span className="text-red-400">*</span></label>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Invoice #42, Product Payment" className={inputClass} />
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelClass}>Amount (USD) <span className="text-red-400">*</span></label>
                    <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00" min="0.01" step="0.01" className={inputClass} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className={labelClass}>Description</label>
                  <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional — shown to customer" className={inputClass} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className={labelClass}>Customer Email</label>
                    <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)}
                      placeholder="customer@example.com" className={inputClass} />
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelClass}>Reference / Order ID</label>
                    <input type="text" value={reference} onChange={(e) => setReference(e.target.value)}
                      placeholder="Optional order reference" className={inputClass} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className={labelClass}>Link Expiration</label>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(EXPIRATION_LABELS) as Expiration[]).map((opt) => (
                      <button key={opt} type="button" onClick={() => setExpiration(opt)}
                        className={`rounded-xl border px-3.5 py-2 text-xs font-semibold transition-all ${
                          expiration === opt
                            ? "border-[#0052FF]/30 bg-[#0052FF]/8 text-[#0052FF] shadow-sm shadow-[#0052FF]/10"
                            : "border-gray-200 bg-white text-gray-600 hover:border-[#0052FF]/20 hover:text-[#0052FF]"
                        }`}>
                        {EXPIRATION_LABELS[opt]}
                      </button>
                    ))}
                  </div>
                </div>
                {formError && (
                  <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{formError}</p>
                )}
                <div className="pt-1">
                  <Button type="submit" disabled={submitting}>
                    {submitting ? (
                      <><span className="mr-2 inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin" />Creating…</>
                    ) : "Create Payment Link"}
                  </Button>
                </div>
              </form>
            </div>
          </DashboardSection>

          <DashboardSection title="Your Payment Links">
            {loading ? (
              <div className="rounded-2xl border border-gray-200/80 bg-white p-8 shadow-[0_10px_30px_rgba(15,23,42,0.05)] text-center">
                <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-[#0052FF] border-t-transparent" />
              </div>
            ) : links.length === 0 ? (
              <div className="rounded-2xl border border-gray-200/80 bg-white p-8 shadow-[0_10px_30px_rgba(15,23,42,0.05)] text-center">
                <p className="text-sm text-gray-500">No payment links yet. Create one above.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        {["Name", "Amount", "Status", "Created", "Expires", ""].map((h) => (
                          <th key={h} className={`px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500 ${h === "" ? "text-right" : "text-left"}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {links.map((link) => (
                        <tr key={link.id} className="transition-colors hover:bg-gray-50/60">
                          <td className="px-5 py-4">
                            <div className="font-medium text-gray-900">{link.name}</div>
                            {link.description && <div className="mt-0.5 max-w-[200px] truncate text-xs text-gray-400">{link.description}</div>}
                          </td>
                          <td className="px-5 py-4 font-semibold text-gray-900">{fmtUsd(Number(link.amount))}</td>
                          <td className="px-5 py-4">{statusPill(link.resolvedStatus)}</td>
                          <td className="px-5 py-4 text-gray-500">{fmtDate(link.created_at)}</td>
                          <td className="px-5 py-4 text-gray-500">{link.expires_at ? fmtDate(link.expires_at) : "Never"}</td>
                          <td className="px-5 py-4">
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => void handleCopyLink(link.id, link.checkoutUrl)}
                                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:border-[#0052FF]/30 hover:text-[#0052FF]">
                                {copiedId === link.id ? "Copied ✓" : "Copy Link"}
                              </button>
                              <a href={link.checkoutUrl} target="_blank" rel="noopener noreferrer"
                                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:border-[#0052FF]/30 hover:text-[#0052FF]">
                                Open ↗
                              </a>
                              {link.resolvedStatus === "active" && (
                                <button onClick={() => void handleDisable(link.id)} disabled={disablingId === link.id}
                                  className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50">
                                  {disablingId === link.id ? "…" : "Disable"}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="divide-y divide-gray-100 md:hidden">
                  {links.map((link) => (
                    <div key={link.id} className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-gray-900">{link.name}</p>
                          {link.description && <p className="mt-0.5 truncate text-xs text-gray-400">{link.description}</p>}
                        </div>
                        <div className="shrink-0">{statusPill(link.resolvedStatus)}</div>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="font-semibold text-gray-900">{fmtUsd(Number(link.amount))}</span>
                        <span className="text-gray-400">{fmtDate(link.created_at)}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => void handleCopyLink(link.id, link.checkoutUrl)}
                          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700">
                          {copiedId === link.id ? "Copied ✓" : "Copy Link"}
                        </button>
                        <a href={link.checkoutUrl} target="_blank" rel="noopener noreferrer"
                          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700">
                          Open ↗
                        </a>
                        {link.resolvedStatus === "active" && (
                          <button onClick={() => void handleDisable(link.id)} disabled={disablingId === link.id}
                            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600">
                            {disablingId === link.id ? "…" : "Disable"}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </DashboardSection>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* INTEGRATION TAB                                                    */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === "integration" && (
        <div className="space-y-6">
          <DashboardSection title="Integration Options">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {INTEGRATION_OPTIONS.map((opt) => (
                <IntegrationCard key={opt.id} option={opt} onAction={handleIntegrationAction} />
              ))}
            </div>
          </DashboardSection>

          <DashboardSection title="Your Setup">
            <div className="space-y-2.5">
              {merchantId ? (
                <CopyRow label="Merchant ID" value={merchantId} fieldId="merchant_id"
                  copiedField={copiedField} onCopy={handleCopyField} badge={<LiveBadge />} />
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/60 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">Merchant ID</p>
                    <p className="text-xs text-gray-400">Sign in to view your Merchant ID</p>
                  </div>
                </div>
              )}
              <CopyRow label="Checkout Session Endpoint" value={`POST  ${sessionEndpoint}`}
                fieldId="session_endpoint" copiedField={copiedField} onCopy={handleCopyField} badge={<PreviewBadge />} />
              <CopyRow label="Hosted Checkout URL Pattern" value={checkoutUrlPattern}
                fieldId="checkout_url" copiedField={copiedField} onCopy={handleCopyField} badge={<LiveBadge />} />
            </div>
          </DashboardSection>

          <div className="rounded-2xl border border-amber-200/80 bg-amber-50/60 px-4 py-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">Authentication</p>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-700">
              All API calls require a valid Supabase session token in the{" "}
              <code className="rounded bg-amber-100 px-1 font-mono text-[11px]">Authorization: Bearer &lt;token&gt;</code>{" "}
              header. Dedicated API keys for server-to-server use are on the roadmap.
            </p>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* WEBHOOKS TAB                                                       */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === "webhooks" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-950">Webhook Endpoint</h2>
                <p className="mt-0.5 text-xs text-gray-500">PineTree will POST signed event payloads to this URL.</p>
              </div>
              <PreviewBadge />
            </div>

            {webhookLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#0052FF] border-t-transparent" />
              </div>
            ) : (
              <form onSubmit={(e) => void handleSaveWebhook(e)} className="space-y-5">
                <div className="space-y-1.5">
                  <label className={labelClass}>Webhook URL</label>
                  <input type="url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://yoursite.com/api/pinetree-webhook" className={inputClass} />
                </div>

                <div className="space-y-2">
                  <label className={labelClass}>Events to receive</label>
                  <div className="space-y-2">
                    {ALL_WEBHOOK_EVENTS.map((evt) => (
                      <label key={evt.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-100 bg-gray-50/60 px-3.5 py-2.5 hover:border-[#0052FF]/20">
                        <input type="checkbox" checked={webhookEvents.includes(evt.id)}
                          onChange={() => toggleWebhookEvent(evt.id)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[#0052FF]" />
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-semibold text-gray-800">{evt.label}</p>
                          <p className="mt-0.5 text-[11px] text-gray-500">{evt.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <Button type="submit" disabled={webhookSaving}>
                    {webhookSaving ? "Saving…" : webhookConfig ? "Update Webhook" : "Save Webhook"}
                  </Button>
                </div>
              </form>
            )}
          </div>

          {webhookConfig?.secret && (
            <DashboardSection title="Signing Secret">
              <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                <div className="p-5 sm:p-6">
                  <p className="mb-4 text-xs leading-relaxed text-gray-500">
                    Verify incoming webhook calls using HMAC-SHA256. Compare the{" "}
                    <code className="rounded bg-gray-100 px-1 font-mono text-[11px]">X-PineTree-Signature</code>{" "}
                    header against a local signature built with this secret.
                  </p>
                  <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/60 px-3.5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">Signing Secret</p>
                      <p className="truncate font-mono text-xs text-gray-800">
                        {showSecret ? webhookConfig.secret : "••••••••••••••••••••••••••••••••"}
                      </p>
                    </div>
                    <button type="button" onClick={() => setShowSecret((v) => !v)}
                      className="shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:text-[#0052FF]">
                      {showSecret ? "Hide" : "Reveal"}
                    </button>
                    <button type="button" onClick={() => handleCopyField("webhook_secret", webhookConfig.secret)}
                      className="shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:text-[#0052FF]">
                      {copiedField === "webhook_secret" ? "Copied ✓" : "Copy"}
                    </button>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <button type="button" onClick={() => void handleRegenerateSecret()} disabled={webhookSaving}
                      className="rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50">
                      Regenerate Secret
                    </button>
                    <p className="text-[11px] text-gray-400">Regenerating immediately invalidates the old secret.</p>
                  </div>
                </div>

                <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-4 sm:px-6">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Verification example (Node.js)</p>
                  <CodeBlock
                    code={`const crypto = require('crypto')

function verifyPineTreeWebhook(body, signature, secret) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex')
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
  )
}`}
                    fieldId="verify_snippet"
                    copiedField={copiedField}
                    onCopy={handleCopyField}
                    lang="node.js"
                  />
                </div>
              </div>
            </DashboardSection>
          )}

          <div className="rounded-2xl border border-blue-200/80 bg-blue-50/60 px-4 py-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">Delivery Status</p>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-700">
              Webhook delivery logs are stored in the database. Automatic retries and a delivery history UI are on the roadmap.
              For now, configure your endpoint and PineTree will attempt delivery on each payment event.
            </p>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* DEVELOPER TAB                                                      */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === "developer" && (
        <div className="space-y-6">

          <DashboardSection title="HTML Button">
            <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
                <div>
                  <h3 className="text-sm font-semibold text-gray-950">Static HTML Button</h3>
                  <p className="mt-0.5 text-xs text-gray-500">Link any button to an active payment link — no backend needed.</p>
                </div>
                <LiveBadge />
              </div>
              <div className="p-5">
                <CodeBlock code={htmlSnippet} fieldId="html_snippet" copiedField={copiedField} onCopy={handleCopyField} lang="html" />
              </div>
            </div>
          </DashboardSection>

          <DashboardSection title="JavaScript Checkout Session">
            <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
                <div>
                  <h3 className="text-sm font-semibold text-gray-950">Create Session & Redirect</h3>
                  <p className="mt-0.5 text-xs text-gray-500">Create a hosted session from your server and send the customer to the returned URL.</p>
                </div>
                <PreviewBadge />
              </div>
              <div className="p-5">
                <CodeBlock code={jsSnippet} fieldId="js_snippet" copiedField={copiedField} onCopy={handleCopyField} lang="javascript" />
              </div>
            </div>
          </DashboardSection>

          <DashboardSection title="REST API — cURL">
            <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
                <div>
                  <h3 className="text-sm font-semibold text-gray-950">POST /api/checkout/session</h3>
                  <p className="mt-0.5 text-xs text-gray-500">Create a checkout session from any backend and redirect to <code className="rounded bg-gray-100 px-1 font-mono text-[10px]">session.checkoutUrl</code>.</p>
                </div>
                <PreviewBadge />
              </div>
              <div className="space-y-3 p-5">
                <CodeBlock code={curlSnippet} fieldId="curl_snippet" copiedField={copiedField} onCopy={handleCopyField} lang="curl" />
                <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">Response</p>
                  <pre className="overflow-x-auto text-[11px] leading-relaxed text-gray-700">
                    <code>{`{
  "session": {
    "sessionId": "...",
    "checkoutUrl": "${APP_BASE}/checkout/{token}",
    "amount": 49.99,
    "currency": "USD",
    "status": "active"
  }
}`}</code>
                  </pre>
                </div>
              </div>
            </div>
          </DashboardSection>

          <DashboardSection title="React SDK">
            <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
                <div>
                  <h3 className="text-sm font-semibold text-gray-950">@pinetree/react</h3>
                  <p className="mt-0.5 text-xs text-gray-500">Drop-in React component — not yet published as a package.</p>
                </div>
                <SoonBadge />
              </div>
              <div className="p-5">
                <div className="mb-3 rounded-xl border border-amber-200/80 bg-amber-50/60 px-3 py-2.5 text-xs text-amber-700">
                  <strong>Not yet available.</strong> The npm package <code className="font-mono">@pinetree/react</code> does not exist yet. This shows the intended future API.
                </div>
                <CodeBlock code={reactSnippet} fieldId="react_snippet" copiedField={copiedField} onCopy={handleCopyField} lang="react" />
              </div>
            </div>
          </DashboardSection>

          <div className="rounded-2xl border border-gray-100 bg-gray-50/60 px-4 py-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">API Reference</p>
            <div className="mt-2 space-y-1.5 text-xs text-gray-600">
              {[
                { method: "GET", path: "/api/checkout-links", desc: "List all payment links", status: "Live" },
                { method: "POST", path: "/api/checkout-links", desc: "Create a payment link", status: "Live" },
                { method: "PATCH", path: "/api/checkout-links/:id", desc: "Disable a payment link", status: "Live" },
                { method: "POST", path: "/api/checkout/session", desc: "Create a checkout session", status: "Preview" },
                { method: "GET", path: "/api/checkout/stats", desc: "Online payment stats", status: "Preview" },
                { method: "GET", path: "/api/merchant/webhooks", desc: "Get webhook config", status: "Preview" },
                { method: "POST", path: "/api/merchant/webhooks", desc: "Save webhook config", status: "Preview" },
              ].map((r) => (
                <div key={r.path} className="flex items-center gap-3">
                  <span className={`w-10 shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-bold ${
                    r.method === "GET" ? "bg-emerald-100 text-emerald-700" :
                    r.method === "POST" ? "bg-blue-100 text-blue-700" :
                    "bg-amber-100 text-amber-700"
                  }`}>{r.method}</span>
                  <code className="flex-1 font-mono text-[11px] text-gray-800">{r.path}</code>
                  <span className="hidden text-[11px] text-gray-400 sm:inline">{r.desc}</span>
                  <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                    r.status === "Live"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-blue-200 bg-blue-50 text-blue-700"
                  }`}>{r.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── PineTree Insights ─────────────────────────────────────────────── */}
      <PineTreeInsightsCard
        insights={insights}
        emptyText="Insights will appear once payment links are created and payments begin."
      />
    </div>
  )
}
