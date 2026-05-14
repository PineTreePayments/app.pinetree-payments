"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
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

// ─── Types ─────────────────────────────────────────────────────────────────────

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

// ─── Helpers ───────────────────────────────────────────────────────────────────

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

// ─── Sub-components ────────────────────────────────────────────────────────────

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

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminSupportPage() {
  const router = useRouter()
  const [token, setToken] = useState("")
  const [unauthorized, setUnauthorized] = useState(false)
  const [activeTab, setActiveTab] = useState<"tickets" | "feedback">("tickets")

  // Tickets
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loadingTickets, setLoadingTickets] = useState(true)
  const [statusFilter, setStatusFilter] = useState("")
  const [priorityFilter, setPriorityFilter] = useState("")
  const [search, setSearch] = useState("")

  // Selected ticket detail
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ ticket: Ticket; messages: Message[] } | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Reply
  const [replyText, setReplyText] = useState("")
  const [replyStatus, setReplyStatus] = useState("waiting_on_merchant")
  const [submitting, setSubmitting] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  // Feedback
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const [loadingFeedback, setLoadingFeedback] = useState(false)
  const [feedbackLoaded, setFeedbackLoaded] = useState(false)

  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace("/login")
        return
      }
      setToken(session.access_token)
    })
  }, [router])

  // ── Fetch tickets ─────────────────────────────────────────────────────────

  const fetchTickets = useCallback(
    async (tk: string) => {
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
      } catch {
        toast.error("Failed to load tickets")
      } finally {
        setLoadingTickets(false)
      }
    },
    []
  )

  useEffect(() => {
    if (token) fetchTickets(token)
  }, [token, fetchTickets])

  // ── Fetch feedback ────────────────────────────────────────────────────────

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

  // ── Open ticket detail ────────────────────────────────────────────────────

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

  // ── Send reply ────────────────────────────────────────────────────────────

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

  // ── Update status ─────────────────────────────────────────────────────────

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

  // ── Derived state ─────────────────────────────────────────────────────────

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

  const stats = useMemo(
    () => ({
      open: tickets.filter((t) => t.status === "open").length,
      in_review: tickets.filter((t) => t.status === "in_review").length,
      waiting_on_merchant: tickets.filter((t) => t.status === "waiting_on_merchant").length,
      resolved: tickets.filter((t) => t.status === "resolved").length,
      archived: tickets.filter((t) => t.status === "archived").length,
    }),
    [tickets]
  )

  // ── Unauthorized ──────────────────────────────────────────────────────────

  if (unauthorized) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-3xl">
          🔒
        </div>
        <h1 className="text-xl font-semibold text-gray-900">Admin Access Required</h1>
        <p className="max-w-xs text-sm text-gray-500">
          Your account does not have admin privileges to view this page.
        </p>
        <a
          href="/dashboard"
          className="mt-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Back to Dashboard
        </a>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-600">
            Admin
          </p>
          <h1 className="mt-0.5 text-xl font-semibold text-gray-900">Support Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage all merchant support tickets and feedback
          </p>
        </div>
        <button
          onClick={() => token && fetchTickets(token)}
          disabled={loadingTickets}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 shadow-sm hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={14} className={loadingTickets ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Stats row */}
      {activeTab === "tickets" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: "Open", value: stats.open, color: "text-blue-600" },
            { label: "In Review", value: stats.in_review, color: "text-amber-600" },
            { label: "Waiting", value: stats.waiting_on_merchant, color: "text-orange-600" },
            { label: "Resolved", value: stats.resolved, color: "text-emerald-600" },
            { label: "Archived", value: stats.archived, color: "text-gray-400" },
          ].map((s) => (
            <button
              key={s.label}
              onClick={() =>
                setStatusFilter(
                  STATUS_FILTERS.find((f) => f.label === s.label)?.value ?? ""
                )
              }
              className="rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50/30"
            >
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="mt-0.5 text-xs font-medium text-gray-500">{s.label}</div>
            </button>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 w-fit">
        {(["tickets", "feedback"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-lg px-5 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab === "tickets" ? "Tickets" : "Feedback"}
            {tab === "tickets" && tickets.length > 0 && (
              <span
                className={`ml-2 rounded-full px-1.5 py-0.5 text-xs ${
                  activeTab === "tickets"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-gray-200 text-gray-500"
                }`}
              >
                {tickets.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tickets tab ─────────────────────────────────────────────────────── */}
      {activeTab === "tickets" && (
        <>
          {/* Filters */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setStatusFilter(s.value)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    statusFilter === s.value
                      ? "border-blue-500 bg-blue-500 text-white"
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
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
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
                  className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>
          </div>

          {/* Ticket list */}
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            {loadingTickets ? (
              <Spinner />
            ) : filteredTickets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <MessageSquare size={32} className="text-gray-300" />
                <p className="mt-3 font-medium text-gray-900">No tickets found</p>
                <p className="mt-1 text-sm text-gray-500">
                  {tickets.length === 0
                    ? "No support tickets have been submitted yet."
                    : "Try adjusting your filters or search."}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {/* Table header */}
                <div className="hidden grid-cols-[1fr_190px_100px_120px_110px_28px] gap-4 bg-gray-50 px-5 py-3 sm:grid">
                  {["Subject", "Merchant", "Priority", "Status", "Date", ""].map((h) => (
                    <div
                      key={h}
                      className="text-xs font-semibold uppercase tracking-wider text-gray-400"
                    >
                      {h}
                    </div>
                  ))}
                </div>

                {filteredTickets.map((ticket) => (
                  <button
                    key={ticket.id}
                    onClick={() => openTicket(ticket.id, token)}
                    className="w-full text-left transition-colors hover:bg-blue-50/40 focus:outline-none"
                  >
                    <div className="flex items-center gap-3 px-5 py-4 sm:grid sm:grid-cols-[1fr_190px_100px_120px_110px_28px] sm:gap-4">
                      {/* Subject */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {ticket.subject}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-400">{ticket.category}</p>
                      </div>
                      {/* Merchant */}
                      <div className="hidden min-w-0 sm:block">
                        <p className="truncate text-sm text-gray-700">
                          {ticket.merchant_email || ticket.merchant_id.slice(0, 12) + "…"}
                        </p>
                        {ticket.merchant_business_name && (
                          <p className="truncate text-xs text-gray-400">
                            {ticket.merchant_business_name}
                          </p>
                        )}
                      </div>
                      {/* Priority */}
                      <div className="hidden sm:block">
                        <PriorityBadge priority={ticket.priority} />
                      </div>
                      {/* Status */}
                      <div>
                        <StatusBadge status={ticket.status} />
                      </div>
                      {/* Date */}
                      <div className="hidden text-xs text-gray-400 sm:block">
                        {fmtDate(ticket.created_at)}
                      </div>
                      {/* Arrow */}
                      <div className="ml-auto sm:ml-0">
                        <ChevronRight size={15} className="text-gray-400" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Feedback tab ────────────────────────────────────────────────────── */}
      {activeTab === "feedback" && (
        <div className="space-y-3">
          {loadingFeedback ? (
            <Spinner />
          ) : feedback.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm">
              <Star size={32} className="mx-auto text-gray-300" />
              <p className="mt-3 font-medium text-gray-900">No feedback yet</p>
              <p className="mt-1 text-sm text-gray-500">
                Merchant feedback will appear here once submitted.
              </p>
            </div>
          ) : (
            feedback.map((fb) => (
              <div
                key={fb.id}
                className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
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

      {/* ── Ticket detail panel ─────────────────────────────────────────────── */}
      {selectedTicketId && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
            onClick={() => {
              setSelectedTicketId(null)
              setDetail(null)
            }}
          />

          {/* Side panel */}
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

                  {/* Ticket metadata */}
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
                  {/* Original description */}
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

                  {/* Follow-up messages */}
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
                            ? "bg-blue-600 text-white"
                            : msg.sender_type === "system"
                            ? "bg-gray-100 text-gray-500 text-xs italic"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {msg.sender_type !== "system" && (
                          <p
                            className={`mb-1 text-xs font-semibold ${
                              msg.sender_type === "pinetree" ? "text-blue-200" : "text-gray-500"
                            }`}
                          >
                            {msg.sender_name ||
                              (msg.sender_type === "pinetree" ? "PineTree Support" : "Merchant")}
                          </p>
                        )}
                        <p className="whitespace-pre-wrap text-sm">{msg.message}</p>
                        <p
                          className={`mt-1.5 text-xs ${
                            msg.sender_type === "pinetree" ? "text-blue-300" : "text-gray-400"
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
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
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
                            ? "border-blue-500 bg-blue-500 text-white"
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
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Reply as PineTree Support
                  </p>
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Write your reply to the merchant..."
                    rows={3}
                    className="w-full resize-none rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <div className="mt-3 flex items-center gap-3">
                    <select
                      value={replyStatus}
                      onChange={(e) => setReplyStatus(e.target.value)}
                      className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-400 focus:outline-none"
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
                      className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
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
