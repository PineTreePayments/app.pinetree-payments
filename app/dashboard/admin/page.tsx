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
  Star,
} from "lucide-react"
import {
  CompactMetricTile,
  DashboardSection,
  GroupedMetricSurface,
  MetricGrid,
} from "@/components/dashboard/DashboardPrimitives"
import {
  formatProviderName,
  formatRailName,
} from "@/components/admin/displayFormatters"
import PaymentStatusBadge from "@/components/ui/StatusBadge"
import { SegmentedButtons, segmentedButtonClass } from "@/components/ui/SegmentedButtons"
import { primaryActionButtonClass } from "@/components/ui/PrimaryActionButton"
import AdminPageHeader, { adminHeaderIconButtonDesktopClass } from "@/components/admin/AdminPageHeader"
// The one Admin transaction-detail component. Overview owns no drawer markup,
// no field mapping and no transaction formatting of its own.
import {
  AdminTransactionDetailPanel,
  useAdminTransactionDetail,
} from "@/components/admin/TransactionDetail"
import Shift4SandboxOperationsSection from "@/components/admin/Shift4SandboxOperationsSection"
import AdminSupportTicketPanel, {
  type AdminSupportMessage,
  type AdminSupportTicket,
} from "@/components/admin/AdminSupportTicketPanel"
import {
  filterIconButtonClass,
  filterSearchIconClass,
  filterSearchInputClass,
  filterSelectClass,
} from "@/components/ui/FilterControls"
import {
  formatSupportCategory,
  formatSupportEnumLabel,
  formatSupportPriority,
  formatSupportStatus,
  formatSupportStatusShort,
  supportEnumEquals,
  supportPriorityPillClass,
  supportStatusPillClass,
} from "@/lib/support/supportDisplay"
import { normalizeStoredPaymentStatus } from "@/lib/utils/canonicalPaymentStatus"

// ─── Overview types ────────────────────────────────────────────────────────────

type Metrics = {
  totalTransactions: number
  confirmedTransactions: number
  processingTransactions: number
  pendingTransactions: number
  failedTransactions: number
  incompleteTransactions: number
  canceledTransactions: number
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
  id?: string
  paymentId?: string
  merchant_id?: string
  merchantId?: string
  status?: string
  canonicalStatus?: string
  provider: string | null
  network: string | null
  rail?: string | null
  asset?: string | null
  gross_amount?: number
  amountMinor?: number
  displayAmount?: string
  currency: string
  created_at?: string
  createdAt?: string
  occurredAt?: string
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
// Ticket/message shapes live with the shared support modal so the admin page and
// the modal cannot drift apart.

type Ticket = AdminSupportTicket
type Message = AdminSupportMessage

type Feedback = {
  id: string
  merchant_id: string
  type: string
  message: string
  rating: number | null
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

const ADMIN_TAB_TITLES: Record<AdminTab, { title: string; description: string }> = {
  overview: {
    title: "Overview",
    description:
      "Platform payments, support operations, merchant activity, and platform health.",
  },
  providers: {
    title: "Provider Operations",
    description:
      "Card and crypto provider onboarding, configuration, merchant connectivity, approval status.",
  },
  support: {
    title: "Support",
    description:
      "Merchant support, ticket management, conversation history, status tracking, and reply workflow.",
  },
  feedback: {
    title: "Merchant Feedback",
    description:
      "Merchant product feedback, feature requests, experience reports, and improvement suggestions.",
  },
}

// Status filter chips use the compact label ("Waiting"); a ticket's own status
// always renders the full label via formatSupportStatus.
const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "open", label: formatSupportStatusShort("open") },
  { value: "in_review", label: formatSupportStatusShort("in_review") },
  { value: "waiting_on_merchant", label: formatSupportStatusShort("waiting_on_merchant") },
  { value: "resolved", label: formatSupportStatusShort("resolved") },
  { value: "archived", label: formatSupportStatusShort("archived") },
]

// Priorities are stored lowercase (engine/support/createSupportTicket.ts), so
// filter values must be the canonical stored values, not display labels.
const PRIORITY_FILTERS = ["urgent", "high", "normal", "low"]

// Overview "Recent …" cards: equal, fixed height with the list scrolling inside
// the card. The card itself never grows with its content.
//
// `w-full min-w-0` is what keeps the card inside a phone viewport: without an
// explicit min-width of 0 a grid/flex item is floored at its content's
// min-content width, so one long unbroken string (a UUID, a URL pasted into
// feedback) widens the whole track and pushes the card off-screen.
const ADMIN_RECENT_CARD_CLASS =
  "flex h-[20rem] flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)] w-full min-w-0 max-w-full"

