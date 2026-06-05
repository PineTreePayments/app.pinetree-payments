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

type ApiKeyListItem = {
  id: string
  name: string | null
  prefix: string
  permissions: string[]
  lastUsedAt: string | null
  createdAt: string
}

type CreatedApiKey = {
  id: string
  name: string | null
  key: string
  prefix: string
  permissions: string[]
  createdAt: string
}

type WebhookDelivery = {
  id: string
  event: string
  status: string
  response_status: number | null
  attempt_count: number
  created_at: string
}

type TestSession = {
  sessionId: string
  token: string
  checkoutUrl: string
  amount: number
  currency: string
  expiresAt: string | null
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

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
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

  // Webhook deliveries
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([])
  const [deliveriesLoading, setDeliveriesLoading] = useState(false)

  // API keys
  const [apiKeys, setApiKeys] = useState<ApiKeyListItem[]>([])
  const [apiKeysLoading, setApiKeysLoading] = useState(false)
  const apiKeysLoadedRef = useRef(false)

  // Per-section fetch errors — set on any !res.ok or network failure; cleared on retry
  const [linksError,     setLinksError]     = useState(false)
  const [statsError,     setStatsError]     = useState(false)
  const [webhookError,   setWebhookError]   = useState(false)
  const [deliveriesError,setDeliveriesError]= useState(false)
  const [apiKeysError,   setApiKeysError]   = useState(false)
  const [newKeyName, setNewKeyName] = useState("")
  const [creatingKey, setCreatingKey] = useState(false)
  const [revealedKey, setRevealedKey] = useState<CreatedApiKey | null>(null)
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null)

  // Test checkout session
  const [testAmount, setTestAmount] = useState("")
  const [testOrderId, setTestOrderId] = useState("")
  const [testEmail, setTestEmail] = useState("")
  const [testSuccessUrl, setTestSuccessUrl] = useState("")
  const [testCancelUrl, setTestCancelUrl] = useState("")
  const [testSessionLoading, setTestSessionLoading] = useState(false)
  const [testSession, setTestSession] = useState<TestSession>(null)

  // Create payment link form
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
    setLinksError(false)
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch("/api/checkout-links", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      if (!res.ok) { setLinksError(true); return }
      const data = (await res.json()) as { links: CheckoutLink[] }
      setLinks(data.links ?? [])
    } catch {
      setLinksError(true)
    } finally {
      setLoading(false)
    }
  }, [getToken])

  const fetchStats = useCallback(async () => {
    setStatsError(false)
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch("/api/checkout/stats", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      if (!res.ok) { setStatsError(true); return }
      const data = (await res.json()) as OnlineStats
      setStats(data)
    } catch {
      setStatsError(true)
    } finally {
      setStatsLoading(false)
    }
  }, [getToken])

  const fetchWebhookConfig = useCallback(async () => {
    setWebhookError(false)
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch("/api/merchant/webhooks", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      if (!res.ok) { setWebhookError(true); return }
      const data = (await res.json()) as { webhook: WebhookConfig }
      const wh = data.webhook
      if (wh) {
        setWebhookConfig(wh)
        setWebhookUrl(wh.url)
        setWebhookEvents(wh.events)
      }
    } catch {
      setWebhookError(true)
    } finally {
      setWebhookLoading(false)
    }
  }, [getToken])

  const fetchDeliveries = useCallback(async () => {
    setDeliveriesLoading(true)
    setDeliveriesError(false)
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch("/api/merchant/webhook-deliveries", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      if (!res.ok) { setDeliveriesError(true); return }
      const data = (await res.json()) as { deliveries: WebhookDelivery[] }
      setDeliveries(data.deliveries ?? [])
    } catch {
      setDeliveriesError(true)
    } finally {
      setDeliveriesLoading(false)
    }
  }, [getToken])

  const fetchApiKeys = useCallback(async () => {
    setApiKeysLoading(true)
    setApiKeysError(false)
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch("/api/merchant/api-keys", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      })
      if (!res.ok) { setApiKeysError(true); return }
      const data = (await res.json()) as { keys: ApiKeyListItem[] }
      setApiKeys(data.keys ?? [])
    } catch {
      setApiKeysError(true)
    } finally {
      setApiKeysLoading(false)
    }
  }, [getToken])

  useEffect(() => {
    void fetchLinks()
    void fetchStats()
  }, [fetchLinks, fetchStats])

  useEffect(() => {
    if (tab === "webhooks") {
      void fetchWebhookConfig()
      void fetchDeliveries()
    }
    if (tab === "developer" && !apiKeysLoadedRef.current) {
      apiKeysLoadedRef.current = true
      void fetchApiKeys()
    }
  }, [tab, fetchWebhookConfig, fetchDeliveries, fetchApiKeys])

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

  async function handleCreateApiKey(e: React.FormEvent) {
    e.preventDefault()
    setCreatingKey(true)
    try {
      const token = await getToken()
      const res = await fetch("/api/merchant/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newKeyName.trim() || undefined }),
      })
      const data = (await res.json()) as { key?: CreatedApiKey; error?: string }
      if (!res.ok) throw new Error(data.error || "Failed to create API key")
      if (data.key) {
        setRevealedKey(data.key)
        setApiKeys((prev) => [
          {
            id: data.key!.id,
            name: data.key!.name,
            prefix: data.key!.prefix,
            permissions: data.key!.permissions,
            lastUsedAt: null,
            createdAt: data.key!.createdAt,
          },
          ...prev,
        ])
        setNewKeyName("")
        toast.success("API key created — copy it now")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create API key")
    } finally {
      setCreatingKey(false)
    }
  }

  async function handleRevokeApiKey(id: string) {
    setRevokingKeyId(id)
    try {
      const token = await getToken()
      const res = await fetch(`/api/merchant/api-keys/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error || "Failed to revoke key")
      }
      setApiKeys((prev) => prev.filter((k) => k.id !== id))
      if (revealedKey?.id === id) setRevealedKey(null)
      toast.success("API key revoked")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke key")
    } finally {
      setRevokingKeyId(null)
    }
  }

  async function handleCreateTestSession(e: React.FormEvent) {
    e.preventDefault()
    const parsedAmount = parseFloat(testAmount)
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error("Enter a valid amount")
      return
    }
    setTestSessionLoading(true)
    setTestSession(null)
    try {
      const token = await getToken()
      const body: Record<string, unknown> = { amount: parsedAmount, currency: "USD" }
      if (testOrderId.trim()) body.orderId = testOrderId.trim()
      if (testEmail.trim()) body.customerEmail = testEmail.trim()
      if (testSuccessUrl.trim()) body.successUrl = testSuccessUrl.trim()
      if (testCancelUrl.trim()) body.cancelUrl = testCancelUrl.trim()

      const res = await fetch("/api/checkout/session", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as { session?: TestSession; error?: string }
      if (!res.ok) throw new Error(data.error || "Failed to create session")
      if (data.session) {
        setTestSession(data.session)
        toast.success("Test session created")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create session")
    } finally {
      setTestSessionLoading(false)
    }
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

  const htmlSnippet = `<!-- Option 1: Static link to a payment link (no backend needed).
     Replace YOUR_LINK_TOKEN with the token from the Payment Links tab. -->
<a href="${APP_BASE}/checkout/YOUR_LINK_TOKEN" target="_blank">
  <button>Pay with Crypto</button>
</a>

<!-- Option 2: Dynamic session — your frontend calls YOUR backend.
     NEVER call PineTree with your pt_live_ key from the browser. -->
<button onclick="startCheckout()">Pay with Crypto</button>
<script>
  async function startCheckout() {
    const res = await fetch('/api/your-checkout-handler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 49.99, orderId: 'order_1042' })
    })
    const { checkoutUrl } = await res.json()
    window.location.href = checkoutUrl
  }
</script>`

  const nodeSnippet = `// Node.js / Express — backend endpoint that creates a PineTree session.
// Your pt_live_ API key stays here, never in the browser.
const express = require('express')
const app = express()
app.use(express.json())

app.post('/api/your-checkout-handler', async (req, res) => {
  const response = await fetch('${sessionEndpoint}', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer pt_live_YOUR_API_KEY'
    },
    body: JSON.stringify({
      amount: req.body.amount,
      currency: 'USD',
      orderId: req.body.orderId,
      customerEmail: req.body.email,
      successUrl: 'https://yourstore.com/success',
      cancelUrl: 'https://yourstore.com/cancel'
    })
  })
  const { session } = await response.json()
  res.json({ checkoutUrl: session.checkoutUrl })
})`

  const curlSnippet = `# Server-side only — never expose pt_live_ keys in browser code
