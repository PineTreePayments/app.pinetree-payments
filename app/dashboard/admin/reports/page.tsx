"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"
import { ArrowLeft, RefreshCw } from "lucide-react"
import {
  DashboardSection,
} from "@/components/dashboard/DashboardPrimitives"

// ─── Types ─────────────────────────────────────────────────────────────────────

type PlatformReportPeriod = "7d" | "30d" | "month" | "quarter" | "year"
type PlatformReportMode = "all" | "live" | "test"

type ByNetworkEntry = {
  total: number
  confirmed: number
  volume: number
  fees: number
}

type PlatformReport = {
  period: PlatformReportPeriod
  mode: PlatformReportMode
  periodStart: string
  totalTransactions: number
  confirmedTransactions: number
  confirmedVolume: number
  pinetreeFees: number
  processingTransactions: number
  incompleteTransactions: number
  failedTransactions: number
  expiredTransactions: number
  awaitingTransactions: number
  byNetwork: Record<string, ByNetworkEntry>
  byProvider: Record<string, ByNetworkEntry>
  topMerchants: Array<{ merchantId: string; confirmedVolume: number; confirmedCount: number }>
  generatedAt: string
}

type StaleSummary = {
  totalStale: number
  byStatus: Record<string, number>
  byAgeBucket: Record<string, number>
  byNetwork: Record<string, number>
  testCount: number
  liveCount: number
  untaggedCount: number
  oldestCreatedAt: string | null
  eligibleCount: number
  reviewRequiredCount: number
}

type StaleEligibility = "eligible_for_incomplete" | "review_required" | "recent_payment_not_eligible"

type StaleRow = {
  id: string
  status: string
  ageBucket: string
  network: string | null
  merchant_id: string
  payment_mode: "live" | "test"
  hasReference: boolean
  created_at: string
  gross_amount: number
  latestEventType: string | null
  latestEventAt: string | null
  eligibility: StaleEligibility
  staleReason: string
}

type PreviewResult = {
  eligible: Array<{ paymentId: string; status: string; staleReason: string }>
  ineligible: Array<{ paymentId: string; status: string; staleReason: string }>
  previewOnly: boolean
}

