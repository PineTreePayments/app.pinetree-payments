"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"

// ─── Types ─────────────────────────────────────────────────────────────────────

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

type RecentTicket = {
  id: string
  subject: string
  status: string
  priority: string
  merchant_email: string | null
  merchant_business_name: string | null
  created_at: string
}

type RecentFeedback = {
  id: string
  merchant_id: string
  type: string
  message: string
  rating: number | null
  created_at: string
}

type Overview = {
  metrics: Metrics
  recentTransactions: RecentTx[]
  recentTickets: RecentTicket[]
  recentFeedback: RecentFeedback[]
  generatedAt: string
}

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

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
    </div>
  )
}

function MetricCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: "blue" | "green" | "amber" | "red" | "gray"
}) {
  const glowMap: Record<string, string> = {
    blue: "shadow-[0_0_0_1px_rgba(0,82,255,0.10),0_2px_12px_rgba(0,82,255,0.08)]",
    green: "shadow-[0_0_0_1px_rgba(16,185,129,0.10),0_2px_12px_rgba(16,185,129,0.06)]",
    amber: "shadow-[0_0_0_1px_rgba(245,158,11,0.10),0_2px_12px_rgba(245,158,11,0.06)]",
    red: "shadow-[0_0_0_1px_rgba(239,68,68,0.10),0_2px_12px_rgba(239,68,68,0.06)]",
    gray: "shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_2px_8px_rgba(0,0,0,0.04)]",
  }
  const dotMap: Record<string, string> = {
    blue: "bg-[#0052FF]",
    green: "bg-emerald-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
    gray: "bg-gray-400",
  }
  const valMap: Record<string, string> = {
    blue: "text-[#0052FF]",
    green: "text-emerald-600",
    amber: "text-amber-600",
    red: "text-red-600",
    gray: "text-gray-700",
  }

  const a = accent ?? "gray"

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-gray-100 bg-white px-5 py-4 ${glowMap[a]}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dotMap[a]}`} />
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{label}</p>
      </div>
      <p className={`text-2xl font-bold leading-none ${valMap[a]}`}>{value}</p>
      {sub && <p className="mt-1.5 text-xs text-gray-400">{sub}</p>}
    </div>
  )
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

const TICKET_STATUS_STYLE: Record<string, string> = {
  open: "bg-blue-50 text-blue-700 border-blue-200",
  in_review: "bg-amber-50 text-amber-700 border-amber-200",
  waiting_on_merchant: "bg-orange-50 text-orange-700 border-orange-200",
  resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  archived: "bg-gray-100 text-gray-500 border-gray-200",
}

const TICKET_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_review: "In Review",
  waiting_on_merchant: "Waiting",
  resolved: "Resolved",
  archived: "Archived",
}

const PRIORITY_STYLE: Record<string, string> = {
  Low: "bg-gray-100 text-gray-500 border-gray-200",
  Normal: "bg-blue-50 text-blue-600 border-blue-200",
  High: "bg-orange-50 text-orange-700 border-orange-200",
  Urgent: "bg-red-50 text-red-700 border-red-200",
}

function StatusPill({ value, styleMap, labelMap }: { value: string; styleMap: Record<string, string>; labelMap?: Record<string, string> }) {
  const cls = styleMap[value] ?? "bg-gray-100 text-gray-600 border-gray-200"
  const label = labelMap?.[value] ?? value
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}

const QUICK_LINKS = [
  { label: "Admin Support", href: "/dashboard/admin/support", desc: "Tickets & feedback" },
  { label: "Transactions", href: "/dashboard/transactions", desc: "Payment history" },
  { label: "Reports", href: "/dashboard/reports", desc: "Revenue reports" },
  { label: "Providers", href: "/dashboard/providers", desc: "Payment providers" },
]

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const router = useRouter()
  const [token, setToken] = useState("")
  const [loading, setLoading] = useState(true)
  const [unauthorized, setUnauthorized] = useState(false)
  const [overview, setOverview] = useState<Overview | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace("/login")
        return
      }
      setToken(session.access_token)
    })
  }, [router])

  useEffect(() => {
    if (!token) return
    async function load() {
      setLoading(true)
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
        setLoading(false)
      }
    }
    load()
  }, [token])

  if (unauthorized) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M12 2C9.24 2 7 4.24 7 7v2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-2V7c0-2.76-2.24-5-5-5zm0 13a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm3-8H9V7a3 3 0 1 1 6 0v2z" fill="#ef4444"/>
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-gray-900">Admin Access Required</h1>
        <p className="max-w-xs text-sm text-gray-500">
          Your account does not have admin privileges to view this page.
        </p>
        <Link
          href="/dashboard"
          className="mt-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Back to Dashboard
        </Link>
      </div>
    )
  }

  if (loading) return <Spinner />

  const m = overview?.metrics

  return (
    <div className="space-y-8">
      {/* ── Command header ─────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0052FF] to-[#003FCC] px-6 py-6 text-white shadow-[0_4px_24px_rgba(0,82,255,0.28)]">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg,#fff 0,#fff 1px,transparent 1px,transparent 40px),repeating-linear-gradient(0deg,#fff 0,#fff 1px,transparent 1px,transparent 40px)",
          }}
        />
        <div className="relative flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-200">
              PineTree Internal
            </p>
            <h1 className="mt-0.5 text-xl font-bold">Admin Overview</h1>
            <p className="mt-1 text-sm text-blue-200">
              Full platform snapshot across all merchants
            </p>
          </div>
          {overview?.generatedAt && (
            <p className="mt-3 text-xs text-blue-300 sm:mt-0 sm:text-right">
              Updated {fmtTime(overview.generatedAt)}
            </p>
          )}
        </div>
      </div>

      {/* ── Payment metrics ───────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
          Payments
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard
            label="Total Txns"
            value={m ? fmt(m.totalTransactions) : "—"}
            accent="gray"
          />
          <MetricCard
            label="Confirmed"
            value={m ? fmt(m.confirmedTransactions) : "—"}
            accent="green"
          />
          <MetricCard
            label="Pending"
            value={m ? fmt(m.pendingTransactions) : "—"}
            accent="amber"
          />
          <MetricCard
            label="Failed"
            value={m ? fmt(m.failedTransactions) : "—"}
            accent="red"
          />
          <MetricCard
            label="Confirmed Vol."
            value={m ? fmtUSD(m.totalConfirmedVolume) : "—"}
            accent="blue"
          />
          <MetricCard
            label="Fees Collected"
            value={m ? fmtUSD(m.totalFeesCollected) : "—"}
            accent="blue"
          />
        </div>
      </section>

      {/* ── Platform metrics ──────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
          Platform
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MetricCard
            label="Total Users"
            value={m ? fmt(m.totalUsers) : "—"}
            sub="All registered merchants"
            accent="blue"
          />
          <MetricCard
            label="Active Merchants"
            value={m ? fmt(m.activeMerchants) : "—"}
            sub="Status: active"
            accent="green"
          />
          <MetricCard
            label="Provider Connections"
            value={m ? fmt(m.connectedProviders) : "—"}
            sub="Connected across all merchants"
            accent="gray"
          />
        </div>
      </section>

      {/* ── Quick links ───────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
          Quick Links
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {QUICK_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group rounded-xl border border-gray-200 bg-white px-4 py-3.5 shadow-sm transition-all hover:border-[#0052FF]/30 hover:shadow-[0_0_0_1px_rgba(0,82,255,0.15),0_4px_12px_rgba(0,82,255,0.08)]"
            >
              <p className="text-sm font-semibold text-gray-900 group-hover:text-[#0052FF]">
                {link.label}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">{link.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Recent transactions ───────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
            Recent Transactions
          </h2>
          <Link
            href="/dashboard/transactions"
            className="text-xs font-medium text-[#0052FF] hover:underline"
          >
            View all
          </Link>
        </div>
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {!overview?.recentTransactions.length ? (
            <p className="px-5 py-10 text-center text-sm text-gray-400">No transactions yet.</p>
          ) : (
            <div className="divide-y divide-gray-100">
              <div className="hidden grid-cols-[1fr_130px_110px_130px_110px] gap-4 bg-gray-50 px-5 py-2.5 sm:grid">
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
                  className="flex items-center gap-3 px-5 py-3.5 sm:grid sm:grid-cols-[1fr_130px_110px_130px_110px] sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs text-gray-700">
                      {tx.id.slice(0, 18)}…
                    </p>
                    <p className="mt-0.5 text-[11px] text-gray-400">{fmtDate(tx.created_at)}</p>
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

      {/* ── Recent tickets + feedback ────────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Tickets */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
              Recent Support Tickets
            </h2>
            <Link
              href="/dashboard/admin/support"
              className="text-xs font-medium text-[#0052FF] hover:underline"
            >
              View all
            </Link>
          </div>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            {!overview?.recentTickets.length ? (
              <p className="px-5 py-10 text-center text-sm text-gray-400">No tickets yet.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {overview.recentTickets.map((t) => (
                  <Link
                    key={t.id}
                    href="/dashboard/admin/support"
                    className="flex items-start gap-3 px-5 py-3.5 hover:bg-blue-50/30 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{t.subject}</p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {t.merchant_email ?? t.merchant_business_name ?? "Unknown merchant"}
                        &nbsp;·&nbsp;{fmtDate(t.created_at)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <StatusPill value={t.status} styleMap={TICKET_STATUS_STYLE} labelMap={TICKET_STATUS_LABEL} />
                      <StatusPill value={t.priority} styleMap={PRIORITY_STYLE} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Feedback */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
              Recent Feedback
            </h2>
            <Link
              href="/dashboard/admin/support"
              className="text-xs font-medium text-[#0052FF] hover:underline"
            >
              View all
            </Link>
          </div>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            {!overview?.recentFeedback.length ? (
              <p className="px-5 py-10 text-center text-sm text-gray-400">No feedback yet.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {overview.recentFeedback.map((fb) => (
                  <div key={fb.id} className="px-5 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                            {fb.type}
                          </span>
                          {fb.rating !== null && (
                            <span className="text-xs text-amber-500 font-medium">
                              {"★".repeat(fb.rating)}{"☆".repeat(5 - fb.rating)}
                            </span>
                          )}
                        </div>
                        <p className="mt-2 line-clamp-2 text-sm text-gray-700">{fb.message}</p>
                        <p className="mt-1 text-xs text-gray-400">
                          {fb.merchant_id.slice(0, 12)}… · {fmtDate(fb.created_at)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