curl -X POST ${sessionEndpoint} \\
  -H "Authorization: Bearer pt_live_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 49.99,
    "currency": "USD",
    "orderId": "order_1042",
    "customerEmail": "customer@example.com",
    "successUrl": "https://yourstore.com/success",
    "cancelUrl": "https://yourstore.com/cancel"
  }'`

  const reactComponentSnippet = `// React component (your frontend) — calls YOUR backend, not PineTree directly.
// Your pt_live_ API key must never appear in client-side code.
import { useState } from 'react'

export function CryptoCheckoutButton({ amount, orderId, onError }) {
  const [loading, setLoading] = useState(false)

  async function startCheckout() {
    setLoading(true)
    try {
      // Step 1 — your backend creates a PineTree session and returns the URL
      const res = await fetch('/api/your-checkout-handler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, orderId }),
      })
      if (!res.ok) throw new Error('Checkout unavailable')
      const { checkoutUrl } = await res.json()

      // Step 2 — redirect customer to the hosted PineTree checkout page
      window.location.href = checkoutUrl
    } catch (err) {
      onError?.(err)
      setLoading(false)
    }
  }

  return (
    <button onClick={startCheckout} disabled={loading}>
      {loading ? 'Redirecting…' : 'Pay with Crypto'}
    </button>
  )
}`

  const reactBackendSnippet = `// Node.js / Express — POST /api/your-checkout-handler
// Creates a PineTree session server-side and returns checkoutUrl to the browser.
// The pt_live_ key stays here — it is never sent to the browser.
app.post('/api/your-checkout-handler', async (req, res) => {
  const ptRes = await fetch('${sessionEndpoint}', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer pt_live_YOUR_API_KEY',
      'Idempotency-Key': req.body.orderId,   // prevents duplicate sessions on retry
    },
    body: JSON.stringify({
      amount: req.body.amount,
      currency: 'USD',
      orderId: req.body.orderId,
      successUrl: 'https://yourstore.com/success',
      cancelUrl: 'https://yourstore.com/cancel',
    }),
  })
  const { session } = await ptRes.json()
  // session.sessionId can be stored on your order for later status polling:
  // GET ${sessionEndpoint}/:sessionId  →  { status: 'active'|'processing'|'paid'|'expired' }
  res.json({ checkoutUrl: session.checkoutUrl })
})`

  const webhookVerifySnippet = `const crypto = require('crypto')

// IMPORTANT: pass the raw request body — not JSON.stringify(req.body).
// Any whitespace difference will break the signature.
function verifyPineTreeWebhook(rawBody, headers, secret) {
  const signature = headers['x-pinetree-signature'] // "sha256=<hex>"
  const timestamp  = headers['x-pinetree-timestamp']  // ISO string

  // Reject stale events (replay attack protection — 5 min window)
  const ageMs = Date.now() - new Date(timestamp).getTime()
  if (ageMs > 5 * 60 * 1000) throw new Error('Webhook timestamp too old')

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)   // rawBody must be the original Buffer or string
    .digest('hex')

  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signature)
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
      description: "Full server-side control: create sessions, list links, query checkout session status. Auth via API key.",
      useCase: "Custom integrations, marketplaces",
      difficulty: "Advanced",
      status: "live",
      action: "View API Docs",
    },
    {
      id: "shopify",
      title: "Shopify Plugin",
      description: "Shopify support is planned. Native Shopify payment apps require Shopify partner approval before they can be listed as a payment method.",
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
      description: "Build a checkout button in React that calls your backend, which creates a PineTree session. No npm package required — works today with a few lines of code.",
      useCase: "React / Next.js apps",
      difficulty: "Medium",
      status: "preview",
      action: "View React Example",
    },
  ]

  function handleIntegrationAction(id: string) {
    if (id === "hosted-link") { setTab("links"); return }
    if (id === "js-session" || id === "html-button" || id === "rest-api" || id === "react-sdk") { setTab("developer"); return }
  }

  return (
    <div className="space-y-6 md:space-y-8">

      {/* ── Page header ───────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-gray-950 sm:text-2xl">Online Payments</h1>
        <p className="mt-1 text-[10px] font-semibold uppercase leading-[1.55] tracking-[0.11em] text-[#0052FF] sm:text-[11px] sm:leading-normal sm:tracking-[0.16em]">
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
      {statsError && (
        <p className="text-xs text-red-500">
          Could not load checkout stats.{" "}
          <button type="button" onClick={() => void fetchStats()} className="underline">Retry</button>
        </p>
      )}

      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div className="w-full max-w-full overflow-hidden">
        <div className="grid max-w-full grid-cols-2 gap-1.5 rounded-[12px] border border-gray-200/80 bg-white/85 p-1.5 shadow-[0_12px_34px_rgba(15,23,42,0.08)] backdrop-blur-sm sm:inline-grid sm:w-auto sm:grid-cols-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`min-w-0 rounded-[10px] border px-3 py-2 text-center text-sm font-semibold transition-all duration-200 ease-out sm:px-3.5 sm:py-2 ${
                tab === t.id
                  ? "border-[#0052FF] bg-[#0052FF] text-white shadow-[0_8px_18px_rgba(0,82,255,0.22)]"
                  : "border-gray-200/70 bg-white/70 text-slate-600 shadow-sm hover:border-blue-100 hover:bg-white hover:text-slate-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* PAYMENT LINKS TAB                                                  */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === "links" && (
        <>
          <DashboardSection title="New Payment Link" titleTone="blue">
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

          <DashboardSection title="Your Payment Links" titleTone="blue">
            {loading ? (
              <div className="rounded-2xl border border-gray-200/80 bg-white p-8 shadow-[0_10px_30px_rgba(15,23,42,0.05)] text-center">
                <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-[#0052FF] border-t-transparent" />
              </div>
            ) : linksError ? (
              <div className="rounded-2xl border border-red-100 bg-white p-8 shadow-[0_10px_30px_rgba(15,23,42,0.05)] text-center">
                <p className="text-sm text-red-500">Could not load payment links.{" "}
                  <button type="button" onClick={() => void fetchLinks()} className="underline">Retry</button>
                </p>
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
          <DashboardSection title="Integration Options" titleTone="blue">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {INTEGRATION_OPTIONS.map((opt) => (
                <IntegrationCard key={opt.id} option={opt} onAction={handleIntegrationAction} />
              ))}
            </div>
          </DashboardSection>

          <DashboardSection title="Your Setup" titleTone="blue">
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
                fieldId="session_endpoint" copiedField={copiedField} onCopy={handleCopyField} badge={<LiveBadge />} />
              <CopyRow label="Hosted Checkout URL Pattern" value={checkoutUrlPattern}
                fieldId="checkout_url" copiedField={copiedField} onCopy={handleCopyField} badge={<LiveBadge />} />
            </div>
          </DashboardSection>

          <div className="rounded-2xl border border-amber-200/80 bg-amber-50/60 px-4 py-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">Authentication</p>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-700">
              API calls from your server must use a{" "}
              <code className="rounded bg-amber-100 px-1 font-mono text-[11px]">pt_live_...</code>{" "}
              API key in the{" "}
              <code className="rounded bg-amber-100 px-1 font-mono text-[11px]">Authorization: Bearer</code>{" "}
              header. Create and manage keys in the{" "}
              <button type="button" onClick={() => setTab("developer")}
                className="font-semibold underline text-amber-800 hover:text-amber-900">
                Developer tab
              </button>.{" "}
              Never expose API keys in frontend JavaScript — they must remain server-side only.
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
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">Webhook Endpoint</h2>
                <p className="mt-0.5 text-xs text-gray-500">PineTree will POST signed event payloads to this URL.</p>
              </div>
              <PreviewBadge />
            </div>

            {webhookLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#0052FF] border-t-transparent" />
              </div>
            ) : webhookError ? (
              <p className="py-6 text-center text-sm text-red-500">
                Could not load webhook configuration.{" "}
                <button type="button" onClick={() => void fetchWebhookConfig()} className="underline">Retry</button>
              </p>
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
            <DashboardSection title="Signing Secret" titleTone="blue">
              <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                <div className="p-5 sm:p-6">
                  <p className="mb-3 text-xs leading-relaxed text-gray-500">
                    Verify incoming webhook requests using HMAC-SHA256. Compare the{" "}
                    <code className="rounded bg-gray-100 px-1 font-mono text-[11px]">X-PineTree-Signature</code>{" "}
                    header against a local signature built from the <strong>raw request body</strong> and this secret.
                    Also check <code className="rounded bg-gray-100 px-1 font-mono text-[11px]">X-PineTree-Timestamp</code>{" "}
                    to reject replayed events.
                  </p>
                  <div className="mb-4 rounded-xl border border-amber-200/80 bg-amber-50/60 px-3.5 py-2.5">
                    <p className="text-[11px] font-semibold text-amber-700">Verify the raw request body — before any JSON parsing</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
                      Pass the original body bytes to HMAC, not{" "}
                      <code className="font-mono">JSON.stringify(req.body)</code>.
                      Whitespace differences will produce a different signature and verification will fail silently.
                    </p>
                  </div>
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
                    code={webhookVerifySnippet}
                    fieldId="verify_snippet"
                    copiedField={copiedField}
                    onCopy={handleCopyField}
                    lang="node.js"
                  />
                </div>
              </div>
            </DashboardSection>
          )}

          {/* ── Webhook Delivery Log ──────────────────────────────────────── */}
          <DashboardSection title="Delivery Log" titleTone="blue">
            <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
                <div>
                  <h3 className="text-sm font-semibold text-gray-950">Recent Webhook Deliveries</h3>
                  <p className="mt-0.5 text-xs text-gray-500">Last 50 delivery attempts across all events.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void fetchDeliveries()}
                  disabled={deliveriesLoading}
                  className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:text-[#0052FF] disabled:opacity-50"
                >
                  {deliveriesLoading ? "Loading…" : "Refresh"}
                </button>
              </div>

              {deliveriesLoading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#0052FF] border-t-transparent" />
                </div>
              ) : deliveriesError ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm text-red-500">Could not load webhook deliveries.{" "}
                    <button type="button" onClick={() => void fetchDeliveries()} className="underline">Retry</button>
                  </p>
                </div>
              ) : deliveries.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm text-gray-400">No webhook deliveries yet.</p>
                  <p className="mt-1 text-xs text-gray-400">Deliveries appear here after payment events are triggered.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        {["Event", "Status", "HTTP", "Attempts", "Time"].map((h) => (
                          <th key={h} className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {deliveries.map((d) => (
                        <tr key={d.id} className="transition-colors hover:bg-gray-50/60">
                          <td className="px-5 py-3.5">
                            <code className="font-mono text-[11px] text-gray-800">{d.event}</code>
                          </td>
                          <td className="px-5 py-3.5">
                            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                              d.status === "delivered"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-red-200 bg-red-50 text-red-700"
                            }`}>
                              {d.status}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 font-mono text-[12px] text-gray-500">
                            {d.response_status ?? "—"}
                          </td>
                          <td className="px-5 py-3.5 text-[12px] text-gray-500">
                            {d.attempt_count}
                          </td>
                          <td className="px-5 py-3.5 text-[12px] text-gray-500">
                            {fmtDateTime(d.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </DashboardSection>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* DEVELOPER TAB                                                      */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === "developer" && (
        <div className="space-y-6">

          {/* ── API Keys ──────────────────────────────────────────────────── */}
          <DashboardSection title="API Keys" titleTone="blue">
            <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
                <div>
                  <h3 className="text-sm font-semibold text-gray-950">Secret API Keys</h3>
                  <p className="mt-0.5 text-xs text-gray-500">For server-to-server requests. Never expose in frontend code.</p>
                </div>
                <LiveBadge />
              </div>

              <div className="space-y-5 p-5">
                {/* Create key form */}
                <form onSubmit={(e) => void handleCreateApiKey(e)} className="flex gap-2">
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="Key name (e.g. Production, Staging)"
                    className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-[#0052FF] focus:ring-2 focus:ring-[#0052FF]/10"
                  />
                  <Button type="submit" disabled={creatingKey}>
                    {creatingKey ? "Creating…" : "Create Key"}
                  </Button>
                </form>

                {/* One-time key reveal */}
                {revealedKey && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-emerald-800">
                        Store this key now — you will not be able to view it again.
                      </p>
                      <button
                        type="button"
                        onClick={() => setRevealedKey(null)}
                        className="shrink-0 text-[11px] text-emerald-600 hover:text-emerald-800"
                      >
                        Dismiss
                      </button>
                    </div>
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2">
                      <code className="flex-1 break-all font-mono text-[11px] text-gray-900">{revealedKey.key}</code>
                      <button
                        type="button"
                        onClick={() => handleCopyField("revealed_key", revealedKey.key)}
                        className="shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:text-[#0052FF]"
                      >
                        {copiedField === "revealed_key" ? "Copied ✓" : "Copy"}
                      </button>
                    </div>
                  </div>
                )}

                {/* Key list */}
                {apiKeysLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#0052FF] border-t-transparent" />
                  </div>
                ) : apiKeysError ? (
                  <p className="py-4 text-center text-xs text-red-500">
                    Could not load API keys.{" "}
                    <button type="button" onClick={() => void fetchApiKeys()} className="underline">Retry</button>
                  </p>
                ) : apiKeys.length === 0 ? (
                  <p className="py-4 text-center text-xs text-gray-400">No API keys yet. Create one above.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          {["Name", "Prefix", "Created", "Last Used", ""].map((h) => (
                            <th key={h} className={`py-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-500 ${h === "" ? "text-right" : "text-left pr-4"}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {apiKeys.map((k) => (
                          <tr key={k.id} className="transition-colors hover:bg-gray-50/60">
                            <td className="py-3 pr-4 font-medium text-gray-900">
                              {k.name ?? <span className="italic text-gray-400">Unnamed</span>}
                            </td>
                            <td className="py-3 pr-4">
                              <code className="font-mono text-[11px] text-gray-600">{k.prefix}…</code>
                            </td>
                            <td className="py-3 pr-4 text-[12px] text-gray-500">{fmtDate(k.createdAt)}</td>
                            <td className="py-3 pr-4 text-[12px] text-gray-500">
                              {k.lastUsedAt ? fmtDate(k.lastUsedAt) : "Never"}
                            </td>
                            <td className="py-3 text-right">
                              <button
                                type="button"
                                onClick={() => void handleRevokeApiKey(k.id)}
                                disabled={revokingKeyId === k.id}
                                className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                              >
                                {revokingKeyId === k.id ? "…" : "Revoke"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </DashboardSection>

          {/* ── Test Checkout Session ─────────────────────────────────────── */}
          <DashboardSection title="Test Checkout Session" titleTone="blue">
            <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
                <div>
                  <h3 className="text-sm font-semibold text-gray-950">Create a Test Session</h3>
                  <p className="mt-0.5 text-xs text-gray-500">Verify the session API works end-to-end before integrating externally.</p>
                </div>
                <LiveBadge />
              </div>
              <div className="space-y-4 p-5">
                <form onSubmit={(e) => void handleCreateTestSession(e)} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className={labelClass}>Amount (USD) <span className="text-red-400">*</span></label>
                      <input type="number" value={testAmount} onChange={(e) => setTestAmount(e.target.value)}
                        placeholder="49.99" min="0.01" step="0.01" className={inputClass} />
                    </div>
                    <div className="space-y-1.5">
                      <label className={labelClass}>Order / Reference</label>
                      <input type="text" value={testOrderId} onChange={(e) => setTestOrderId(e.target.value)}
                        placeholder="order_1042" className={inputClass} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className={labelClass}>Customer Email</label>
                    <input type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)}
                      placeholder="customer@example.com" className={inputClass} />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className={labelClass}>Success URL</label>
                      <input type="url" value={testSuccessUrl} onChange={(e) => setTestSuccessUrl(e.target.value)}
                        placeholder="https://yourstore.com/success" className={inputClass} />
                    </div>
                    <div className="space-y-1.5">
                      <label className={labelClass}>Cancel URL</label>
                      <input type="url" value={testCancelUrl} onChange={(e) => setTestCancelUrl(e.target.value)}
                        placeholder="https://yourstore.com/cancel" className={inputClass} />
                    </div>
                  </div>
                  <div className="pt-1">
                    <Button type="submit" disabled={testSessionLoading}>
                      {testSessionLoading ? (
                        <><span className="mr-2 inline-block h-3 w-3 rounded-full border border-white border-t-transparent animate-spin" />Creating…</>
                      ) : "Create Test Checkout Session"}
                    </Button>
                  </div>
                </form>

                {testSession && (
                  <div className="space-y-3 rounded-xl border border-[#0052FF]/20 bg-[#0052FF]/5 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0052FF]">Session Created</p>
                    <div className="space-y-2">
                      <CopyRow label="Checkout URL" value={testSession.checkoutUrl}
                        fieldId="test_checkout_url" copiedField={copiedField} onCopy={handleCopyField} />
                      <CopyRow label="Token" value={testSession.token}
                        fieldId="test_token" copiedField={copiedField} onCopy={handleCopyField} />
                      <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/60 px-3.5 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">Expires At</p>
                          <p className="text-xs text-gray-800">
                            {testSession.expiresAt ? fmtDateTime(testSession.expiresAt) : "No expiry"}
                          </p>
                        </div>
                      </div>
                    </div>
                    <a
                      href={testSession.checkoutUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#0052FF]/30 bg-[#0052FF]/8 px-4 py-2 text-xs font-semibold text-[#0052FF] hover:bg-[#0052FF]/15"
                    >
                      Open Checkout ↗
                    </a>
                  </div>
                )}
              </div>
            </div>
          </DashboardSection>

          {/* ── HTML / Frontend ───────────────────────────────────────────── */}
          <DashboardSection title="HTML / Frontend" titleTone="blue">
            <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
                <div>
                  <h3 className="text-sm font-semibold text-gray-950">Frontend Integration</h3>
                  <p className="mt-0.5 text-xs text-gray-500">Static link to a payment link, or a button that calls your backend.</p>
                </div>
                <LiveBadge />
              </div>
              <div className="space-y-3 p-5">
                <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 px-3.5 py-2.5">
                  <p className="text-[11px] font-semibold text-amber-700">Never put API keys in frontend code</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
                    Your <code className="font-mono">pt_live_...</code> key must stay on your server.
                    For dynamic sessions, the browser calls your backend, which calls PineTree.
                  </p>
                </div>
                <CodeBlock code={htmlSnippet} fieldId="html_snippet" copiedField={copiedField} onCopy={handleCopyField} lang="html" />
              </div>
            </div>
          </DashboardSection>

          {/* ── Node.js / Express Backend ─────────────────────────────────── */}
          <DashboardSection title="Node.js / Express Backend" titleTone="blue">
            <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
                <div>
                  <h3 className="text-sm font-semibold text-gray-950">Server-Side Session Creation</h3>
                  <p className="mt-0.5 text-xs text-gray-500">Create a PineTree session from your server and redirect the customer to the returned URL.</p>
                </div>
                <LiveBadge />
              </div>
              <div className="p-5">
                <CodeBlock code={nodeSnippet} fieldId="node_snippet" copiedField={copiedField} onCopy={handleCopyField} lang="node.js" />
              </div>
            </div>
          </DashboardSection>

          {/* ── REST API — cURL ───────────────────────────────────────────── */}
          <DashboardSection title="REST API — cURL" titleTone="blue">
            <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
                <div>
                  <h3 className="text-sm font-semibold text-gray-950">POST /api/checkout/session</h3>
                  <p className="mt-0.5 text-xs text-gray-500">Create a checkout session and redirect to <code className="rounded bg-gray-100 px-1 font-mono text-[10px]">session.checkoutUrl</code>.</p>
                </div>
                <LiveBadge />
              </div>
              <div className="space-y-3 p-5">
                <CodeBlock code={curlSnippet} fieldId="curl_snippet" copiedField={copiedField} onCopy={handleCopyField} lang="curl" />
                <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">Response</p>
                  <pre className="overflow-x-auto text-[11px] leading-relaxed text-gray-700">
                    <code>{`{
  "session": {
    "sessionId": "...",
    "token": "...",
    "checkoutUrl": "${APP_BASE}/checkout/{token}",
    "amount": 49.99,
    "currency": "USD",
    "status": "active",
    "expiresAt": "2026-05-14T12:00:00.000Z"
  }
}`}</code>
                  </pre>
                </div>
              </div>
            </div>
          </DashboardSection>

          {/* ── React SDK ────────────────────────────────────────────────── */}
          <DashboardSection title="React SDK" titleTone="blue">
            <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
                <div>
                  <h3 className="text-sm font-semibold text-gray-950">React Integration Pattern</h3>
                  <p className="mt-0.5 text-xs text-gray-500">Checkout button that calls your backend — works today, no npm package needed.</p>
                </div>
                <PreviewBadge />
              </div>
              <div className="space-y-4 p-5">
                <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 px-3 py-2.5 text-xs text-amber-700">
                  <strong>Create checkout sessions from your backend so your API key stays private.</strong>{" "}
                  The browser calls your server; your server calls PineTree. The{" "}
                  <code className="font-mono">@pinetree/react</code> npm package is not yet published — this pattern works today using the existing session API.
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">React component (frontend)</p>
                <CodeBlock code={reactComponentSnippet} fieldId="react_component_snippet" copiedField={copiedField} onCopy={handleCopyField} lang="react" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">Backend handler (Node.js / Express)</p>
                <CodeBlock code={reactBackendSnippet} fieldId="react_backend_snippet" copiedField={copiedField} onCopy={handleCopyField} lang="node.js" />
                <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-3.5 py-2.5 text-[11px] leading-relaxed text-gray-500">
                  <span className="font-semibold text-gray-700">Check payment status server-side:</span>{" "}
                  <code className="font-mono text-[10px] text-gray-700">GET /api/checkout/session/:sessionId</code>{" "}
                  returns{" "}
                  <code className="font-mono text-[10px] text-gray-600">active | processing | paid | expired | canceled</code>.
                  Use this as a fallback if your webhook delivery fails.
                </div>
              </div>
            </div>
          </DashboardSection>

          {/* ── API Reference ─────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-gray-100 bg-gray-50/60 px-4 py-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0052FF]">API Reference</p>
            <div className="mt-2 space-y-1.5 text-xs text-gray-600">
              {[
                { method: "GET",    path: "/api/checkout-links",               desc: "List all payment links",       status: "Live" },
                { method: "POST",   path: "/api/checkout-links",               desc: "Create a payment link",        status: "Live" },
                { method: "PATCH",  path: "/api/checkout-links/:id",           desc: "Disable a payment link",       status: "Live" },
                { method: "POST",   path: "/api/checkout/session",             desc: "Create a checkout session",    status: "Live" },
                { method: "GET",    path: "/api/checkout/session/:sessionId",  desc: "Get session status",           status: "Live" },
                { method: "GET",    path: "/api/checkout/stats",               desc: "Online payment stats",         status: "Preview" },
                { method: "GET",    path: "/api/merchant/webhooks",            desc: "Get webhook config",           status: "Preview" },
                { method: "POST",   path: "/api/merchant/webhooks",            desc: "Save webhook config",          status: "Preview" },
                { method: "GET",    path: "/api/merchant/api-keys",            desc: "List API keys",                status: "Live" },
                { method: "POST",   path: "/api/merchant/api-keys",            desc: "Create an API key",            status: "Live" },
                { method: "DELETE", path: "/api/merchant/api-keys/:id",        desc: "Revoke an API key",            status: "Live" },
                { method: "GET",    path: "/api/merchant/webhook-deliveries",  desc: "List webhook deliveries",      status: "Live" },
              ].map((r) => (
                <div key={r.path} className="flex items-center gap-3">
                  <span className={`w-12 shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-bold ${
                    r.method === "GET"    ? "bg-emerald-100 text-emerald-700" :
                    r.method === "POST"   ? "bg-blue-100 text-blue-700" :
                    r.method === "DELETE" ? "bg-red-100 text-red-700" :
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
