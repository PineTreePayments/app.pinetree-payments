"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"
import {
  ChevronRight,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Star,
  X,
} from "lucide-react"
import {
  CompactMetricTile,
  DashboardSection,
  GroupedMetricSurface,
  MetricGrid,
} from "@/components/dashboard/DashboardPrimitives"
import {
  formatDashboardProvider,
  formatDashboardNetwork,
} from "@/components/dashboard/displayHelpers"
import PaymentStatusBadge from "@/components/ui/StatusBadge"
import { SegmentedButtons, segmentedButtonClass } from "@/components/ui/SegmentedButtons"
import { primaryActionButtonClass } from "@/components/ui/PrimaryActionButton"
import { modalCloseButtonClass } from "@/components/ui/ModalCloseButton"

// ─── Overview types ────────────────────────────────────────────────────────────

type Metrics = {
  totalTransactions: number
  confirmedTransactions: number
  processingTransactions: number
  pendingTransactions: number
  failedTransactions: number
  incompleteTransactions: number
  expiredTransactions: number
  totalConfirmedVolume: number
  totalFeesCollected: number
  activeMerchants: number
  totalMerchants: number
  connectedProviders: number
}

type Growth = {
  usersThisMonth: number
  transactionsThisMonth: number
  volumeThisMonth: number
}

type RecentTx = {
  id: string
  merchant_id: string
  status: string
  provider: string | null
  network: string | null
  gross_amount: number
  currency: string
  created_at: string
}

type RecentTicketPreview = {
  id: string
  subject: string
  status: string
  priority: string
  merchant_email: string | null
  merchant_business_name: string | null
  created_at: string
}

type RecentFeedbackPreview = {
  id: string
  merchant_id: string
  type: string
  message: string
  rating: number | null
  created_at: string
}

type Overview = {
  metrics: Metrics
  growth: Growth
  recentTransactions: RecentTx[]
  recentTickets: RecentTicketPreview[]
  recentFeedback: RecentFeedbackPreview[]
  generatedAt: string
}

// ─── Support types ─────────────────────────────────────────────────────────────

type Ticket = {
  id: string
  merchant_id: string
  merchant_email: string | null
  merchant_business_name: string | null
  category: string
  subject: string
  description: string
  priority: string
  status: string
  related_payment_id: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  archived_at: string | null
  last_response_at: string | null
}

type Message = {
  id: string
  ticket_id: string
  merchant_id: string
  sender_type: "merchant" | "pinetree" | "system"
  sender_name: string | null
  sender_email: string | null
  message: string
  created_at: string
}

type Feedback = {
  id: string
  merchant_id: string
  type: string
  message: string
  rating: number | null
  created_at: string
}

type AdminTxDetail = {
  id: string
  merchant_id: string
  status: string
  provider: string | null
  network: string | null
  gross_amount: number
  merchant_amount: number
  pinetree_fee: number
  currency: string
  provider_reference: string | null
  metadata: unknown
  created_at: string
  updated_at: string
}

type TxEvent = {
  id: string
  event_type: string
  provider_event: string | null
  created_at: string
}

type ProviderOnboarding = {
  merchantId: string
  provider: "stripe" | "fluidpay"
  status: string
  enabled: boolean
  applicationStatus: "not_started" | "pending" | "approved" | "denied"
  setupStartedAt: string | null
  setupSubmittedAt: string | null
  setupReturnedAt: string | null
  approvedAt: string | null
  deniedAt: string | null
  updatedAt: string | null
}

// ─── Constants ─────────────────────────────────────────────────────────────────

type AdminTab = "overview" | "providers" | "support" | "feedback"

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_review", label: "In Review" },
  { value: "waiting_on_merchant", label: "Waiting" },
  { value: "resolved", label: "Resolved" },
  { value: "archived", label: "Archived" },
]

const ACTION_STATUSES = [
  { value: "open", label: "Open" },
  { value: "in_review", label: "In Review" },
  { value: "waiting_on_merchant", label: "Waiting on Merchant" },
  { value: "resolved", label: "Resolved" },
  { value: "archived", label: "Archived" },
]

const STATUS_STYLES: Record<string, string> = {
  open: "bg-blue-50 text-blue-700 border-blue-200",
  in_review: "bg-amber-50 text-amber-700 border-amber-200",
  waiting_on_merchant: "bg-orange-50 text-orange-700 border-orange-200",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  archived: "bg-gray-100 text-gray-500 border-gray-200",
}

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_review: "In Review",
  waiting_on_merchant: "Waiting",
  resolved: "Resolved",
  archived: "Archived",
}

const PRIORITY_STYLES: Record<string, string> = {
  Low: "bg-gray-100 text-gray-500 border-gray-200",
  Normal: "bg-blue-50 text-blue-600 border-blue-200",
  High: "bg-orange-50 text-orange-700 border-orange-200",
  Urgent: "bg-red-50 text-red-700 border-red-200",
}


const SUPPORT_STAT_CONFIG = [
  { key: "open" as const, label: "Open", color: "text-[#0052FF]", dot: "bg-[#0052FF]" },
  { key: "in_review" as const, label: "In Review", color: "text-amber-600", dot: "bg-amber-500" },
  { key: "waiting_on_merchant" as const, label: "Waiting", color: "text-orange-600", dot: "bg-orange-500" },
  { key: "resolved" as const, label: "Resolved", color: "text-emerald-600", dot: "bg-emerald-500" },
  { key: "archived" as const, label: "Archived", color: "text-gray-400", dot: "bg-gray-300" },
]

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("en-US")
}