type MarkResult = {
  changed: Array<{ paymentId: string; previousStatus: string }>
  skipped: Array<{ paymentId: string; status: string; reason: string }>
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const PERIODS: { value: PlatformReportPeriod; label: string }[] = [
  { value: "7d",      label: "Last 7 Days" },
  { value: "30d",     label: "Last 30 Days" },
  { value: "month",   label: "This Month" },
  { value: "quarter", label: "This Quarter" },
  { value: "year",    label: "This Year" },
]

const MODES: { value: PlatformReportMode; label: string }[] = [
  { value: "all",  label: "All" },
  { value: "live", label: "Live only" },
  { value: "test", label: "Test/dev only" },
]

const NETWORK_LABELS: Record<string, string> = {
  solana:           "Solana",
  base:             "Base",
  bitcoin_lightning: "Lightning",
  ethereum:         "Ethereum",
  unknown:          "Cash",
}

const PROVIDER_LABELS: Record<string, string> = {
  solana:    "Solana Pay",
  coinbase:  "Coinbase",
  shift4:    "Shift4",
  base:      "Base Pay",
  lightning: "Lightning",
  cash:      "Cash",
  unknown:   "Unknown",
}

const AGE_LABELS: Record<string, string> = {
  under_15m: "< 15 min",
  "15m_1h":  "15 min – 1 hr",
  "1h_24h":  "1 hr – 24 hr",
  "1d_7d":   "1 – 7 days",
  over_7d:   "> 7 days",
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

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function pct(num: number, total: number): string {
  if (!total) return "—"
  return ((num / total) * 100).toFixed(1) + "%"
}

function eligibilityLabel(e: StaleEligibility): string {
  if (e === "eligible_for_incomplete") return "Eligible"
  if (e === "review_required") return "Review"
  return "Recent"
}

function eligibilityClass(e: StaleEligibility): string {
  if (e === "eligible_for_incomplete") return "bg-green-50 text-green-700"
  if (e === "review_required") return "bg-amber-50 text-amber-700"
  return "bg-gray-100 text-gray-500"
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
    </div>
  )
}

function UnauthorizedScreen() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
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

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function AdminReportsPage() {
  const router = useRouter()
  const [token, setToken] = useState("")
  const [unauthorized, setUnauthorized] = useState(false)
  const [period, setPeriod] = useState<PlatformReportPeriod>("30d")
  const [mode, setMode] = useState<PlatformReportMode>("all")
  const [report, setReport] = useState<PlatformReport | null>(null)
  const [loading, setLoading] = useState(true)

  // Stale diagnostic state
  const [stale, setStale] = useState<StaleSummary | null>(null)
  const [staleRows, setStaleRows] = useState<StaleRow[]>([])
  const [loadingStale, setLoadingStale] = useState(false)
  const [staleLoaded, setStaleLoaded] = useState(false)
  const [staleStatusFilter, setStaleStatusFilter] = useState("all")
  const [staleEligibilityFilter, setStaleEligibilityFilter] = useState("all")

  // Preview state
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  // Mark incomplete state
  const [confirmText, setConfirmText] = useState("")
  const [markLoading, setMarkLoading] = useState(false)
  const [markResult, setMarkResult] = useState<MarkResult | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace("/login")
        return
      }
      setToken(session.access_token)
    })
  }, [router])

  const fetchReport = useCallback(
    async (tk: string, p: PlatformReportPeriod, m: PlatformReportMode) => {
      setLoading(true)
      try {
        const res = await fetch(
          `/api/admin/reports?period=${p}&mode=${m}`,
          { headers: { Authorization: `Bearer ${tk}` } }
        )
        if (res.status === 403) {
          setUnauthorized(true)
          return
        }
        if (!res.ok) {
          toast.error("Failed to load platform report")
          return
        }
        const data = await res.json()
        setReport(data as PlatformReport)
      } catch {
        toast.error("Failed to load platform report")
      } finally {
        setLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (!token) return
    fetchReport(token, period, mode)
  }, [token, period, mode, fetchReport])

  const fetchStale = useCallback(async (tk: string) => {
    setLoadingStale(true)
    try {
      const res = await fetch("/api/admin/stale-payments", {
        headers: { Authorization: `Bearer ${tk}` },
      })
      if (!res.ok) {
        toast.error("Failed to load stale diagnostic")
        return
      }
      const data = await res.json()
      setStale(data.summary as StaleSummary)
      setStaleRows((data.rows || []) as StaleRow[])
      setStaleLoaded(true)
      setPreviewResult(null)
      setMarkResult(null)
      setConfirmText("")
    } catch {
      toast.error("Failed to load stale diagnostic")
    } finally {
      setLoadingStale(false)
    }
  }, [])

  const runPreview = useCallback(async (tk: string, ids: string[]) => {
    setPreviewLoading(true)
    setPreviewResult(null)
    try {
      const res = await fetch("/api/admin/stale-payments/preview-mark-incomplete", {
        method: "POST",
        headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
        body: JSON.stringify({ paymentIds: ids }),
      })
      if (!res.ok) {
        toast.error("Preview failed")
        return
      }
      setPreviewResult((await res.json()) as PreviewResult)
    } catch {
      toast.error("Preview failed")
    } finally {
      setPreviewLoading(false)
    }
  }, [])

  const runMarkIncomplete = useCallback(
    async (tk: string, ids: string[]) => {
      setMarkLoading(true)
      setMarkResult(null)
      try {
        const res = await fetch("/api/admin/stale-payments/mark-incomplete", {
          method: "POST",
          headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" },
          body: JSON.stringify({ paymentIds: ids, confirm: "MARK_STALE_INCOMPLETE" }),
        })
        if (!res.ok) {
          toast.error("Mutation failed")
          return
        }
        const data = (await res.json()) as MarkResult
        setMarkResult(data)
        toast.success(
          `Marked ${data.changed.length} payment${data.changed.length !== 1 ? "s" : ""} incomplete`
        )
        fetchStale(tk)
      } catch {
        toast.error("Mutation failed")
      } finally {
        setMarkLoading(false)
      }
    },
    [fetchStale]
  )

  if (unauthorized) return <UnauthorizedScreen />

  const r = report

  // Filtered stale rows for the table
  const filteredStaleRows = staleRows
    .filter((row) => staleStatusFilter === "all" || row.status === staleStatusFilter)
    .filter((row) => staleEligibilityFilter === "all" || row.eligibility === staleEligibilityFilter)
    .slice(0, 200)

  const eligibleIds = staleRows
    .filter((row) => row.eligibility === "eligible_for_incomplete")
    .map((row) => row.id)

  return (
    <div className="space-y-5">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-[1.35rem] border border-blue-200/80 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.16),transparent_34%),linear-gradient(135deg,#ffffff_0%,#f7fbff_48%,#eef5ff_100%)] p-5 shadow-[0_18px_60px_rgba(37,99,235,0.13)] sm:p-6">
        <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-blue-300/80 to-transparent" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link
                href="/dashboard/admin"
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
              >
                <ArrowLeft size={12} />
                Admin
              </Link>
            </div>
            <span className="mt-2 inline-flex items-center rounded-full border border-blue-200/60 bg-blue-100/80 px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.12em] text-blue-700">
              Platform Reports
            </span>
            <h1 className="mt-2 text-2xl font-semibold text-gray-950 sm:text-3xl">
              Network Reporting
            </h1>
            <p className="mt-1.5 text-sm text-gray-600">
              Platform-wide payment data across all merchants. Not merchant-scoped.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {r?.generatedAt && (
              <p className="text-xs text-gray-500">{fmtDateTime(r.generatedAt)}</p>
            )}
            <button
              onClick={() => token && fetchReport(token, period, mode)}
              disabled={loading}
              title="Refresh"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 shadow-sm hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Period tabs ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto rounded-2xl border border-gray-200/80 bg-white/90 p-1 shadow-[0_2px_8px_rgba(15,23,42,0.06)] sm:w-fit [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`shrink-0 whitespace-nowrap rounded-xl px-2.5 py-1.5 text-xs font-medium transition-all sm:px-4 sm:py-2 sm:text-sm ${
                period === p.value
                  ? "bg-[#0052FF] text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5">
          {MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === m.value
                  ? "border-[#0052FF] bg-[#0052FF] text-white"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-6 pb-8">

          {/* ── Key metrics ──────────────────────────────────────────────────── */}
          <DashboardSection
            title={`Payment Volume — ${PERIODS.find((p) => p.value === period)?.label}`}
            titleTone="blue"
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4">
              <AdminStatTile label="Total"            value={r ? fmt(r.totalTransactions) : "—"} />
              <AdminStatTile label="Confirmed"        value={r ? fmt(r.confirmedTransactions) : "—"}  accent="green" />
              <AdminStatTile label="Confirmed Volume" value={r ? fmtUSD(r.confirmedVolume) : "—"}     accent="blue" />
              <AdminStatTile label="PineTree Fees"    value={r ? fmtUSD(r.pinetreeFees) : "—"}        accent="blue" />
              <AdminStatTile label="Processing"       value={r ? fmt(r.processingTransactions) : "—"} detail="In-flight on-chain" />
              <AdminStatTile label="Awaiting"         value={r ? fmt(r.awaitingTransactions) : "—"}   detail="CREATED + PENDING" />
              <AdminStatTile label="Incomplete"       value={r ? fmt(r.incompleteTransactions) : "—"} detail="Customer abandoned" />
              <AdminStatTile label="Failed"           value={r ? fmt(r.failedTransactions) : "—"}     accent="red" />
              <AdminStatTile label="Expired"          value={r ? fmt(r.expiredTransactions) : "—"} />
            </div>
          </DashboardSection>

          {/* ── Mode notice ──────────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-amber-200/60 bg-amber-50/60 px-5 py-4">
            <p className="text-sm font-medium text-amber-800">Data mode: {mode === "all" ? "All modes (live + test + untagged)" : mode === "live" ? "Live only — excludes metadata.payment_mode=test" : "Test/dev only — payments tagged metadata.payment_mode=test"}</p>
            <p className="mt-1 text-xs text-amber-700">
              The global admin overview always shows all modes. Run the Stale Diagnostic below to see the test/live breakdown of historical rows.
            </p>
          </div>

          {/* ── By network ───────────────────────────────────────────────────── */}
          {r && Object.keys(r.byNetwork).length > 0 && (
            <DashboardSection title="Volume by Rail" titleTone="blue">
              <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                <div className="hidden grid-cols-[1fr_90px_90px_110px_100px_80px] gap-4 bg-gray-50/60 px-5 py-2.5 sm:grid">
                  {["Rail", "Total", "Confirmed", "Volume", "Fees", "Conv %"].map((h) => (
                    <div key={h} className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                      {h}
                    </div>
                  ))}
                </div>
                <div className="divide-y divide-gray-100">
                  {Object.entries(r.byNetwork)
                    .sort((a, b) => b[1].volume - a[1].volume)
                    .map(([net, v]) => (
                      <div
                        key={net}
                        className="grid grid-cols-[1fr_90px_90px_110px_100px_80px] gap-4 px-5 py-3"
                      >
                        <div className="text-sm font-medium text-gray-900">
                          {NETWORK_LABELS[net] ?? net}
                        </div>
                        <div className="text-sm text-gray-600">{fmt(v.total)}</div>
                        <div className="text-sm text-gray-600">{fmt(v.confirmed)}</div>
                        <div className="text-sm font-medium text-gray-900">{fmtUSD(v.volume)}</div>
                        <div className="text-sm text-gray-600">{fmtUSD(v.fees)}</div>
                        <div className="text-sm text-gray-500">{pct(v.confirmed, v.total)}</div>
                      </div>
                    ))}
                </div>
              </div>
            </DashboardSection>
          )}

          {/* ── By provider ──────────────────────────────────────────────────── */}
          {r && Object.keys(r.byProvider ?? {}).length > 0 && (
            <DashboardSection title="Volume by Provider" titleTone="blue">
              <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                <div className="hidden grid-cols-[1fr_90px_90px_110px_100px_80px] gap-4 bg-gray-50/60 px-5 py-2.5 sm:grid">
                  {["Provider", "Total", "Confirmed", "Volume", "Fees", "Conv %"].map((h) => (
                    <div key={h} className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                      {h}
                    </div>
                  ))}
                </div>
                <div className="divide-y divide-gray-100">
                  {Object.entries(r.byProvider)
                    .sort((a, b) => b[1].volume - a[1].volume)
                    .map(([prov, v]) => (
                      <div
                        key={prov}
                        className="grid grid-cols-[1fr_90px_90px_110px_100px_80px] gap-4 px-5 py-3"
                      >
                        <div className="text-sm font-medium text-gray-900">
                          {PROVIDER_LABELS[prov] ?? prov}
                        </div>
                        <div className="text-sm text-gray-600">{fmt(v.total)}</div>
                        <div className="text-sm text-gray-600">{fmt(v.confirmed)}</div>
                        <div className="text-sm font-medium text-gray-900">{fmtUSD(v.volume)}</div>
                        <div className="text-sm text-gray-600">{fmtUSD(v.fees)}</div>
                        <div className="text-sm text-gray-500">{pct(v.confirmed, v.total)}</div>
                      </div>
                    ))}
                </div>
              </div>
            </DashboardSection>
          )}

          {/* ── Top merchants ─────────────────────────────────────────────────── */}
          {r && r.topMerchants.length > 0 && (
            <DashboardSection title="Top Merchants by Volume" titleTone="blue">
              <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                <div className="hidden grid-cols-[1fr_100px_120px] gap-4 bg-gray-50/60 px-5 py-2.5 sm:grid">
                  {["Merchant ID", "Confirmed", "Volume"].map((h) => (
                    <div key={h} className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                      {h}
                    </div>
                  ))}
                </div>
                <div className="divide-y divide-gray-100">
                  {r.topMerchants.map((m, i) => (
                    <div
                      key={m.merchantId}
                      className="grid grid-cols-[1fr_100px_120px] gap-4 px-5 py-3"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[11px] font-bold text-gray-400 tabular-nums w-5 shrink-0">
                          {i + 1}
                        </span>
                        <span className="truncate font-mono text-xs text-gray-700">{m.merchantId}</span>
                      </div>
                      <div className="text-sm text-gray-600">{fmt(m.confirmedCount)}</div>
                      <div className="text-sm font-semibold text-gray-900">{fmtUSD(m.confirmedVolume)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </DashboardSection>
          )}

          {/* ── Stale payment diagnostic ──────────────────────────────────────── */}
          <DashboardSection title="Stale Payment Diagnostic" titleTone="blue">
            <div className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] space-y-4">
              <p className="text-sm text-gray-600">
                Shows all payments in CREATED, PENDING, or PROCESSING status with age classification and
                cleanup eligibility. PENDING &gt; 60 min are eligible for safe bulk marking as INCOMPLETE
                via the state machine. CREATED and PROCESSING rows require manual review.
              </p>

              {/* Run / refresh button */}
              <button
                onClick={() => token && fetchStale(token)}
                disabled={loadingStale}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCw size={13} className={loadingStale ? "animate-spin" : ""} />
                {loadingStale ? "Running…" : staleLoaded ? "Refresh" : "Run Diagnostic"}
              </button>

              {staleLoaded && stale && (
                <div className="space-y-4">

                  {/* Summary tiles */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: "Total Stale", value: fmt(stale.totalStale),                     amber: true },
                      { label: "CREATED",     value: fmt(stale.byStatus.CREATED ?? 0),          amber: false },
                      { label: "PENDING",     value: fmt(stale.byStatus.PENDING ?? 0),          amber: false },
                      { label: "PROCESSING",  value: fmt(stale.byStatus.PROCESSING ?? 0),       amber: true },
                    ].map((s) => (
                      <div key={s.label} className="min-w-0 rounded-2xl bg-[#0f1728] border border-[#1e2c47] shadow-[0_8px_28px_rgba(0,0,0,0.30)] p-3.5">
                        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.13em] text-slate-400">
                          {s.label}
                        </p>
                        <p className={`mt-1.5 text-xl font-semibold ${s.amber ? "text-amber-400" : "text-white"}`}>
                          {s.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Eligibility summary */}
                  <div className="flex gap-3">
                    <div className="flex-1 min-w-0 rounded-2xl bg-[#091c14] border border-emerald-900/45 shadow-[0_8px_28px_rgba(0,0,0,0.34)] p-3.5">
                      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.13em] text-emerald-400">
                        Eligible for Incomplete
                      </p>
                      <p className="mt-1.5 text-xl font-semibold text-white">
                        {fmt(stale.eligibleCount ?? 0)}
                      </p>
                      <p className="mt-1 text-[11px] text-emerald-600/80">PENDING &gt; 60 min</p>
                    </div>
                    <div className="flex-1 min-w-0 rounded-2xl bg-[#1e1600] border border-amber-900/40 shadow-[0_8px_28px_rgba(0,0,0,0.34)] p-3.5">
                      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.13em] text-amber-400">
                        Review Required
                      </p>
                      <p className="mt-1.5 text-xl font-semibold text-white">
                        {fmt(stale.reviewRequiredCount ?? 0)}
                      </p>
                      <p className="mt-1 text-[11px] text-amber-600/80">CREATED &gt; 30 min · PROCESSING &gt; 24 h</p>
                    </div>
                  </div>

                  {/* Age + Mode breakdown */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
                        By Age
                      </p>
                      <div className="space-y-1">
                        {(["under_15m", "15m_1h", "1h_24h", "1d_7d", "over_7d"] as const).map((b) => (
                          <div key={b} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                            <span className="text-gray-600">{AGE_LABELS[b]}</span>
                            <span className="font-semibold text-gray-900">{fmt(stale.byAgeBucket[b] ?? 0)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
                        Payment Mode
                      </p>
                      <div className="space-y-1">
                        {[
                          { label: "Tagged test", value: fmt(stale.testCount), tone: "amber" },
                          { label: "Tagged live", value: fmt(stale.liveCount), tone: "green" },
                          { label: "Untagged (legacy)", value: fmt(stale.untaggedCount), tone: "gray" },
                        ].map((row) => (
                          <div key={row.label} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                            <span className="text-gray-600">{row.label}</span>
                            <span className={`font-semibold ${row.tone === "amber" ? "text-amber-600" : row.tone === "green" ? "text-emerald-600" : "text-gray-500"}`}>
                              {row.value}
                            </span>
                          </div>
                        ))}
                      </div>
                      {stale.oldestCreatedAt && (
                        <p className="mt-3 text-xs text-gray-400">
                          Oldest row: {fmtDateTime(stale.oldestCreatedAt)}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Row-level table */}
                  {staleRows.length > 0 && (
                    <div className="space-y-3">

                      {/* Filters */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mr-1">
                          Status:
                        </span>
                        {["all", "CREATED", "PENDING", "PROCESSING"].map((s) => (
                          <button
                            key={s}
                            onClick={() => setStaleStatusFilter(s)}
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                              staleStatusFilter === s
                                ? "border-gray-700 bg-gray-800 text-white"
                                : "border-gray-200 text-gray-500 hover:border-gray-300"
                            }`}
                          >
                            {s === "all" ? "All" : s}
                          </button>
                        ))}
                        <span className="mx-1 text-gray-200 select-none">|</span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mr-1">
                          Eligibility:
                        </span>
                        {[
                          { v: "all", l: "All" },
                          { v: "eligible_for_incomplete", l: "Eligible" },
                          { v: "review_required", l: "Review Reqd" },
                          { v: "recent_payment_not_eligible", l: "Recent" },
                        ].map(({ v, l }) => (
                          <button
                            key={v}
                            onClick={() => setStaleEligibilityFilter(v)}
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                              staleEligibilityFilter === v
                                ? "border-[#0052FF] bg-[#0052FF] text-white"
                                : "border-gray-200 text-gray-500 hover:border-gray-300"
                            }`}
                          >
                            {l}
                          </button>
                        ))}
                      </div>

                      {/* Table */}
                      <div className="overflow-x-auto rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                        <table className="w-full min-w-[760px] text-xs">
                          <thead>
                            <tr className="border-b border-gray-100 bg-gray-50/60">
                              {["ID", "Status", "Network", "Amount", "Mode", "Age", "Latest Event", "Eligibility"].map((h) => (
                                <th
                                  key={h}
                                  className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400"
                                >
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {filteredStaleRows.length === 0 ? (
                              <tr>
                                <td colSpan={8} className="px-4 py-6 text-center text-sm text-gray-400">
                                  No rows match the current filter.
                                </td>
                              </tr>
                            ) : (
                              filteredStaleRows.map((row) => (
                                <tr key={row.id} className="hover:bg-gray-50/50">
                                  <td className="px-4 py-2.5">
                                    <span className="font-mono text-[11px] text-gray-500" title={row.id}>
                                      {row.id.slice(0, 8)}…
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                      row.status === "PROCESSING"
                                        ? "bg-amber-50 text-amber-700"
                                        : row.status === "PENDING"
                                        ? "bg-blue-50 text-blue-700"
                                        : "bg-gray-100 text-gray-600"
                                    }`}>
                                      {row.status}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-gray-500">
                                    {row.network ? (NETWORK_LABELS[row.network] ?? row.network) : "—"}
                                  </td>
                                  <td className="px-4 py-2.5 font-medium text-gray-700">
                                    {fmtUSD(row.gross_amount)}
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                      row.payment_mode === "test"
                                        ? "bg-amber-50 text-amber-600"
                                        : "bg-emerald-50 text-emerald-700"
                                    }`}>
                                      {row.payment_mode}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-gray-400">
                                    {AGE_LABELS[row.ageBucket] ?? row.ageBucket}
                                  </td>
                                  <td className="px-4 py-2.5 text-gray-400 max-w-[140px] truncate" title={row.latestEventType ?? ""}>
                                    {row.latestEventType ?? "none"}
                                  </td>
                                  <td className="px-4 py-2.5">
                                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${eligibilityClass(row.eligibility)}`}>
                                      {eligibilityLabel(row.eligibility)}
                                    </span>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                        {filteredStaleRows.length === 200 && staleRows.length > 200 && (
                          <p className="px-4 py-2 text-center text-[11px] text-gray-400 border-t border-gray-100">
                            Showing first 200 rows. Use filters to narrow down.
                          </p>
                        )}
                      </div>

                      {/* Safe cleanup action */}
                      {(stale.eligibleCount ?? 0) > 0 && (
                        <div className="rounded-2xl border border-green-200/60 bg-green-50/40 p-5 space-y-4">
                          <div>
                            <p className="text-sm font-semibold text-green-800">
                              Safe Cleanup: Mark Stale PENDING Payments Incomplete
                            </p>
                            <p className="mt-1 text-xs text-green-700">
                              {fmt(stale.eligibleCount)} PENDING payment{stale.eligibleCount !== 1 ? "s" : ""} older than 60 minutes
                              can be safely marked INCOMPLETE via the state machine (PENDING → INCOMPLETE is a valid transition).
                              This fires the <code className="rounded bg-green-100 px-1 font-mono text-[11px]">payment.incomplete</code> webhook to each merchant.
                              CREATED and PROCESSING rows are never touched by this action.
                            </p>
                          </div>

                          {!markResult ? (
                            <div className="space-y-3">
                              {/* Preview */}
                              <div>
                                <button
                                  onClick={() => token && runPreview(token, eligibleIds)}
                                  disabled={previewLoading || eligibleIds.length === 0}
                                  className="inline-flex items-center gap-2 rounded-xl border border-green-300 bg-white px-4 py-2 text-sm font-medium text-green-700 shadow-sm hover:bg-green-50 disabled:opacity-50"
                                >
                                  <RefreshCw size={12} className={previewLoading ? "animate-spin" : ""} />
                                  {previewLoading ? "Previewing…" : `Preview ${fmt(eligibleIds.length)} eligible rows`}
                                </button>
                              </div>

                              {previewResult && (
                                <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
                                  <p className="text-xs font-semibold text-gray-700">Preview result — no mutations applied</p>
                                  <p className="text-xs text-gray-600">
                                    Eligible:{" "}
                                    <span className="font-semibold text-green-700">{previewResult.eligible.length}</span>
                                    {" · "}
                                    Ineligible:{" "}
                                    <span className="font-semibold text-amber-700">{previewResult.ineligible.length}</span>
                                  </p>
                                  {previewResult.ineligible.length > 0 && (
                                    <div className="max-h-28 overflow-y-auto space-y-1 rounded-lg bg-gray-50 p-2">
                                      {previewResult.ineligible.map((item) => (
                                        <p key={item.paymentId} className="font-mono text-[11px] text-gray-500">
                                          {item.paymentId.slice(0, 8)}… — {item.staleReason}
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Confirmation + mutation */}
                              <div className="space-y-2 pt-1">
                                <p className="text-xs font-medium text-gray-700">
                                  Type{" "}
                                  <code className="rounded bg-gray-100 px-1 font-mono text-[11px]">
                                    MARK_STALE_INCOMPLETE
                                  </code>{" "}
                                  to enable the mutation button:
                                </p>
                                <input
                                  type="text"
                                  value={confirmText}
                                  onChange={(e) => setConfirmText(e.target.value)}
                                  placeholder="MARK_STALE_INCOMPLETE"
                                  className="w-full max-w-xs rounded-xl border border-gray-300 bg-white px-3 py-2 font-mono text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                />
                                <button
                                  onClick={() => token && runMarkIncomplete(token, eligibleIds)}
                                  disabled={
                                    markLoading ||
                                    confirmText !== "MARK_STALE_INCOMPLETE" ||
                                    eligibleIds.length === 0
                                  }
                                  className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  {markLoading
                                    ? "Marking…"
                                    : `Mark ${fmt(stale.eligibleCount)} Payment${stale.eligibleCount !== 1 ? "s" : ""} Incomplete`}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
                              <p className="text-sm font-semibold text-gray-800">Mutation complete</p>
                              <p className="text-xs text-gray-600">
                                Changed:{" "}
                                <span className="font-semibold text-green-700">{markResult.changed.length}</span>
                                {" · "}
                                Skipped:{" "}
                                <span className="font-semibold text-amber-700">{markResult.skipped.length}</span>
                              </p>
                              {markResult.skipped.length > 0 && (
                                <div className="max-h-28 overflow-y-auto space-y-1 rounded-lg bg-gray-50 p-2">
                                  {markResult.skipped.map((item) => (
                                    <p key={item.paymentId} className="font-mono text-[11px] text-gray-500">
                                      {item.paymentId.slice(0, 8)}… — {item.reason}
                                    </p>
                                  ))}
                                </div>
                              )}
                              <button
                                onClick={() => {
                                  setMarkResult(null)
                                  setConfirmText("")
                                  setPreviewResult(null)
                                }}
                                className="text-xs text-blue-600 hover:underline"
                              >
                                Reset
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Admin overview filter recommendation (Task 7) — always visible */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-3">
                <p className="text-xs font-semibold text-blue-700">
                  Admin Overview Filter Recommendation
                </p>
                <p className="mt-1 text-xs text-blue-600">
                  The admin overview currently counts all payment modes (live + test + untagged) with no filter.
                  To add mode filtering: (1) add a <code className="rounded bg-blue-100 px-1 font-mono text-[11px]">mode</code> parameter
                  to <code className="rounded bg-blue-100 px-1 font-mono text-[11px]">getAdminPaymentMetrics()</code> in{" "}
                  <code className="rounded bg-blue-100 px-1 font-mono text-[11px]">database/adminOverview.ts</code>;
                  (2) apply <code className="rounded bg-blue-100 px-1 font-mono text-[11px]">EXCLUDE_TEST_PAYMENTS_FILTER</code> via{" "}
                  <code className="rounded bg-blue-100 px-1 font-mono text-[11px]">.or()</code> for live mode;
                  (3) add mode toggle pills to the admin overview header. Estimated: ~30 lines, no schema migration needed.
                </p>
              </div>
            </div>
          </DashboardSection>

        </div>
      )}
    </div>
  )
}

type AdminAccent = "blue" | "green" | "red" | "neutral"

function AdminStatTile({ label, value, detail, accent = "neutral" }: {
  label: string
  value: string
  detail?: string
  accent?: AdminAccent
}) {
  const surface: Record<AdminAccent, string> = {
    blue:    "bg-[#0c1a35] border border-blue-900/50 shadow-[0_8px_28px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(59,130,246,0.08)]",
    green:   "bg-[#091c14] border border-emerald-900/45 shadow-[0_8px_28px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(16,185,129,0.07)]",
    red:     "bg-[#1b0b0d] border border-red-900/40 shadow-[0_8px_28px_rgba(0,0,0,0.34)]",
    neutral: "bg-[#0f1728] border border-[#1e2c47] shadow-[0_8px_28px_rgba(0,0,0,0.30)]",
  }
  const labelCls: Record<AdminAccent, string> = {
    blue:    "text-blue-400",
    green:   "text-emerald-400",
    red:     "text-red-400",
    neutral: "text-slate-400",
  }
  return (
    <div className={`min-w-0 rounded-2xl p-3.5 sm:p-4 ${surface[accent]}`}>
      <p className={`truncate text-[10px] font-semibold uppercase tracking-[0.13em] ${labelCls[accent]}`}>
        {label}
      </p>
      <div className="mt-1.5 min-w-0 text-xl font-semibold leading-tight text-white sm:text-2xl">
        {value}
      </div>
      {detail && (
        <p className="mt-1 truncate text-[10px] text-slate-500">{detail}</p>
      )}
    </div>
  )
}