// Every row carries its own bottom divider — including the last one — so the
// remaining card space reads as empty list space instead of blending into the
// final row and making one ticket look card-height tall.
//
// `overflow-x-hidden` is explicit: a lone `overflow-y-auto` computes the other
// axis to `auto` too, which is exactly the hidden sideways scroll this card
// must never have.
const ADMIN_RECENT_SCROLL_CLASS =
  "min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [&>*]:border-b [&>*]:border-gray-100"

const SUPPORT_STAT_CONFIG = [
  { key: "open" as const, tone: "blue" as const },
  { key: "in_review" as const, tone: "amber" as const },
  { key: "waiting_on_merchant" as const, tone: "amber" as const },
  { key: "resolved" as const, tone: "green" as const },
  { key: "archived" as const, tone: "slate" as const },
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

function recentPaymentId(payment: RecentTx): string {
  return payment.paymentId || payment.id || ""
}

function recentStatus(payment: RecentTx): string {
  return normalizeStoredPaymentStatus(payment.canonicalStatus || payment.status)
}

function recentRail(payment: RecentTx): string | null {
  return payment.rail || payment.network || null
}

function recentCreatedAt(payment: RecentTx): string {
  return payment.occurredAt || payment.createdAt || payment.created_at || ""
}

function recentAmount(payment: RecentTx): number {
  return payment.amountMinor != null
    ? payment.amountMinor / 100
    : Number(payment.gross_amount ?? 0)
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
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${supportStatusPillClass(status)}`}
    >
      {formatSupportStatus(status)}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${supportPriorityPillClass(priority)}`}
    >
      {formatSupportPriority(priority)}
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
  // Server-decided Shift4 operator authorization. `undefined` until
  // /api/admin/me answers, so the operator section never flashes.
  const [shift4Operator, setShift4Operator] = useState<boolean | undefined>(undefined)
  const [activeTab, setActiveTab] = useState<AdminTab>("overview")

  // ── Overview state ──────────────────────────────────────────────────────────
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loadingOverview, setLoadingOverview] = useState(true)

  // Provider onboarding state
  const [providerOnboarding, setProviderOnboarding] = useState<ProviderOnboarding[]>([])
  const [loadingProviderOnboarding, setLoadingProviderOnboarding] = useState(false)
  const [providerOnboardingLoaded, setProviderOnboardingLoaded] = useState(false)

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
  const [detailError, setDetailError] = useState<string | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  // ── Feedback state ──────────────────────────────────────────────────────────
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const [loadingFeedback, setLoadingFeedback] = useState(false)
  const [feedbackLoaded, setFeedbackLoaded] = useState(false)

  // ── Transaction detail ───────────────────────────────────────────────────────
  // Shared controller — the same fetch, model and panel every admin surface uses.
  const transactionDetail = useAdminTransactionDetail()

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

  const fetchOverview = useCallback(async (tk: string) => {
    setLoadingOverview(true)
    try {
      const res = await fetch("/api/admin/overview", {
        headers: { Authorization: `Bearer ${tk}` },
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
  }, [])

  useEffect(() => {
    if (!token) return
    void fetchOverview(token)
  }, [token, fetchOverview])

  // Ask the server whether this admin is the Shift4 sandbox operator. The
  // response is a single boolean; the configured address never reaches the
  // browser and no email comparison happens in client code.
  useEffect(() => {
    if (!token) return
    let active = true
    void (async () => {
      try {
        const res = await fetch("/api/admin/me", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        })
        const body = (await res.json().catch(() => null)) as { shift4Operator?: boolean } | null
        if (active) setShift4Operator(res.ok && body?.shift4Operator === true)
      } catch {
        // Fail closed: the section stays hidden, and its routes reject anyway.
        if (active) setShift4Operator(false)
      }
    })()
    return () => {
      active = false
    }
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
    setDetailError(null)
    setLoadingDetail(true)
    try {
      const res = await fetch(`/api/admin/support/tickets/${id}`, {
        headers: { Authorization: `Bearer ${tk}` },
      })
      if (!res.ok) {
        setDetailError("Failed to load ticket")
        toast.error("Failed to load ticket")
        return
      }
      const data = await res.json()
      setDetail({ ticket: data.ticket, messages: data.messages || [] })
    } catch {
      setDetailError("Failed to load ticket")
      toast.error("Failed to load ticket")
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  // ── Send reply ──────────────────────────────────────────────────────────────
  //
  // Throws on failure so the modal keeps the draft and renders an inline error.
  // The saved reply is appended from the server response instead of refetching,
  // so the composer clears against confirmed state.

  const sendReply = useCallback(async (message: string) => {
    if (!selectedTicketId || !token) {
      throw new Error("Sign in again to reply")
    }

    const res = await fetch(`/api/admin/support/tickets/${selectedTicketId}/reply`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    })
    const data = await res.json().catch(() => null)

    if (!res.ok) {
      throw new Error(data?.error || "Failed to send reply")
    }

    // Support replies are in-app only — there is no email warning to surface.
    toast.success("Reply sent")

    setDetail((prev) => {
      if (!prev || prev.ticket.id !== selectedTicketId) return prev
      const appended = data?.message ? [...prev.messages, data.message as Message] : prev.messages
      return {
        ticket: { ...prev.ticket, ...(data?.ticket ?? {}) },
        messages: appended,
      }
    })

    setTickets((prev) =>
      prev.map((t) =>
        t.id === selectedTicketId
          ? {
              ...t,
              status: data?.ticket?.status ?? t.status,
              last_response_at: data?.ticket?.last_response_at ?? t.last_response_at,
            }
          : t
      )
    )
  }, [selectedTicketId, token])

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
      toast.success(`Ticket marked ${formatSupportStatus(status)}`)
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
      if (statusFilter && !supportEnumEquals(t.status, statusFilter)) return false
      // Historic rows carry mixed-case priorities; compare canonically so the
      // filter cannot silently return nothing.
      if (priorityFilter && !supportEnumEquals(t.priority, priorityFilter)) return false
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
      open: tickets.filter((t) => supportEnumEquals(t.status, "open")).length,
      in_review: tickets.filter((t) => supportEnumEquals(t.status, "in_review")).length,
      waiting_on_merchant: tickets.filter((t) => supportEnumEquals(t.status, "waiting_on_merchant")).length,
      resolved: tickets.filter((t) => supportEnumEquals(t.status, "resolved")).length,
      archived: tickets.filter((t) => supportEnumEquals(t.status, "archived")).length,
    }),
    [tickets]
  )

  const closeTicket = useCallback(() => {
    setSelectedTicketId(null)
    setDetail(null)
    setDetailError(null)
  }, [])

  // ── Guards ──────────────────────────────────────────────────────────────────

  if (unauthorized) return <UnauthorizedScreen />

  const m = overview?.metrics
  const g = overview?.growth
  const monthLabel = currentMonthLabel()

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Shared admin page header ─────────────────────────────────────────── */}
      <AdminPageHeader
        title={ADMIN_TAB_TITLES[activeTab].title}
        description={ADMIN_TAB_TITLES[activeTab].description}
        lastUpdated={overview?.generatedAt ? fmtDateTime(overview.generatedAt) : null}
        metrics={
          activeTab === "overview"
            ? [
                { label: "Total Payments", value: m ? fmt(m.totalTransactions) : "—" },
                { label: "Confirmed Volume", value: m ? fmtUSD(m.totalConfirmedVolume) : "—" },
              ]
            : undefined
        }
      />

      {/* ── Tab bar ──────────────────────────────────────────────────────────────
          Refresh lives here rather than inside the hero card, on every
          breakpoint. */}
      <div className="flex flex-wrap items-center gap-1.5">
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
              closeTicket()
            }}
            className={`flex items-center gap-1.5 ${segmentedButtonClass(activeTab === tab.key)}`}
          >
            {tab.label}
            {"badge" in tab && tab.badge !== null && tab.badge > 0 && (
              <span
                className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold leading-5 ${
                  activeTab === tab.key
                    ? "bg-white/20 text-white"
                    : "bg-blue-100 text-blue-700"
                }`}
              >
                {tab.badge}
              </span>
            )}
          </button>
        ))}

        <button
          type="button"
          onClick={() => {
            if (!token) return
            void fetchOverview(token)
            if (activeTab === "support") void fetchTickets(token)
            if (activeTab === "feedback") void fetchFeedback(token)
            if (activeTab === "providers") void fetchProviderOnboarding(token)
          }}
          disabled={loadingOverview}
          aria-label="Refresh admin data"
          className={`ml-auto ${adminHeaderIconButtonDesktopClass}`}
        >
          <RefreshCw size={14} aria-hidden="true" className={loadingOverview ? "animate-spin" : ""} />
        </button>
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          OVERVIEW TAB
      ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "overview" && (
        <>
          {loadingOverview ? (
            <Spinner />
          ) : (
            <div className="space-y-5 pb-8">

              {/* Payments — All Time.
                  Total payments and confirmed volume live in the page header
                  above; this grid carries the canonical merchant-facing lifecycle
                  states and fees, tinted per docs/architecture.md. */}
              <DashboardSection title="Payments — All Time (All Modes)" titleTone="blue">
                <MetricGrid columns="four">
                  <CompactMetricTile
                    label="Confirmed"
                    value={m ? fmt(m.confirmedTransactions) : "—"}
                    tone="green"
                    detail="Completed successfully"
                  />
                  <CompactMetricTile
                    label="Processing"
                    value={m ? fmt(m.processingTransactions) : "—"}
                    tone="blue"
                    detail="Detected, awaiting confirmation"
                  />
                  <CompactMetricTile
                    label="Waiting"
                    value={m ? fmt(m.pendingTransactions) : "—"}
                    tone="blue"
                    detail="Needs customer action"
                  />
                  <CompactMetricTile
                    label="Failed"
                    value={m ? fmt(m.failedTransactions) : "—"}
                    tone="red"
                    detail="Provider or network failure"
                  />
                  <CompactMetricTile
                    label="Incomplete"
                    value={m ? fmt(m.incompleteTransactions) : "—"}
                    tone="amber"
                    detail="Ended without evidence"
                  />
                  <CompactMetricTile
                    label="Canceled"
                    value={m ? fmt(m.canceledTransactions) : "—"}
                    tone="slate"
                    detail="Explicitly canceled"
                  />
                  <CompactMetricTile
                    label="Expired"
                    value={m ? fmt(m.expiredTransactions) : "—"}
                    tone="rose"
                    detail="Timed out unpaid"
                  />
                  <CompactMetricTile
                    label="Fees Collected"
                    value={m ? fmtUSD(m.totalFeesCollected) : "—"}
                    tone="blue"
                    detail="Platform fees, all time"
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
                <div className="min-w-0 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                  {!overview?.recentTransactions.length ? (
                    <p className="px-5 py-10 text-center text-sm text-gray-400">
                      No transactions yet.
                    </p>
                  ) : (
                    <div className="min-w-0 divide-y divide-gray-100">
                      <div className="hidden grid-cols-[1fr_120px_110px_130px_100px] gap-4 bg-gray-50/60 px-5 py-2.5 sm:grid">
                        {["Payment ID", "Provider", "Rail", "Amount", "Status"].map((h) => (
                          <div
                            key={h}
                            className="text-[11px] font-semibold uppercase tracking-wider text-gray-400"
                          >
                            {h}
                          </div>
                        ))}
                      </div>
                      {overview.recentTransactions.map((tx) => {
                        const paymentId = recentPaymentId(tx)
                        const rail = recentRail(tx)
                        return (
                        <button
                          key={paymentId}
                          onClick={() => transactionDetail.open(paymentId)}
                          className="flex w-full min-w-0 items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[#0052FF]/[0.025] focus:outline-none sm:grid sm:grid-cols-[1fr_120px_110px_130px_100px] sm:gap-4 sm:px-5"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-mono text-xs text-gray-700">
                              {paymentId.slice(0, 16)}{paymentId.length > 16 ? "…" : ""}
                            </p>
                            <p className="mt-0.5 truncate text-[11px] text-gray-400">
                              {fmtDate(recentCreatedAt(tx))}
                            </p>
                          </div>
                          <div className="hidden text-sm text-gray-600 sm:block">
                            {tx.provider ? formatProviderName(tx.provider) : <span className="text-gray-300">—</span>}
                          </div>
                          {/* The recent-activity DTO carries the canonical rail,
                              so this column uses the rail vocabulary. */}
                          <div className="hidden text-sm text-gray-600 sm:block">
                            {rail ? formatRailName(rail) : <span className="text-gray-300">—</span>}
                          </div>
                          <div className="hidden text-sm font-medium text-gray-900 sm:block">
                            {tx.displayAmount || fmtUSD(recentAmount(tx))}
                          </div>
                          <div className="shrink-0">
                            <PaymentStatusBadge status={recentStatus(tx)} />
                          </div>
                        </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </DashboardSection>

              {/* Recent Tickets + Feedback.
                  Both cards are fixed-height with their own internal scroll
                  container, so neither list can stretch the dashboard as
                  activity grows — only the inside of each card scrolls.
                  `min-w-0` on each grid child stops a single long value from
                  widening the shared column track past the phone viewport. */}
              <div className="grid gap-6 lg:grid-cols-2">
                <DashboardSection
                  className="min-w-0"
                  title="Recent Tickets"
                  titleTone="blue"
                  action={
                    <button
                      onClick={() => { setActiveTab("support"); closeTicket() }}
                      className="text-xs font-medium text-[#0052FF] hover:underline"
                    >
                      View all
                    </button>
                  }
                >
                  <div className={ADMIN_RECENT_CARD_CLASS}>
                    {!overview?.recentTickets.length ? (
                      <p className="px-5 py-10 text-center text-sm text-gray-400">
                        No tickets yet.
                      </p>
                    ) : (
                      <div className={ADMIN_RECENT_SCROLL_CLASS}>
                        {overview.recentTickets.map((t) => (
                          <button
                            key={t.id}
                            onClick={() => setActiveTab("support")}
                            className="flex w-full min-w-0 items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[#0052FF]/[0.025] sm:px-5"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-gray-900">
                                {t.subject}
                              </p>
                              <p className="mt-0.5 truncate text-xs text-gray-400">
                                {t.merchant_email ?? t.merchant_business_name ?? "—"} ·{" "}
                                {fmtDate(t.created_at)}
                              </p>
                            </div>
                            <div className="flex min-w-0 shrink-0 flex-col items-end gap-1">
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
                  className="min-w-0"
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
                  <div className={ADMIN_RECENT_CARD_CLASS}>
                    {!overview?.recentFeedback.length ? (
                      <p className="px-5 py-10 text-center text-sm text-gray-400">
                        No feedback yet.
                      </p>
                    ) : (
                      <div className={ADMIN_RECENT_SCROLL_CLASS}>
                        {overview.recentFeedback.map((fb) => (
                          <div key={fb.id} className="min-w-0 px-4 py-3.5 sm:px-5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                                {formatSupportEnumLabel(fb.type)}
                              </span>
                              {fb.rating !== null && (
                                <span className="text-xs font-medium text-amber-500">
                                  {"★".repeat(fb.rating)}
                                  {"☆".repeat(5 - fb.rating)}
                                </span>
                              )}
                            </div>
                            {/* Merchant-authored text: `break-words` so a pasted
                                URL or token cannot set a min-content width the
                                card has to grow to. */}
                            <p className="mt-2 line-clamp-1 break-words text-sm text-gray-700">
                              {fb.message}
                            </p>
                            <p className="mt-1 truncate text-xs text-gray-400">
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

          {/* Internal Shift4 operator tools. Renders only for the single
              server-authorized operator; every admin else sees nothing, and the
              routes behind it enforce the same check independently. */}
          <div className="pb-8">
            <Shift4SandboxOperationsSection authorized={shift4Operator} />
          </div>
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
                <div className="flex flex-col items-center justify-center px-5 py-10 text-center">
                  <p className="text-sm font-semibold text-gray-950">No provider onboarding records</p>
                  <p className="mt-1 max-w-md text-sm text-gray-500">
                    Stripe and FluidPay setup requests appear here once a merchant starts onboarding.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {providerOnboarding.map((item) => {
                    const key = `${item.provider}:${item.merchantId}`
                    // Same formatter as every other Admin provider label, so
                    // this tab cannot name a provider differently from Reports.
                    const providerLabel = formatProviderName(item.provider)
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
                      <div key={key} className="flex min-w-0 flex-col gap-4 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
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
                          <p className="mt-1 break-all font-mono text-xs text-gray-500">Merchant: {item.merchantId}</p>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                            <span>Started: {item.setupStartedAt ? fmtDateTime(item.setupStartedAt) : "-"}</span>
                            <span>Returned: {item.setupReturnedAt ? fmtDateTime(item.setupReturnedAt) : "-"}</span>
                            <span>Updated: {item.updatedAt ? fmtDateTime(item.updatedAt) : "-"}</span>
                          </div>
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

          {/* Stat cards — shared admin metric tile, one per support status */}
          <MetricGrid columns="five">
            {SUPPORT_STAT_CONFIG.map((s) => (
              <CompactMetricTile
                key={s.key}
                label={formatSupportStatusShort(s.key)}
                value={ticketStats[s.key]}
                tone={s.tone}
                interactive
                onClick={() => setStatusFilter(statusFilter === s.key ? "" : s.key)}
              />
            ))}
          </MetricGrid>

          {/* Filters row */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <SegmentedButtons
              ariaLabel="Ticket status filter"
              value={statusFilter}
              onChange={setStatusFilter}
              options={STATUS_FILTERS.map((s) => ({ value: s.value, label: s.label }))}
            />
            <div className="flex flex-1 items-center gap-2 lg:ml-auto lg:max-w-md">
              <label htmlFor="admin-ticket-priority-filter" className="sr-only">
                Priority filter
              </label>
              <select
                id="admin-ticket-priority-filter"
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className={filterSelectClass}
              >
                <option value="">All Priorities</option>
                {PRIORITY_FILTERS.map((priority) => (
                  <option key={priority} value={priority}>
                    {formatSupportPriority(priority)}
                  </option>
                ))}
              </select>
              <div className="relative flex-1">
                <label htmlFor="admin-ticket-search" className="sr-only">
                  Search tickets
                </label>
                <Search size={14} aria-hidden="true" className={filterSearchIconClass} />
                <input
                  id="admin-ticket-search"
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search tickets…"
                  className={filterSearchInputClass}
                />
              </div>
              <button
                type="button"
                onClick={() => token && fetchTickets(token)}
                disabled={loadingTickets}
                aria-label="Refresh tickets"
                className={filterIconButtonClass}
              >
                <RefreshCw size={14} aria-hidden="true" className={loadingTickets ? "animate-spin" : ""} />
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
                    <div className="flex min-w-0 items-center gap-3 px-4 py-4 sm:grid sm:grid-cols-[1fr_190px_100px_120px_110px_28px] sm:gap-4 sm:px-5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {ticket.subject}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-gray-400">
                          {formatSupportCategory(ticket.category)}
                        </p>
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
            <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-200/80 bg-white px-5 py-10 text-center shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
              <Star size={26} aria-hidden="true" className="text-gray-300" />
              <p className="mt-3 text-sm font-semibold text-gray-950">No feedback yet</p>
              <p className="mt-1 max-w-sm text-sm text-gray-500">
                Merchant feedback will appear here once submitted.
              </p>
            </div>
          ) : (
            feedback.map((fb) => (
              <div
                key={fb.id}
                className="min-w-0 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_18px_50px_rgba(15,23,42,0.10),0_0_36px_rgba(37,99,235,0.14)] sm:p-5"
              >
                <div className="flex min-w-0 items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                        {formatSupportEnumLabel(fb.type)}
                      </span>
                      <StarRating rating={fb.rating} />
                    </div>
                    {/* Merchant-authored text: preserve line breaks, but never
                        let one long token widen the card past the viewport. */}
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm text-gray-700">
                      {fb.message}
                    </p>
                    <p className="mt-2 break-words text-xs text-gray-400">
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
          TRANSACTION DETAIL PANEL — the shared Admin component, identical to
          the one Transaction Explorer renders. No panel markup lives here.
      ════════════════════════════════════════════════════════════════════════ */}
      {transactionDetail.paymentId && (
        <AdminTransactionDetailPanel
          paymentId={transactionDetail.paymentId}
          detail={transactionDetail.detail}
          loading={transactionDetail.loading}
          error={transactionDetail.error}
          onClose={transactionDetail.close}
          footer={
            <Link
              href={`/dashboard/admin/transactions?search=${encodeURIComponent(transactionDetail.paymentId)}`}
              className="text-xs font-medium text-[#0052FF] hover:underline"
              onClick={transactionDetail.close}
            >
              Open in Transaction Explorer →
            </Link>
          }
        />
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          TICKET DETAIL PANEL (shared, available from support tab)
      ════════════════════════════════════════════════════════════════════════ */}

      {selectedTicketId && (
        <AdminSupportTicketPanel
          ticket={detail?.ticket ?? null}
          messages={detail?.messages ?? []}
          loading={loadingDetail}
          loadError={detailError}
          updatingStatus={updatingStatus}
          formatDate={fmtDate}
          formatDateTime={fmtDateTime}
          onClose={closeTicket}
          onUpdateStatus={(status) => selectedTicketId && updateStatus(selectedTicketId, status)}
          onSendReply={sendReply}
        />
      )}
    </div>
  )
}