function fmtUSD(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
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

function currentMonthLabel() {
  return new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

const EVENT_LABELS: Record<string, string> = {
  "payment.created":    "Created",
  "payment.pending":    "Waiting",
  "payment.processing": "Processing",
  "payment.confirmed":  "Confirmed",
  "payment.failed":     "Failed",
  "payment.cancelled":  "Canceled",
  "payment.canceled":   "Canceled",
  "payment.incomplete": "Canceled",
  "payment.expired":    "Expired",
  "payment.refunded":   "Refunded",
}

function paymentModeFromMetadata(metadata: unknown): "live" | "test" {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "live"
  const m = (metadata as Record<string, unknown>).payment_mode
  return m === "test" ? "test" : "live"
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        STATUS_STYLES[status] ?? "bg-gray-100 text-gray-600 border-gray-200"
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        PRIORITY_STYLES[priority] ?? "bg-gray-100 text-gray-600 border-gray-200"
      }`}
    >
      {priority}
    </span>
  )
}

function StarRating({ rating }: { rating: number | null }) {
  if (!rating) return <span className="text-gray-400 text-xs">No rating</span>
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={13}
          className={i <= rating ? "fill-amber-400 text-amber-400" : "text-gray-300"}
        />
      ))}
    </div>
  )
}

// ─── Unauthorized screen ───────────────────────────────────────────────────────

function UnauthorizedScreen() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 2C9.24 2 7 4.24 7 7v2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-2V7c0-2.76-2.24-5-5-5zm0 13a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm3-8H9V7a3 3 0 1 1 6 0v2z"
            fill="#ef4444"
          />
        </svg>
      </div>
      <h1 className="text-lg font-semibold text-gray-900">Admin Access Required</h1>
      <p className="max-w-xs text-sm text-gray-500">
        Your account does not have admin privileges to view this page.
      </p>
      <Link
        href="/dashboard"
        className={`${primaryActionButtonClass} mt-2`}
      >
        Back to Dashboard
      </Link>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const router = useRouter()
  const [token, setToken] = useState("")
  const [unauthorized, setUnauthorized] = useState(false)
  const [activeTab, setActiveTab] = useState<AdminTab>("overview")

  // ── Overview state ──────────────────────────────────────────────────────────
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loadingOverview, setLoadingOverview] = useState(true)

  // Provider onboarding state
  const [providerOnboarding, setProviderOnboarding] = useState<ProviderOnboarding[]>([])
  const [loadingProviderOnboarding, setLoadingProviderOnboarding] = useState(false)
  const [providerOnboardingLoaded, setProviderOnboardingLoaded] = useState(false)
  const [updatingProviderOnboarding, setUpdatingProviderOnboarding] = useState<string | null>(null)

  // ── Support state ───────────────────────────────────────────────────────────
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loadingTickets, setLoadingTickets] = useState(false)
  const [ticketsLoaded, setTicketsLoaded] = useState(false)
  const [statusFilter, setStatusFilter] = useState("")
  const [priorityFilter, setPriorityFilter] = useState("")
  const [search, setSearch] = useState("")
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ ticket: Ticket; messages: Message[] } | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [replyText, setReplyText] = useState("")
  const [replyStatus, setReplyStatus] = useState("waiting_on_merchant")
  const [submitting, setSubmitting] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  // ── Feedback state ──────────────────────────────────────────────────────────
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const [loadingFeedback, setLoadingFeedback] = useState(false)
  const [feedbackLoaded, setFeedbackLoaded] = useState(false)

  // ── Transaction detail state ─────────────────────────────────────────────────
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null)
  const [txDetail, setTxDetail] = useState<{ payment: AdminTxDetail; events: TxEvent[] } | null>(null)
  const [loadingTxDetail, setLoadingTxDetail] = useState(false)

  // ── Auth ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace("/login")
        return
      }
      setToken(session.access_token)
    })
  }, [router])

  // ── Load overview ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!token) return
    async function load() {
      setLoadingOverview(true)
      try {
        const res = await fetch("/api/admin/overview", {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.status === 403) {
          setUnauthorized(true)
          return
        }
        if (!res.ok) {
          toast.error("Failed to load admin overview")
          return
        }
        const data = await res.json()
        setOverview(data)
      } catch {
        toast.error("Failed to load admin overview")
      } finally {
        setLoadingOverview(false)
      }
    }
    load()
  }, [token])

  // ── Load tickets ────────────────────────────────────────────────────────────

  const fetchTickets = useCallback(async (tk: string) => {
    setLoadingTickets(true)
    try {
      const res = await fetch("/api/admin/support/tickets", {
        headers: { Authorization: `Bearer ${tk}` },
      })
      if (res.status === 403) {
        setUnauthorized(true)
        return
      }
      if (!res.ok) {
        toast.error("Failed to load tickets")
        return
      }
      const data = await res.json()
      setTickets(data.tickets || [])
      setTicketsLoaded(true)
    } catch {
      toast.error("Failed to load tickets")
    } finally {
      setLoadingTickets(false)
    }
  }, [])

  useEffect(() => {
    if (token && activeTab === "support" && !ticketsLoaded) {
      fetchTickets(token)
    }
  }, [token, activeTab, ticketsLoaded, fetchTickets])

  // ── Load feedback ───────────────────────────────────────────────────────────

  const fetchProviderOnboarding = useCallback(async (tk: string) => {
    setLoadingProviderOnboarding(true)
    try {
      const res = await fetch("/api/admin/provider-onboarding", {
        headers: { Authorization: `Bearer ${tk}` },
      })
      if (res.status === 403) {
        setUnauthorized(true)
        return
      }
      if (!res.ok) {
        toast.error("Failed to load provider onboarding")
        return
      }
      const data = await res.json()
      setProviderOnboarding(data.providers || [])
      setProviderOnboardingLoaded(true)
    } catch {
      toast.error("Failed to load provider onboarding")
    } finally {
      setLoadingProviderOnboarding(false)
    }
  }, [])

  useEffect(() => {
    if (token && activeTab === "providers" && !providerOnboardingLoaded) {
      fetchProviderOnboarding(token)
    }
  }, [token, activeTab, providerOnboardingLoaded, fetchProviderOnboarding])

  const updateProviderOnboarding = async (
    item: ProviderOnboarding,
    applicationStatus: "approved" | "denied"
  ) => {
    if (!token) return
    const key = `${item.provider}:${item.merchantId}`
    setUpdatingProviderOnboarding(key)
    try {
      const res = await fetch("/api/admin/provider-onboarding", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          merchantId: item.merchantId,
          provider: item.provider,
          applicationStatus,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Failed to update provider onboarding")
        return
      }
      setProviderOnboarding((current) =>
        current.map((row) =>
          row.merchantId === item.merchantId && row.provider === item.provider
            ? data.provider
            : row
        )
      )
      toast.success(`${item.provider === "stripe" ? "Stripe" : "Fluid Pay"} onboarding ${applicationStatus}`)
    } catch {
      toast.error("Failed to update provider onboarding")
    } finally {
      setUpdatingProviderOnboarding(null)
    }
  }

  const fetchFeedback = useCallback(async (tk: string) => {
    setLoadingFeedback(true)
    try {
      const res = await fetch("/api/admin/support/feedback", {
        headers: { Authorization: `Bearer ${tk}` },
      })
      if (!res.ok) {
        toast.error("Failed to load feedback")
        return
      }
      const data = await res.json()
      setFeedback(data.feedback || [])
      setFeedbackLoaded(true)
    } catch {
      toast.error("Failed to load feedback")
    } finally {
      setLoadingFeedback(false)
    }
  }, [])

  useEffect(() => {
    if (token && activeTab === "feedback" && !feedbackLoaded) {
      fetchFeedback(token)
    }
  }, [token, activeTab, feedbackLoaded, fetchFeedback])

  // ── Open transaction detail ──────────────────────────────────────────────────

  const openTxDetail = useCallback(async (id: string, tk: string) => {
    setSelectedTxId(id)
    setTxDetail(null)
    setLoadingTxDetail(true)
    try {
      const res = await fetch(`/api/admin/transactions/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${tk}` },
      })
      if (!res.ok) {
        toast.error("Failed to load transaction detail")
        return
      }
      const data = await res.json()
      setTxDetail({ payment: data.payment, events: data.events || [] })
    } catch {
      toast.error("Failed to load transaction detail")
    } finally {
      setLoadingTxDetail(false)
    }
  }, [])

  // ── Open ticket detail ──────────────────────────────────────────────────────

  const openTicket = useCallback(async (id: string, tk: string) => {
    setSelectedTicketId(id)
    setDetail(null)
    setLoadingDetail(true)
    setReplyText("")
    setReplyStatus("waiting_on_merchant")
    try {
      const res = await fetch(`/api/admin/support/tickets/${id}`, {
        headers: { Authorization: `Bearer ${tk}` },
      })
      if (!res.ok) {
        toast.error("Failed to load ticket")
        return
      }
      const data = await res.json()
      setDetail({ ticket: data.ticket, messages: data.messages || [] })
    } catch {
      toast.error("Failed to load ticket")
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  // ── Send reply ──────────────────────────────────────────────────────────────

  const sendReply = async () => {
    if (!replyText.trim() || !selectedTicketId || !token) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/admin/support/tickets/${selectedTicketId}/reply`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: replyText, status: replyStatus }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Failed to send reply")
        return
      }
      toast.success("Reply sent")
      if (data.warning) toast.warning(data.warning)
      setReplyText("")
      await openTicket(selectedTicketId, token)
      setTickets((prev) =>
        prev.map((t) =>
          t.id === selectedTicketId
            ? {
                ...t,
                status: data.ticket?.status ?? t.status,
                last_response_at: data.ticket?.last_response_at ?? t.last_response_at,
              }
            : t
        )
      )
    } catch {
      toast.error("Failed to send reply")
    } finally {
      setSubmitting(false)
    }
  }

  // ── Update status ───────────────────────────────────────────────────────────

  const updateStatus = async (ticketId: string, status: string) => {
    if (!token) return
    setUpdatingStatus(true)
    try {
      const res = await fetch(`/api/admin/support/tickets/${ticketId}/status`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || "Failed to update status")
        return
      }
      toast.success(`Ticket marked ${STATUS_LABELS[status] ?? status}`)
      setTickets((prev) =>
        prev.map((t) => (t.id === ticketId ? { ...t, ...data.ticket } : t))
      )
      if (detail?.ticket.id === ticketId) {
        setDetail((prev) =>
          prev ? { ...prev, ticket: { ...prev.ticket, ...data.ticket } } : prev
        )
      }
    } catch {
      toast.error("Failed to update status")
    } finally {
      setUpdatingStatus(false)
    }
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false
      if (priorityFilter && t.priority !== priorityFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          t.subject.toLowerCase().includes(q) ||
          (t.merchant_email?.toLowerCase().includes(q) ?? false) ||
          (t.merchant_business_name?.toLowerCase().includes(q) ?? false) ||
          t.id.toLowerCase().startsWith(q)
        )
      }
      return true
    })
  }, [tickets, statusFilter, priorityFilter, search])

  const ticketStats = useMemo(
    () => ({
      open: tickets.filter((t) => t.status === "open").length,
      in_review: tickets.filter((t) => t.status === "in_review").length,
      waiting_on_merchant: tickets.filter((t) => t.status === "waiting_on_merchant").length,
      resolved: tickets.filter((t) => t.status === "resolved").length,
      archived: tickets.filter((t) => t.status === "archived").length,
    }),
    [tickets]
  )

  // ── Guards ──────────────────────────────────────────────────────────────────

  if (unauthorized) return <UnauthorizedScreen />

  const m = overview?.metrics
  const g = overview?.growth
  const monthLabel = currentMonthLabel()

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Hero card ────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-[1.35rem] border border-blue-200/80 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.16),transparent_34%),linear-gradient(135deg,#ffffff_0%,#f7fbff_48%,#eef5ff_100%)] p-5 shadow-[0_18px_60px_rgba(37,99,235,0.13)] sm:p-6 md:p-7">
        <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-blue-300/80 to-transparent" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <span className="inline-flex items-center rounded-full border border-blue-200/60 bg-blue-100/80 px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.12em] text-blue-700">
              PineTree Internal
            </span>
            <h1 className="mt-2.5 text-2xl font-semibold text-gray-950 sm:text-3xl">
              Admin Command Center
            </h1>
            <p className="mt-1.5 text-sm text-gray-600">
              Platform overview, support operations, and merchant feedback
            </p>
          </div>
          {overview?.generatedAt && (
            <div className="shrink-0 sm:text-right">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">
                Last Updated
              </p>
              <p className="mt-0.5 text-sm text-gray-600">
                {fmtDateTime(overview.generatedAt)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            { key: "overview" as AdminTab, label: "Overview" },
            { key: "providers" as AdminTab, label: "Providers", badge: providerOnboardingLoaded ? providerOnboarding.length : null },
            { key: "support" as AdminTab, label: "Support", badge: ticketsLoaded ? tickets.length : null },
            { key: "feedback" as AdminTab, label: "Feedback", badge: feedbackLoaded ? feedback.length : null },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveTab(tab.key)
              setSelectedTicketId(null)
              setDetail(null)
            }}
            className={`flex items-center gap-1.5 ${segmentedButtonClass(activeTab === tab.key)}`}
          >
            {tab.label}
            {"badge" in tab && tab.badge !== null && tab.badge > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                  activeTab === tab.key
                    ? "bg-blue-100 text-blue-700"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          OVERVIEW TAB
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "overview" && (
        <>
          {loadingOverview ? (
            <Spinner />
          ) : (
            <div className="space-y-6 pb-8">

              {/* Payments — All Time */}
              <DashboardSection title="Payments — All Time (All Modes)" titleTone="blue">
                <MetricGrid columns="three">
                  <CompactMetricTile
                    label="Total"
                    value={m ? fmt(m.totalTransactions) : "—"}
                  />
                  <CompactMetricTile
                    label="Confirmed"
                    value={m ? fmt(m.confirmedTransactions) : "—"}
                    tone="green"
                  />
                  <CompactMetricTile
                    label="Confirmed Volume"
                    value={m ? fmtUSD(m.totalConfirmedVolume) : "—"}
                    tone="blue"
                  />
                  <CompactMetricTile
                    label="Fees Collected"
                    value={m ? fmtUSD(m.totalFeesCollected) : "—"}
                    tone="blue"
                  />
                  <CompactMetricTile
                    label="Processing"
                    value={m ? fmt(m.processingTransactions) : "—"}
                    tone="amber"
                    detail="In-flight on-chain"
                  />
                  <CompactMetricTile
                    label="Waiting"
                    value={m ? fmt(m.pendingTransactions) : "—"}
                    detail="Waiting for customer action"
                  />
                  <CompactMetricTile
                    label="Failed"
                    value={m ? fmt(m.failedTransactions) : "—"}
                    tone="red"
                    detail="Hard provider failure"
                  />
                  <CompactMetricTile
                    label="Canceled"
                    value={m ? fmt(m.incompleteTransactions) : "—"}
                    tone="amber"
                    detail="Customer abandoned"
                  />
                  <CompactMetricTile
                    label="Expired"
                    value={m ? fmt(m.expiredTransactions) : "—"}
                    detail="Expired"
                  />
                </MetricGrid>
              </DashboardSection>

              {/* Platform Health + Month Snapshot */}
              <div className="grid gap-4 lg:grid-cols-2">
                <GroupedMetricSurface title="Platform Health" titleTone="blue">
                  <div className="divide-y divide-gray-100">
                    {[
                      { label: "Merchant Accounts", value: m ? fmt(m.totalMerchants) : "—", color: "text-[#0052FF]" },
                      { label: "Active Merchants", value: m ? fmt(m.activeMerchants) : "—", color: "text-emerald-600" },
                      { label: "Connected Providers", value: m ? fmt(m.connectedProviders) : "—", color: "text-gray-950" },
                    ].map((row) => (
                      <div
                        key={row.label}
                        className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                      >
                        <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-500">
                          {row.label}
                        </span>
                        <span className={`text-lg font-bold leading-none ${row.color}`}>
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </GroupedMetricSurface>

                <GroupedMetricSurface title={`Month Snapshot — ${monthLabel}`} titleTone="blue">
                  <div className="divide-y divide-gray-100">
                    {[
                      { label: "New Merchants", value: g ? fmt(g.usersThisMonth) : "—", color: "text-[#0052FF]" },
                      { label: "Transactions", value: g ? fmt(g.transactionsThisMonth) : "—", color: "text-gray-950" },
                      { label: "Success Volume", value: g ? fmtUSD(g.volumeThisMonth) : "—", color: "text-emerald-600" },
                    ].map((row) => (
                      <div
                        key={row.label}
                        className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                      >
                        <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-500">
                          {row.label}
                        </span>
                        <span className={`text-lg font-bold leading-none ${row.color}`}>
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </GroupedMetricSurface>
              </div>

              {/* Navigate */}
              <DashboardSection title="Navigate" titleTone="blue">
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  {[
                    {
                      label: "Support Queue",
                      desc: "Tickets & replies",
                      onClick: () => { setActiveTab("support"); setSelectedTicketId(null) },
                    },
                    {
                      label: "Feedback",
                      desc: "Merchant ratings",
                      onClick: () => setActiveTab("feedback"),
                    },
                    { label: "Transaction Explorer", href: "/dashboard/admin/transactions", desc: "All platform payments" },
                    { label: "Platform Reports", href: "/dashboard/admin/reports", desc: "Network reporting" },
                  ].map((link) =>
                    "onClick" in link ? (
                      <button
                        key={link.label}
                        onClick={link.onClick}
                        className="group relative rounded-2xl border border-gray-200/80 bg-white px-4 py-5 text-left shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_18px_50px_rgba(15,23,42,0.10),0_0_36px_rgba(37,99,235,0.14)] focus:outline-none sm:px-5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-gray-900 transition-colors group-hover:text-[#0052FF]">
                              {link.label}
                            </p>
                            <p className="mt-1 text-xs text-gray-500">{link.desc}</p>
                          </div>
                          <ChevronRight
                            size={14}
                            className="mt-0.5 shrink-0 text-gray-400 transition-colors group-hover:text-[#0052FF]"
                          />
                        </div>
                      </button>
                    ) : (
                      <Link
                        key={link.label}
                        href={link.href!}
                        className="group relative rounded-2xl border border-gray-200/80 bg-white px-4 py-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_18px_50px_rgba(15,23,42,0.10),0_0_36px_rgba(37,99,235,0.14)] focus:outline-none sm:px-5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-gray-900 transition-colors group-hover:text-[#0052FF]">
                              {link.label}
                            </p>
                            <p className="mt-1 text-xs text-gray-500">{link.desc}</p>
                          </div>
                          <ChevronRight
                            size={14}
                            className="mt-0.5 shrink-0 text-gray-400 transition-colors group-hover:text-[#0052FF]"
                          />
                        </div>
                      </Link>
                    )
                  )}
                </div>
              </DashboardSection>

              {/* Recent Transactions */}
              <DashboardSection
                title="Recent Transactions"
                titleTone="blue"
                action={
                  <Link
                    href="/dashboard/admin/transactions"
                    className="text-xs font-medium text-[#0052FF] hover:underline"
                  >
                    View all
                  </Link>
                }
              >
                <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                  {!overview?.recentTransactions.length ? (
                    <p className="px-5 py-10 text-center text-sm text-gray-400">
                      No transactions yet.
                    </p>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      <div className="hidden grid-cols-[1fr_120px_110px_130px_100px] gap-4 bg-gray-50/60 px-5 py-2.5 sm:grid">
                        {["Payment ID", "Provider", "Network", "Amount", "Status"].map((h) => (
                          <div
                            key={h}
                            className="text-[11px] font-semibold uppercase tracking-wider text-gray-400"
                          >
                            {h}
                          </div>
                        ))}
                      </div>
                      {overview.recentTransactions.map((tx) => (
                        <button
                          key={tx.id}
                          onClick={() => openTxDetail(tx.id, token)}
                          className="w-full text-left flex items-center gap-3 px-5 py-3.5 sm:grid sm:grid-cols-[1fr_120px_110px_130px_100px] sm:gap-4 transition-colors hover:bg-[#0052FF]/[0.025] focus:outline-none"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-mono text-xs text-gray-700">
                              {tx.id.slice(0, 16)}…
                            </p>
                            <p className="mt-0.5 text-[11px] text-gray-400">
                              {fmtDate(tx.created_at)}
                            </p>
                          </div>
                          <div className="hidden text-sm text-gray-600 sm:block">
                            {tx.provider ? formatDashboardProvider(tx.provider) : <span className="text-gray-300">—</span>}
                          </div>
                          <div className="hidden text-sm text-gray-600 sm:block">
                            {tx.network ? formatDashboardNetwork(tx.network) : <span className="text-gray-300">—</span>}
                          </div>
                          <div className="hidden text-sm font-medium text-gray-900 sm:block">
                            {fmtUSD(Number(tx.gross_amount ?? 0))}
                          </div>
                          <div>
                            <PaymentStatusBadge status={tx.status} />
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </DashboardSection>

              {/* Recent Tickets + Feedback */}
              <div className="grid gap-6 lg:grid-cols-2">
                <DashboardSection
                  title="Recent Tickets"
                  titleTone="blue"
                  action={
                    <button
                      onClick={() => { setActiveTab("support"); setSelectedTicketId(null) }}
                      className="text-xs font-medium text-[#0052FF] hover:underline"
                    >
                      View all
                    </button>
                  }
                >
                  <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                    {!overview?.recentTickets.length ? (
                      <p className="px-5 py-10 text-center text-sm text-gray-400">
                        No tickets yet.
                      </p>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {overview.recentTickets.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => setActiveTab("support")}
                            className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[#0052FF]/[0.025]"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-gray-900">
                                {t.subject}
                              </p>
                              <p className="mt-0.5 text-xs text-gray-400">
                                {t.merchant_email ?? t.merchant_business_name ?? "—"} ·{" "}
                                {fmtDate(t.created_at)}
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <StatusBadge status={t.status} />
                              <PriorityBadge priority={t.priority} />
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </DashboardSection>

                <DashboardSection
                  title="Recent Feedback"
                  titleTone="blue"
                  action={
                    <button
                      onClick={() => setActiveTab("feedback")}
                      className="text-xs font-medium text-[#0052FF] hover:underline"
                    >
                      View all
                    </button>
                  }
                >
                  <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                    {!overview?.recentFeedback.length ? (
                      <p className="px-5 py-10 text-center text-sm text-gray-400">
                        No feedback yet.
                      </p>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {overview.recentFeedback.map((fb) => (
                          <div key={fb.id} className="px-5 py-3.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                                {fb.type}
                              </span>
                              {fb.rating !== null && (
                                <span className="text-xs text-amber-500 font-medium">
                                  {"★".repeat(fb.rating)}
                                  {"☆".repeat(5 - fb.rating)}
                                </span>
                              )}
                            </div>
                            <p className="mt-2 line-clamp-1 text-sm text-gray-700">
                              {fb.message}
                            </p>
                            <p className="mt-1 text-xs text-gray-400">
                              {fb.merchant_id.slice(0, 12)}… · {fmtDate(fb.created_at)}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </DashboardSection>
              </div>
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          SUPPORT TAB
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "providers" && (
        <div className="space-y-5 pb-8">
          <DashboardSection title="Provider Onboarding" titleTone="blue">
            <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              {loadingProviderOnboarding ? (
                <Spinner />
              ) : providerOnboarding.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <p className="text-sm font-medium text-gray-900">No provider onboarding records</p>
                  <p className="mt-1 text-sm text-gray-500">
                    Stripe and Fluid Pay setup requests will appear here after merchants start onboarding.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {providerOnboarding.map((item) => {
                    const key = `${item.provider}:${item.merchantId}`
                    const busy = updatingProviderOnboarding === key
                    const providerLabel = item.provider === "stripe" ? "Stripe" : "Fluid Pay"
                    const statusLabel =
                      item.applicationStatus === "approved"
                        ? "Approved"
                        : item.applicationStatus === "denied"
                          ? "Denied"
                          : item.applicationStatus === "pending"
                            ? "Pending"
                            : "Not started"
                    const statusClass =
                      item.applicationStatus === "approved"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : item.applicationStatus === "denied"
                          ? "border-red-200 bg-red-50 text-red-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"

                    return (
                      <div key={key} className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-gray-950">{providerLabel}</p>
                            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusClass}`}>
                              {statusLabel}
                            </span>
                            <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-500">
                              {item.enabled ? "Enabled" : "Disabled"}
                            </span>
                          </div>
                          <p className="mt-1 font-mono text-xs text-gray-500">Merchant: {item.merchantId}</p>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                            <span>Started: {item.setupStartedAt ? fmtDateTime(item.setupStartedAt) : "-"}</span>
                            <span>Returned: {item.setupReturnedAt ? fmtDateTime(item.setupReturnedAt) : "-"}</span>
                            <span>Updated: {item.updatedAt ? fmtDateTime(item.updatedAt) : "-"}</span>
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => updateProviderOnboarding(item, "approved")}
                            disabled={busy || item.applicationStatus === "approved"}
                            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {busy ? "Updating..." : "Approve"}
                          </button>
                          <button
                            type="button"
                            onClick={() => updateProviderOnboarding(item, "denied")}
                            disabled={busy || item.applicationStatus === "denied"}
                            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {busy ? "Updating..." : "Deny"}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </DashboardSection>
        </div>
      )}

      {activeTab === "support" && (
        <div className="space-y-5 pb-8">

          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {SUPPORT_STAT_CONFIG.map((s) => (
              <button
                key={s.key}
                onClick={() =>
                  setStatusFilter(
                    STATUS_FILTERS.find((f) => f.value === s.key)?.value ?? ""
                  )
                }
                className="rounded-2xl border border-gray-200/80 bg-white px-4 py-4 text-left shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_18px_50px_rgba(15,23,42,0.10),0_0_36px_rgba(37,99,235,0.14)] focus:outline-none"
              >
                <div className="flex items-center gap-1.5 mb-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
                    {s.label}
                  </span>
                </div>
                <div className={`text-2xl font-bold leading-none ${s.color}`}>
                  {ticketStats[s.key]}
                </div>
              </button>
            ))}
          </div>

          {/* Filters row */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <SegmentedButtons
              ariaLabel="Ticket status filter"
              value={statusFilter}
              onChange={setStatusFilter}
              options={STATUS_FILTERS.map((s) => ({ value: s.value, label: s.label }))}
            />
            <div className="flex flex-1 items-center gap-2 sm:ml-auto sm:max-w-sm">
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-[#0052FF]/40 focus:outline-none focus:ring-2 focus:ring-[#0052FF]/10"
              >
                <option value="">All Priorities</option>
                <option value="Urgent">Urgent</option>
                <option value="High">High</option>
                <option value="Normal">Normal</option>
                <option value="Low">Low</option>
              </select>
              <div className="relative flex-1">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search tickets..."
                  className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm focus:border-[#0052FF]/40 focus:outline-none focus:ring-2 focus:ring-[#0052FF]/10"
                />
              </div>
              <button
                onClick={() => token && fetchTickets(token)}
                disabled={loadingTickets}
                title="Refresh tickets"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 shadow-sm hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCw size={14} className={loadingTickets ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          {/* Ticket list */}
          <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
            {loadingTickets ? (
              <Spinner />
            ) : filteredTickets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <MessageSquare size={30} className="text-gray-300" />
                <p className="mt-3 font-medium text-gray-900">No tickets found</p>
                <p className="mt-1 text-sm text-gray-500">
                  {tickets.length === 0
                    ? "No support tickets have been submitted yet."
                    : "Try adjusting your filters or search."}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                <div className="hidden grid-cols-[1fr_190px_100px_120px_110px_28px] gap-4 bg-gray-50/60 px-5 py-2.5 sm:grid">
                  {["Subject", "Merchant", "Priority", "Status", "Date", ""].map((h) => (
                    <div
                      key={h}
                      className="text-[11px] font-semibold uppercase tracking-wider text-gray-400"
                    >
                      {h}
                    </div>
                  ))}
                </div>
                {filteredTickets.map((ticket) => (
                  <button
                    key={ticket.id}
                    onClick={() => openTicket(ticket.id, token)}
                    className="w-full text-left transition-colors hover:bg-[#0052FF]/[0.025] focus:outline-none"
                  >
                    <div className="flex items-center gap-3 px-5 py-4 sm:grid sm:grid-cols-[1fr_190px_100px_120px_110px_28px] sm:gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {ticket.subject}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-400">{ticket.category}</p>
                      </div>
                      <div className="hidden min-w-0 sm:block">
                        <p className="truncate text-sm text-gray-700">
                          {ticket.merchant_email ||
                            ticket.merchant_id.slice(0, 12) + "…"}
                        </p>
                        {ticket.merchant_business_name && (
                          <p className="truncate text-xs text-gray-400">
                            {ticket.merchant_business_name}
                          </p>
                        )}
                      </div>
                      <div className="hidden sm:block">
                        <PriorityBadge priority={ticket.priority} />
                      </div>
                      <div>
                        <StatusBadge status={ticket.status} />
                      </div>
                      <div className="hidden text-xs text-gray-400 sm:block">
                        {fmtDate(ticket.created_at)}
                      </div>
                      <div className="ml-auto sm:ml-0">
                        <ChevronRight size={15} className="text-gray-400" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          FEEDBACK TAB
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "feedback" && (
        <div className="space-y-3 pb-8">
          {loadingFeedback ? (
            <Spinner />
          ) : feedback.length === 0 ? (
            <div className="rounded-2xl border border-gray-200/80 bg-white p-12 text-center shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <Star size={30} className="mx-auto text-gray-300" />
              <p className="mt-3 font-medium text-gray-900">No feedback yet</p>
              <p className="mt-1 text-sm text-gray-500">
                Merchant feedback will appear here once submitted.
              </p>
            </div>
          ) : (
            feedback.map((fb) => (
              <div
                key={fb.id}
                className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_18px_50px_rgba(15,23,42,0.10),0_0_36px_rgba(37,99,235,0.14)]"
              >
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                        {fb.type}
                      </span>
                      <StarRating rating={fb.rating} />
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">
                      {fb.message}
                    </p>
                    <p className="mt-2 text-xs text-gray-400">
                      Merchant: {fb.merchant_id.slice(0, 12)}… · {fmtDate(fb.created_at)}
                    </p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          TICKET DETAIL PANEL (shared, available from support tab)
      ════════════════════════════════════════════════════════════════════════ */}
      {/* ════════════════════════════════════════════════════════════════════════
          TRANSACTION DETAIL PANEL
      ════════════════════════════════════════════════════════════════════════ */}
      {selectedTxId && (
        <>
          <div
            data-pinetree-overlay="true"
            className="pinetree-modal-backdrop fixed inset-0 z-40"
            onClick={() => {
              setSelectedTxId(null)
              setTxDetail(null)
            }}
          />
          <div className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-2xl sm:w-[560px] lg:w-[620px]">
            {/* Panel header */}
            <div className="flex-none border-b border-gray-100 px-6 py-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">
                    Platform Transaction Detail
                  </p>
                  <h2 className="mt-1 font-mono text-sm text-gray-800 break-all">
                    {selectedTxId}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedTxId(null); setTxDetail(null) }}
                  aria-label="Close transaction detail"
                  className={modalCloseButtonClass}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {loadingTxDetail ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              </div>
            ) : txDetail ? (
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                {/* Status + amounts */}
                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <PaymentStatusBadge status={txDetail.payment.status} />
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${paymentModeFromMetadata(txDetail.payment.metadata) === "test" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
                      {paymentModeFromMetadata(txDetail.payment.metadata) === "test" ? "Test" : "Live"}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-400">Total</p>
                      <p className="mt-1 text-lg font-bold text-gray-900">
                        {fmtUSD(Number(txDetail.payment.gross_amount ?? 0))}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-400">Merchant</p>
                      <p className="mt-1 text-lg font-bold text-gray-900">
                        {fmtUSD(Number(txDetail.payment.merchant_amount ?? 0))}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-400">Fee</p>
                      <p className="mt-1 text-lg font-bold text-[#0052FF]">
                        {fmtUSD(Number(txDetail.payment.pinetree_fee ?? 0))}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Details grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                  <div>
                    <p className="text-gray-400">Merchant ID</p>
                    <p className="mt-0.5 font-mono text-gray-700 break-all">{txDetail.payment.merchant_id}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Currency</p>
                    <p className="mt-0.5 text-gray-700">{txDetail.payment.currency || "USD"}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Network</p>
                    <p className="mt-0.5 text-gray-700">
                      {txDetail.payment.network
                        ? formatDashboardNetwork(txDetail.payment.network)
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400">Provider</p>
                    <p className="mt-0.5 text-gray-700">
                      {txDetail.payment.provider
                        ? formatDashboardProvider(txDetail.payment.provider)
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400">Created</p>
                    <p className="mt-0.5 text-gray-700">{fmtDateTime(txDetail.payment.created_at)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Updated</p>
                    <p className="mt-0.5 text-gray-700">{fmtDateTime(txDetail.payment.updated_at)}</p>
                  </div>
                  {txDetail.payment.provider_reference && (
                    <div className="col-span-2">
                      <p className="text-gray-400">Tx Hash / Reference</p>
                      <p className="mt-0.5 font-mono text-gray-700 break-all text-[11px]">
                        {txDetail.payment.provider_reference}
                      </p>
                    </div>
                  )}
                </div>

                {/* Event timeline */}
                {txDetail.events.length > 0 && (
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
                      Payment Timeline
                    </p>
                    <div className="space-y-1">
                      {txDetail.events.map((ev) => (
                        <div
                          key={ev.id}
                          className="flex items-start gap-3 rounded-xl bg-gray-50 px-3 py-2.5"
                        >
                          <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-blue-400" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-medium text-gray-800">
                                {EVENT_LABELS[ev.event_type] ?? ev.event_type}
                              </p>
                              <p className="shrink-0 text-[11px] text-gray-400">
                                {fmtDateTime(ev.created_at)}
                              </p>
                            </div>
                            {ev.provider_event && (
                              <p className="mt-0.5 text-[11px] text-gray-400">{ev.provider_event}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {txDetail.events.length === 0 && (
                  <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                    <p className="text-xs text-gray-400">No payment events recorded for this payment.</p>
                  </div>
                )}

                {/* View in explorer */}
                <div className="border-t border-gray-100 pt-4">
                  <Link
                    href={`/dashboard/admin/transactions?search=${encodeURIComponent(txDetail.payment.id)}`}
                    className="text-xs font-medium text-[#0052FF] hover:underline"
                    onClick={() => { setSelectedTxId(null); setTxDetail(null) }}
                  >
                    Open in Transaction Explorer →
                  </Link>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-sm text-gray-400">Failed to load transaction detail.</p>
              </div>
            )}
          </div>
        </>
      )}

      {selectedTicketId && (
        <>
          <div
            data-pinetree-overlay="true"
            className="pinetree-modal-backdrop fixed inset-0 z-40"
            onClick={() => {
              setSelectedTicketId(null)
              setDetail(null)
            }}
          />
          <div className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-2xl sm:w-[600px] lg:w-[660px]">
            {loadingDetail ? (
              <Spinner />
            ) : detail ? (
              <>
                {/* Panel header */}
                <div className="flex-none border-b border-gray-100 px-6 py-5">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-base font-semibold leading-snug text-gray-900">
                        {detail.ticket.subject}
                      </h2>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <StatusBadge status={detail.ticket.status} />
                        <PriorityBadge priority={detail.ticket.priority} />
                        <span className="text-xs text-gray-400">{detail.ticket.category}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTicketId(null)
                        setDetail(null)
                      }}
                      aria-label="Close ticket detail"
                      className={modalCloseButtonClass}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div>
                      <p className="text-gray-400">Ticket ID</p>
                      <p className="mt-0.5 font-mono text-gray-700">
                        {detail.ticket.id.slice(0, 18)}…
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400">Created</p>
                      <p className="mt-0.5 text-gray-700">{fmtDate(detail.ticket.created_at)}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Merchant Email</p>
                      <p className="mt-0.5 text-gray-700">
                        {detail.ticket.merchant_email || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400">Business Name</p>
                      <p className="mt-0.5 text-gray-700">
                        {detail.ticket.merchant_business_name || "—"}
                      </p>
                    </div>
                    {detail.ticket.last_response_at && (
                      <div>
                        <p className="text-gray-400">Last Response</p>
                        <p className="mt-0.5 text-gray-700">
                          {fmtDate(detail.ticket.last_response_at)}
                        </p>
                      </div>
                    )}
                    {detail.ticket.related_payment_id && (
                      <div>
                        <p className="text-gray-400">Related Payment</p>
                        <p className="mt-0.5 font-mono text-gray-700">
                          {detail.ticket.related_payment_id.slice(0, 16)}…
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Message thread */}
                <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
                  <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-500">Original Message</span>
                      <span className="text-xs text-gray-400">
                        {fmtDateTime(detail.ticket.created_at)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-gray-700">
                      {detail.ticket.description}
                    </p>
                  </div>
                  {detail.messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${
                        msg.sender_type === "pinetree" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[88%] rounded-2xl px-4 py-3 ${
                          msg.sender_type === "pinetree"
                            ? "bg-[#0052FF] text-white"
                            : msg.sender_type === "system"
                            ? "bg-gray-100 text-gray-500 text-xs italic"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {msg.sender_type !== "system" && (
                          <p
                            className={`mb-1 text-xs font-semibold ${
                              msg.sender_type === "pinetree"
                                ? "text-blue-200"
                                : "text-gray-500"
                            }`}
                          >
                            {msg.sender_name ||
                              (msg.sender_type === "pinetree"
                                ? "PineTree Support"
                                : "Merchant")}
                          </p>
                        )}
                        <p className="whitespace-pre-wrap text-sm">{msg.message}</p>
                        <p
                          className={`mt-1.5 text-xs ${
                            msg.sender_type === "pinetree"
                              ? "text-blue-300"
                              : "text-gray-400"
                          }`}
                        >
                          {fmtDateTime(msg.created_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Status quick actions */}
                <div className="flex-none border-t border-gray-100 px-6 py-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
                    Set Status
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {ACTION_STATUSES.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => updateStatus(detail.ticket.id, s.value)}
                        disabled={updatingStatus || detail.ticket.status === s.value}
                        className={`${segmentedButtonClass(detail.ticket.status === s.value)} disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Reply box */}
                <div className="flex-none border-t border-gray-200 bg-gray-50 px-6 py-5">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
                    Reply as PineTree Support
                  </p>
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Write your reply to the merchant..."
                    rows={3}
                    className="w-full resize-none rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm focus:border-[#0052FF]/40 focus:outline-none focus:ring-2 focus:ring-[#0052FF]/10"
                  />
                  <div className="mt-3 flex items-center gap-3">
                    <select
                      value={replyStatus}
                      onChange={(e) => setReplyStatus(e.target.value)}
                      className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-[#0052FF]/40 focus:outline-none"
                    >
                      {ACTION_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={sendReply}
                      disabled={submitting || !replyText.trim()}
                      className={primaryActionButtonClass}
                    >
                      <Send size={14} />
                      {submitting ? "Sending…" : "Send Reply"}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-sm text-gray-400">Failed to load ticket detail.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
