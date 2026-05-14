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

// ─── Overview types ────────────────────────────────────────────────────────────

type Metrics = {
  totalTransactions: number
  confirmedTransactions: number
  pendingTransactions: number
  failedTransactions: number
  totalConfirmedVolume: number
  totalFeesCollected: number
  activeMerchants: number
  totalUsers: number
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

// ─── Constants ─────────────────────────────────────────────────────────────────

type AdminTab = "overview" | "support" | "feedback"

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

const TX_STATUS_STYLE: Record<string, string> = {
  CONFIRMED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  PENDING: "bg-blue-50 text-blue-700 border-blue-200",
  PROCESSING: "bg-blue-50 text-blue-600 border-blue-200",
  CREATED: "bg-gray-100 text-gray-500 border-gray-200",
  FAILED: "bg-red-50 text-red-700 border-red-200",
  INCOMPLETE: "bg-orange-50 text-orange-700 border-orange-200",
  EXPIRED: "bg-gray-100 text-gray-500 border-gray-200",
  REFUNDED: "bg-purple-50 text-purple-700 border-purple-200",
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

function StatusPill({
  value,
  styleMap,
  labelMap,
}: {
  value: string
  styleMap: Record<string, string>
  labelMap?: Record<string, string>
}) {
  const cls = styleMap[value] ?? "bg-gray-100 text-gray-600 border-gray-200"
  const label = labelMap?.[value] ?? value
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  )
}

function MetricCard({
  label,
  value,
  sub,
  accent = "gray",
}: {
  label: string
  value: string
  sub?: string
  accent?: "blue" | "green" | "amber" | "red" | "gray"
}) {
  const border: Record<string, string> = {
    blue: "border-[#0052FF]/15",
    green: "border-emerald-200/60",
    amber: "border-amber-200/60",
    red: "border-red-200/60",
    gray: "border-gray-200",
  }
  const dot: Record<string, string> = {
    blue: "bg-[#0052FF]",
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
    gray: "bg-gray-400",
  }
  const val: Record<string, string> = {
    blue: "text-[#0052FF]",
    green: "text-emerald-600",
    amber: "text-amber-600",
    red: "text-red-600",
    gray: "text-gray-800",
  }

  return (
    <div className={`rounded-xl border ${border[accent]} bg-white px-4 py-4 shadow-sm`}>
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className={`h-1.5 w-1.5 rounded-full ${dot[accent]}`} />
        <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">{label}</p>
      </div>
      <p className={`text-2xl font-bold leading-none ${val[accent]}`}>{value}</p>
      {sub && <p className="mt-1.5 text-xs text-gray-400">{sub}</p>}
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
        className="mt-2 rounded-xl bg-[#0052FF] px-5 py-2 text-sm font-semibold text-white hover:bg-[#003FCC]"
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
    <div className="space-y-6">

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0052FF]/8">
            <div className="h-3 w-3 rounded-sm bg-[#0052FF]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900">Admin</h1>
              <span className="inline-flex items-center rounded-full bg-[#0052FF]/8 px-2 py-0.5 text-[11px] font-semibold text-[#0052FF]">
                PineTree Internal
              </span>
            </div>
            <p className="mt-0.5 text-sm text-gray-500">
              Platform overview, support queue, and merchant feedback
            </p>
          </div>
        </div>
        {overview?.generatedAt && (
          <p className="shrink-0 text-xs text-gray-400 mt-1">
            Updated {fmtDateTime(overview.generatedAt)}
          </p>
        )}
      </div>

      {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 w-fit">
        {(
          [
            { key: "overview" as AdminTab, label: "Overview" },
            { key: "support" as AdminTab, label: "Support", badge: ticketsLoaded ? tickets.length : null },
            { key: "feedback" as AdminTab, label: "Feedback", badge: feedbackLoaded ? feedback.length : null },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key)
              setSelectedTicketId(null)
              setDetail(null)
            }}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
            {"badge" in tab && tab.badge !== null && tab.badge > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                  activeTab === tab.key
                    ? "bg-[#0052FF]/10 text-[#0052FF]"
                    : "bg-gray-200 text-gray-500"
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
            <div className="space-y-6">

              {/* Payment metrics */}
              <section>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-gray-400">
                  Payments — All Time
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <MetricCard label="Total" value={m ? fmt(m.totalTransactions) : "—"} accent="gray" />
                  <MetricCard label="Confirmed" value={m ? fmt(m.confirmedTransactions) : "—"} accent="green" />
                  <MetricCard label="Pending" value={m ? fmt(m.pendingTransactions) : "—"} accent="amber" />
                  <MetricCard label="Failed" value={m ? fmt(m.failedTransactions) : "—"} accent="red" />
                  <MetricCard label="Conf. Volume" value={m ? fmtUSD(m.totalConfirmedVolume) : "—"} accent="blue" />
                  <MetricCard label="Fees" value={m ? fmtUSD(m.totalFeesCollected) : "—"} accent="blue" />
                </div>
              </section>

              {/* Platform + growth */}
              <div className="grid gap-6 lg:grid-cols-2">
                <section>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-gray-400">
                    Platform
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <MetricCard
                      label="Total Users"
                      value={m ? fmt(m.totalUsers) : "—"}
                      sub="All merchants"
                      accent="blue"
                    />
                    <MetricCard
                      label="Active"
                      value={m ? fmt(m.activeMerchants) : "—"}
                      sub="Status: active"
                      accent="green"
                    />
                    <MetricCard
                      label="Providers"
                      value={m ? fmt(m.connectedProviders) : "—"}
                      sub="Connections"
                      accent="gray"
                    />
                  </div>
                </section>

                <section>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-gray-400">
                    This Month — {monthLabel}
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    <MetricCard
                      label="New Users"
                      value={g ? fmt(g.usersThisMonth) : "—"}
                      accent="blue"
                    />
                    <MetricCard
                      label="Transactions"
                      value={g ? fmt(g.transactionsThisMonth) : "—"}
                      accent="gray"
                    />
                    <MetricCard
                      label="Volume"
                      value={g ? fmtUSD(g.volumeThisMonth) : "—"}
                      sub="Confirmed"
                      accent="green"
                    />
                  </div>
                </section>
              </div>

              {/* Quick links */}
              <section>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-gray-400">
                  Navigate
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: "Support Queue", desc: "Tickets & replies", onClick: () => { setActiveTab("support"); setSelectedTicketId(null) } },
                    { label: "Feedback", desc: "Merchant ratings", onClick: () => setActiveTab("feedback") },
                    { label: "Transactions", href: "/dashboard/transactions", desc: "All payments" },
                    { label: "Reports", href: "/dashboard/reports", desc: "Revenue reports" },
                  ].map((link) =>
                    "onClick" in link ? (
                      <button
                        key={link.label}
                        onClick={link.onClick}
                        className="group rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-left shadow-sm transition-all hover:border-[#0052FF]/25 hover:shadow-[0_0_0_1px_rgba(0,82,255,0.12),0_4px_12px_rgba(0,82,255,0.06)]"
                      >
                        <p className="text-sm font-semibold text-gray-900 group-hover:text-[#0052FF]">
                          {link.label}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-400">{link.desc}</p>
                      </button>
                    ) : (
                      <Link
                        key={link.label}
                        href={link.href!}
                        className="group rounded-xl border border-gray-200 bg-white px-4 py-3.5 shadow-sm transition-all hover:border-[#0052FF]/25 hover:shadow-[0_0_0_1px_rgba(0,82,255,0.12),0_4px_12px_rgba(0,82,255,0.06)]"
                      >
                        <p className="text-sm font-semibold text-gray-900 group-hover:text-[#0052FF]">
                          {link.label}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-400">{link.desc}</p>
                      </Link>
                    )
                  )}
                </div>
              </section>

              {/* Recent transactions */}
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
                    Recent Transactions
                  </p>
                  <Link
                    href="/dashboard/transactions"
                    className="text-xs font-medium text-[#0052FF] hover:underline"
                  >
                    View all
                  </Link>
                </div>
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                  {!overview?.recentTransactions.length ? (
                    <p className="px-5 py-10 text-center text-sm text-gray-400">
                      No transactions yet.
                    </p>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      <div className="hidden grid-cols-[1fr_120px_110px_130px_100px] gap-4 bg-gray-50 px-5 py-2.5 sm:grid">
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
                        <div
                          key={tx.id}
                          className="flex items-center gap-3 px-5 py-3.5 sm:grid sm:grid-cols-[1fr_120px_110px_130px_100px] sm:gap-4"
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
                            {tx.provider ?? <span className="text-gray-300">—</span>}
                          </div>
                          <div className="hidden text-sm text-gray-600 sm:block">
                            {tx.network ?? <span className="text-gray-300">—</span>}
                          </div>
                          <div className="hidden text-sm font-medium text-gray-900 sm:block">
                            {fmtUSD(Number(tx.gross_amount ?? 0))}
                          </div>
                          <div>
                            <StatusPill value={tx.status} styleMap={TX_STATUS_STYLE} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              {/* Recent tickets + feedback preview */}
              <div className="grid gap-6 lg:grid-cols-2">
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
                      Recent Tickets
                    </p>
                    <button
                      onClick={() => { setActiveTab("support"); setSelectedTicketId(null) }}
                      className="text-xs font-medium text-[#0052FF] hover:underline"
                    >
                      View all
                    </button>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                    {!overview?.recentTickets.length ? (
                      <p className="px-5 py-10 text-center text-sm text-gray-400">No tickets yet.</p>
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
                </section>

                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
                      Recent Feedback
                    </p>
                    <button
                      onClick={() => setActiveTab("feedback")}
                      className="text-xs font-medium text-[#0052FF] hover:underline"
                    >
                      View all
                    </button>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
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
                            <p className="mt-2 line-clamp-1 text-sm text-gray-700">{fb.message}</p>
                            <p className="mt-1 text-xs text-gray-400">
                              {fb.merchant_id.slice(0, 12)}… · {fmtDate(fb.created_at)}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          SUPPORT TAB
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "support" && (
        <div className="space-y-5">

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
                className="rounded-xl border border-gray-200 bg-white px-4 py-4 text-left shadow-sm transition-colors hover:border-[#0052FF]/20 hover:bg-[#0052FF]/[0.02]"
              >
                <div className="flex items-center gap-1.5 mb-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
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
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setStatusFilter(s.value)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    statusFilter === s.value
                      ? "border-[#0052FF] bg-[#0052FF] text-white"
                      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
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
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
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
                <div className="hidden grid-cols-[1fr_190px_100px_120px_110px_28px] gap-4 bg-gray-50 px-5 py-2.5 sm:grid">
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
        <div className="space-y-3">
          {loadingFeedback ? (
            <Spinner />
          ) : feedback.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm">
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
                className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-[0_0_0_1px_rgba(0,82,255,0.08),0_4px_12px_rgba(0,82,255,0.05)]"
              >
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                        {fb.type}
                      </span>
                      <StarRating rating={fb.rating} />
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">{fb.message}</p>
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
      {selectedTicketId && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
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
                      onClick={() => {
                        setSelectedTicketId(null)
                        setDetail(null)
                      }}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
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
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-gray-400">
                    Set Status
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {ACTION_STATUSES.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => updateStatus(detail.ticket.id, s.value)}
                        disabled={updatingStatus || detail.ticket.status === s.value}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          detail.ticket.status === s.value
                            ? "border-[#0052FF] bg-[#0052FF] text-white"
                            : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Reply box */}
                <div className="flex-none border-t border-gray-200 bg-gray-50 px-6 py-5">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-gray-400">
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
                      className="inline-flex items-center gap-2 rounded-xl bg-[#0052FF] px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#003FCC] disabled:cursor-not-allowed disabled:opacity-50"
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
