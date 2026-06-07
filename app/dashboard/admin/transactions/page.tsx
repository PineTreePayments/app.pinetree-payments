"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabaseClient"
import { toast } from "sonner"
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, RefreshCw, Search, X } from "lucide-react"
import {
  CompactMetricTile,
  DashboardSection,
  InsightCard,
  MetricGrid,
} from "@/components/dashboard/DashboardPrimitives"
import {
  formatDashboardProvider,
  formatDashboardNetwork,
} from "@/components/dashboard/displayHelpers"
import { getPaymentDisplayStatus } from "@/lib/utils/paymentStatus"

// ─── Types ─────────────────────────────────────────────────────────────────────

type TxRow = {
  id: string
  merchant_id: string
  status: string
  provider: string
  network: string | null
  gross_amount: number
  merchant_amount: number
  pinetree_fee: number
  currency: string
  provider_reference: string | null
  created_at: string
  updated_at: string
}

type TxSummary = {
  totalCount: number
  confirmedCount: number
  processingCount: number
  pendingCount: number
  failedCount: number
  incompleteCount: number
  expiredCount: number
  confirmedVolume: number
  totalFees: number
}

type Distribution = {
  providers: Record<string, number>
  networks: Record<string, number>
}

type TxResult = {
  rows: TxRow[]
  totalCount: number
  summary: TxSummary
  distribution: Distribution
  generatedAt: string
}

type AppliedFilters = {
  search: string
  status: string
  network: string
  provider: string
  merchantId: string
  datePreset: string
}

// Detail drawer types

type TxDetailPayment = {
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

type TxDetailEvent = {
  id: string
  event_type: string
  provider_event: string | null
  raw_payload: unknown
  created_at: string
}

type TxDetailMerchant = {
  id: string
  email: string | null
  business_name: string | null
}

type TxDetail = {
  payment: TxDetailPayment
  events: TxDetailEvent[]
  merchant: TxDetailMerchant | null
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const LIMIT = 50

const STATUSES = [
  { value: "", label: "All Statuses" },
  { value: "CONFIRMED",  label: "Confirmed" },
  { value: "PROCESSING", label: "Processing" },
  { value: "PENDING",    label: "Awaiting Customer" },
  { value: "CREATED",    label: "Created" },
  { value: "FAILED",     label: "Failed" },
  { value: "INCOMPLETE", label: "Incomplete" },
  { value: "EXPIRED",    label: "Expired" },
  { value: "CANCELLED",  label: "Cancelled" },
  { value: "REFUNDED",   label: "Refunded" },
]

const STATUS_DESCRIPTIONS: Record<string, string> = {
  CREATED:    "Created, not yet shown to customer",
  PENDING:    "Waiting for customer payment",
  PROCESSING: "In-flight on-chain",
  CONFIRMED:  "Payment complete",
  INCOMPLETE: "Customer abandoned or did not finish",
  FAILED:     "Payment failed or could not be completed",
  EXPIRED:    "Timed out",
  CANCELLED:  "Cancelled before completion",
  REFUNDED:   "Funds returned after confirmation",
}

const TERMINAL_STATUSES = new Set([
  "CONFIRMED",
  "FAILED",
  "INCOMPLETE",
  "EXPIRED",
  "CANCELLED",
  "REFUNDED",
])

const EVENT_LABELS: Record<string, string> = {
  "payment.created":    "Created",
  "payment.pending":    "Pending",
  "payment.processing": "Processing",
  "payment.confirmed":  "Confirmed",
  "payment.failed":     "Failed",
  "payment.cancelled":  "Cancelled",
  "payment.incomplete": "Incomplete",
  "payment.expired":    "Expired",
  "payment.refunded":   "Refunded",
}

const NETWORK_LABELS_DETAIL: Record<string, string> = {
  solana:            "Solana",
  base:              "Base",
  bitcoin_lightning: "Lightning",
  ethereum:          "Ethereum",
}

const NETWORKS = [
  { value: "", label: "All Networks" },
  { value: "solana",          label: "Solana" },
  { value: "base",            label: "Base" },
  { value: "ethereum",        label: "Ethereum" },
  { value: "bitcoin_lightning", label: "Lightning" },
]

const PROVIDERS = [
  { value: "", label: "All Providers" },
  { value: "solana",   label: "Solana Pay" },
  { value: "coinbase", label: "Coinbase" },
  { value: "shift4",   label: "Shift4" },
  { value: "base",     label: "Base Pay" },
  { value: "lightning", label: "Lightning" },
  { value: "cash",     label: "Cash" },
]

const DATE_PRESETS = [
  { value: "",    label: "All Time" },
  { value: "today", label: "Today" },
  { value: "7d",  label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "90d", label: "Last 90 Days" },
]

const EMPTY_FILTERS: AppliedFilters = {
  search: "", status: "", network: "", provider: "", merchantId: "", datePreset: "",
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
  if (!total) return "0%"
  return ((num / total) * 100).toFixed(1) + "%"
}

function topKey(map: Record<string, number>): string | null {
  const entries = Object.entries(map)
  if (!entries.length) return null
  return entries.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0]
}

function labelProvider(p: string | null): string {
  if (!p) return "—"
  return formatDashboardProvider(p)
}

function labelNetwork(n: string | null): string {
  if (!n) return "—"
  return formatDashboardNetwork(n)
}

function dateRangeFromPreset(preset: string): { from?: string; to?: string } {
  if (!preset) return {}
  const now = new Date()
  const to = now.toISOString()
  switch (preset) {
    case "today": {
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      return { from, to }
    }
    case "7d": {
      const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
      return { from, to }
    }
    case "30d": {
      const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
      return { from, to }
    }
    case "90d": {
      const from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString()
      return { from, to }
    }
    default:
      return {}
  }
}

function buildQueryString(filters: AppliedFilters, limit: number, offset: number): string {
  const params = new URLSearchParams()
  if (filters.status)     params.set("status",     filters.status)
  if (filters.network)    params.set("network",    filters.network)
  if (filters.provider)   params.set("provider",   filters.provider)
  if (filters.merchantId) params.set("merchantId", filters.merchantId)
  if (filters.search)     params.set("search",     filters.search)
  const { from, to } = dateRangeFromPreset(filters.datePreset)
  if (from) params.set("from", from)
  if (to)   params.set("to",   to)
  params.set("limit",  String(limit))
  params.set("offset", String(offset))
  return params.toString()
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
  const ds = getPaymentDisplayStatus(status)
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${ds.classes}`}>
      {ds.status}
    </span>
  )
}

// ─── Detail drawer helpers ─────────────────────────────────────────────────────

function extractMeta(metadata: unknown): {
  paymentMode: "live" | "test"
  merchantWallet: string | null
  pinetreeWallet: string | null
  splitContract: string | null
  asset: string | null
  strategy: string | null
} {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { paymentMode: "live", merchantWallet: null, pinetreeWallet: null, splitContract: null, asset: null, strategy: null }
  }
  const m = metadata as Record<string, unknown>
  return {
    paymentMode: m.payment_mode === "test" ? "test" : "live",
    merchantWallet: (m.merchant_wallet ?? m.merchantWallet ?? m.wallet_address ?? null) as string | null,
    pinetreeWallet: (m.pinetree_wallet ?? m.treasury_wallet ?? m.pinetreeWallet ?? m.treasuryWallet ?? null) as string | null,
    splitContract: (m.split_contract ?? m.splitContract ?? m.splitContractAddress ?? null) as string | null,
    asset: (m.asset ?? m.token ?? null) as string | null,
    strategy: (m.strategy ?? null) as string | null,
  }
}

function extractEventPayload(raw_payload: unknown): {
  adminAction: string | null
  failureReason: string | null
  txHash: string | null
} {
  if (!raw_payload || typeof raw_payload !== "object" || Array.isArray(raw_payload)) {
    return { adminAction: null, failureReason: null, txHash: null }
  }
  const p = raw_payload as Record<string, unknown>
  return {
    adminAction:   (p.adminAction   ?? p.admin_action   ?? null) as string | null,
    failureReason: (p.failureReason ?? p.failure_reason ?? p.error ?? p.reason ?? null) as string | null,
    txHash:        (p.txHash ?? p.tx_hash ?? p.signature ?? p.hash ?? null) as string | null,
  }
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  function doCopy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      onClick={doCopy}
      title="Copy"
      className="ml-1.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 hover:text-gray-700 transition-colors"
    >
      {copied ? (
        <span className="text-[10px] font-semibold text-emerald-600">✓</span>
      ) : (
        <Copy size={11} />
      )}
    </button>
  )
}

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

// ─── Select style shared ───────────────────────────────────────────────────────

const selectCls =
  "h-9 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-700 shadow-sm focus:border-[#0052FF]/40 focus:outline-none focus:ring-2 focus:ring-[#0052FF]/10"

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function AdminTransactionsPage() {
  const router = useRouter()
  const [token, setToken]           = useState("")
  const [unauthorized, setUnauthorized] = useState(false)

  // filter form state (what user is editing)
  const [search,      setSearch]      = useState("")
  const [status,      setStatus]      = useState("")
  const [network,     setNetwork]     = useState("")
  const [provider,    setProvider]    = useState("")
  const [merchantId,  setMerchantId]  = useState("")
  const [datePreset,  setDatePreset]  = useState("")

  // applied filters (what was last fetched)
  const [applied, setApplied] = useState<AppliedFilters>(EMPTY_FILTERS)
  const [offset,  setOffset]  = useState(0)

  // data
  const [result,    setResult]    = useState<TxResult | null>(null)
  const [loading,   setLoading]   = useState(true)

  // detail drawer
  const [selectedTxId,    setSelectedTxId]    = useState<string | null>(null)
  const [txDetail,        setTxDetail]        = useState<TxDetail | null>(null)
  const [loadingTxDetail, setLoadingTxDetail] = useState(false)

  const searchRef = useRef<HTMLInputElement>(null)

  // ── Auth ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace("/login"); return }
      setToken(session.access_token)
    })
  }, [router])

  // ── Fetch ───────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async (tk: string, filters: AppliedFilters, off: number) => {
    setLoading(true)
    try {
      const qs  = buildQueryString(filters, LIMIT, off)
      const res = await fetch(`/api/admin/transactions?${qs}`, {
        headers: { Authorization: `Bearer ${tk}` },
      })
      if (res.status === 403) { setUnauthorized(true); return }
      if (!res.ok) { toast.error("Failed to load transactions"); return }
      const data = (await res.json()) as TxResult
      setResult(data)
    } catch {
      toast.error("Failed to load transactions")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!token) return
    void fetchData(token, applied, offset)
  }, [token, applied, offset, fetchData])

  // ── Filter actions ──────────────────────────────────────────────────────────

  const applyFilters = useCallback(() => {
    const next: AppliedFilters = { search, status, network, provider, merchantId, datePreset }
    setApplied(next)
    setOffset(0)
  }, [search, status, network, provider, merchantId, datePreset])

  const resetFilters = useCallback(() => {
    setSearch(""); setStatus(""); setNetwork(""); setProvider("")
    setMerchantId(""); setDatePreset("")
    setApplied(EMPTY_FILTERS)
    setOffset(0)
  }, [])

  const openTxDetail = useCallback(async (id: string) => {
    setSelectedTxId(id)
    setTxDetail(null)
    setLoadingTxDetail(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return
      const res = await fetch(`/api/admin/transactions/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) {
        toast.error("Failed to load transaction detail")
        return
      }
      const data = await res.json() as TxDetail
      setTxDetail(data)
    } catch {
      toast.error("Failed to load transaction detail")
    } finally {
      setLoadingTxDetail(false)
    }
  }, [])

  // Auto-apply when dropdown fields change
  const handleDropdownChange = useCallback(
    (field: "status" | "network" | "provider" | "datePreset", value: string) => {
      let nextStatus     = status
      let nextNetwork    = network
      let nextProvider   = provider
      let nextDatePreset = datePreset
      if (field === "status")     nextStatus     = value
      if (field === "network")    nextNetwork    = value
      if (field === "provider")   nextProvider   = value
      if (field === "datePreset") nextDatePreset = value
      if (field === "status")     setStatus(value)
      if (field === "network")    setNetwork(value)
      if (field === "provider")   setProvider(value)
      if (field === "datePreset") setDatePreset(value)
      const next: AppliedFilters = {
        search, status: nextStatus, network: nextNetwork,
        provider: nextProvider, merchantId, datePreset: nextDatePreset,
      }
      setApplied(next)
      setOffset(0)
    },
    [search, status, network, provider, merchantId, datePreset]
  )

  // ── Pagination ──────────────────────────────────────────────────────────────

  const totalCount = result?.totalCount ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / LIMIT))
  const currentPage = Math.floor(offset / LIMIT) + 1
  const rangeFrom = totalCount === 0 ? 0 : offset + 1
  const rangeTo   = Math.min(offset + LIMIT, totalCount)

  // ── Derived health insights ─────────────────────────────────────────────────

  const insights = useMemo(() => {
    if (!result?.summary) return []
    const s = result.summary
    const d = result.distribution
    if (!s.totalCount) return ["No transactions match the current filters."]

    const lines: string[] = []

    const failRate = pct(s.failedCount, s.totalCount)
    const incompleteRate = pct(s.incompleteCount, s.totalCount)
    lines.push(`Failed rate: ${failRate} — Incomplete rate: ${incompleteRate}`)

    const topProvider = topKey(d.providers)
    const topNetwork  = topKey(d.networks)
    if (topProvider || topNetwork) {
      const parts: string[] = []
      if (topProvider) parts.push(`Top provider: ${labelProvider(topProvider)}`)
      if (topNetwork)  parts.push(`Top network: ${labelNetwork(topNetwork)}`)
      lines.push(parts.join(" — "))
    }

    if (s.processingCount > 0) {
      lines.push(
        `${s.processingCount} payment${s.processingCount === 1 ? "" : "s"} currently PROCESSING (in-flight on-chain)`
      )
    }

    if (s.expiredCount > 0) {
      lines.push(`${s.expiredCount} expired payment${s.expiredCount === 1 ? "" : "s"} (timed out before customer paid)`)
    }

    return lines
  }, [result])

  const hasActiveFilter =
    applied.status || applied.network || applied.provider ||
    applied.merchantId || applied.search || applied.datePreset

  // ── Guards ──────────────────────────────────────────────────────────────────

  if (unauthorized) return <UnauthorizedScreen />

  const s = result?.summary

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 pb-10">

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-[1.35rem] border border-blue-200/80 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.16),transparent_34%),linear-gradient(135deg,#ffffff_0%,#f7fbff_48%,#eef5ff_100%)] p-5 shadow-[0_18px_60px_rgba(37,99,235,0.13)] sm:p-6">
        <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-blue-300/80 to-transparent" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <Link
              href="/dashboard/admin"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              <ArrowLeft size={12} /> Admin Dashboard
            </Link>
            <div className="mt-2 flex items-center gap-2.5">
              <span className="inline-flex items-center rounded-full border border-blue-200/60 bg-blue-100/80 px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.12em] text-blue-700">
                PineTree Internal
              </span>
            </div>
            <h1 className="mt-2.5 text-2xl font-semibold text-gray-950 sm:text-3xl">
              Transaction Explorer
            </h1>
            <p className="mt-1.5 text-sm text-gray-600">
              Platform-wide payment activity — all merchants, all rails
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
            {result?.generatedAt && (
              <div className="sm:text-right">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">
                  Last Updated
                </p>
                <p className="mt-0.5 text-sm text-gray-600">
                  {fmtDateTime(result.generatedAt)}
                </p>
              </div>
            )}
            <button
              onClick={() => token && void fetchData(token, applied, offset)}
              disabled={loading}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 shadow-sm hover:bg-gray-50 disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Summary tiles ────────────────────────────────────────────────────── */}
      <DashboardSection title="Summary" titleTone="blue">
        <MetricGrid columns="three">
          <CompactMetricTile
            label="Total"
            value={s ? fmt(s.totalCount) : "—"}
          />
          <CompactMetricTile
            label="Confirmed"
            value={s ? fmt(s.confirmedCount) : "—"}
            tone="green"
            detail={s && s.totalCount ? `${pct(s.confirmedCount, s.totalCount)} of total` : undefined}
          />
          <CompactMetricTile
            label="Confirmed Volume"
            value={s ? fmtUSD(s.confirmedVolume) : "—"}
            tone="blue"
          />
          <CompactMetricTile
            label="PineTree Fees"
            value={s ? fmtUSD(s.totalFees) : "—"}
            tone="blue"
          />
          <CompactMetricTile
            label="Processing"
            value={s ? fmt(s.processingCount) : "—"}
            tone="amber"
            detail="In-flight on-chain"
          />
          <CompactMetricTile
            label="Awaiting Customer"
            value={s ? fmt(s.pendingCount) : "—"}
            detail="CREATED + PENDING"
          />
          <CompactMetricTile
            label="Failed"
            value={s ? fmt(s.failedCount) : "—"}
            tone="red"
            detail={s && s.totalCount ? `${pct(s.failedCount, s.totalCount)} rate` : undefined}
          />
          <CompactMetricTile
            label="Incomplete"
            value={s ? fmt(s.incompleteCount) : "—"}
            tone="amber"
            detail={s && s.totalCount ? `${pct(s.incompleteCount, s.totalCount)} rate` : undefined}
          />
          <CompactMetricTile
            label="Expired"
            value={s ? fmt(s.expiredCount) : "—"}
            detail="Timed out"
          />
        </MetricGrid>
      </DashboardSection>

      {/* ── Health insights ──────────────────────────────────────────────────── */}
      {insights.length > 0 && (
        <InsightCard
          title="Operational Insights"
          insights={insights}
          emptyText="No insights yet — data will appear as transactions accumulate."
        />
      )}

      {/* ── Filter bar ───────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)] sm:p-5">
        <div className="flex flex-col gap-3">
          {/* Row 1: search + merchant */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                placeholder="Search payment ID or reference…"
                className="h-9 w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm focus:border-[#0052FF]/40 focus:outline-none focus:ring-2 focus:ring-[#0052FF]/10"
              />
            </div>
            <input
              type="text"
              value={merchantId}
              onChange={(e) => setMerchantId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              placeholder="Merchant ID (UUID)…"
              className="h-9 flex-1 rounded-xl border border-gray-200 bg-white px-3 text-sm shadow-sm focus:border-[#0052FF]/40 focus:outline-none focus:ring-2 focus:ring-[#0052FF]/10 sm:max-w-[220px]"
            />
          </div>

          {/* Row 2: dropdowns + buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={status}
              onChange={(e) => handleDropdownChange("status", e.target.value)}
              className={selectCls}
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>

            <select
              value={network}
              onChange={(e) => handleDropdownChange("network", e.target.value)}
              className={selectCls}
            >
              {NETWORKS.map((n) => (
                <option key={n.value} value={n.value}>{n.label}</option>
              ))}
            </select>

            <select
              value={provider}
              onChange={(e) => handleDropdownChange("provider", e.target.value)}
              className={selectCls}
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>

            <select
              value={datePreset}
              onChange={(e) => handleDropdownChange("datePreset", e.target.value)}
              className={selectCls}
            >
              {DATE_PRESETS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>

            <button
              onClick={applyFilters}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#003FCC]"
            >
              Apply
            </button>

            {hasActiveFilter && (
              <button
                onClick={resetFilters}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-600 hover:bg-gray-50"
              >
                <X size={13} /> Reset
              </button>
            )}
          </div>

          {/* Active filter chips */}
          {hasActiveFilter && (
            <div className="flex flex-wrap gap-1.5">
              {applied.status && (
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                  Status: {applied.status}
                </span>
              )}
              {applied.network && (
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                  Network: {labelNetwork(applied.network)}
                </span>
              )}
              {applied.provider && (
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                  Provider: {labelProvider(applied.provider)}
                </span>
              )}
              {applied.datePreset && (
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                  {DATE_PRESETS.find((d) => d.value === applied.datePreset)?.label}
                </span>
              )}
              {applied.search && (
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                  Search: &ldquo;{applied.search}&rdquo;
                </span>
              )}
              {applied.merchantId && (
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                  Merchant: {applied.merchantId.slice(0, 12)}…
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      <DashboardSection
        title="Payments"
        titleTone="blue"
        action={
          !loading && (
            <span className="text-xs text-gray-400">
              {totalCount === 0
                ? "No results"
                : `${fmt(rangeFrom)}–${fmt(rangeTo)} of ${fmt(totalCount)}`}
            </span>
          )
        }
      >
        <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          {loading ? (
            <Spinner />
          ) : !result?.rows.length ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="font-medium text-gray-900">No payments found</p>
              <p className="mt-1 text-sm text-gray-500">
                {hasActiveFilter
                  ? "Try adjusting or resetting your filters."
                  : "No payment records exist yet."}
              </p>
            </div>
          ) : (
            <>
              {/* Desktop header */}
              <div className="hidden grid-cols-[140px_1fr_140px_110px_110px_100px_100px_110px] gap-3 bg-gray-50/60 px-5 py-2.5 sm:grid">
                {["Time", "Payment ID / Merchant", "Provider", "Network", "Amount", "Fee", "Status"].map(
                  (h, i) => (
                    <div
                      key={i}
                      className="text-[11px] font-semibold uppercase tracking-wider text-gray-400"
                    >
                      {h}
                    </div>
                  )
                )}
              </div>

              <div className="divide-y divide-gray-100">
                {result.rows.map((tx) => (
                  <button
                    key={tx.id}
                    onClick={() => openTxDetail(tx.id)}
                    className="w-full text-left flex flex-col gap-1.5 px-5 py-3.5 transition-colors hover:bg-[#0052FF]/[0.025] focus:outline-none sm:grid sm:grid-cols-[140px_1fr_140px_110px_110px_100px_100px_110px] sm:items-center sm:gap-3"
                  >
                    {/* Time */}
                    <div className="text-xs text-gray-500">
                      {fmtDateTime(tx.created_at)}
                    </div>

                    {/* Payment ID + Merchant */}
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs text-gray-800">
                        {tx.id.slice(0, 20)}…
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-gray-400">
                        {tx.merchant_id.slice(0, 16)}…
                      </p>
                    </div>

                    {/* Provider */}
                    <div className="hidden text-sm text-gray-700 sm:block">
                      {labelProvider(tx.provider)}
                    </div>

                    {/* Network */}
                    <div className="hidden text-sm text-gray-600 sm:block">
                      {tx.network ? labelNetwork(tx.network) : <span className="text-gray-300">—</span>}
                    </div>

                    {/* Amount */}
                    <div className="hidden text-sm font-medium text-gray-900 sm:block">
                      {fmtUSD(Number(tx.gross_amount ?? 0))}
                    </div>

                    {/* Fee */}
                    <div className="hidden text-sm text-gray-500 sm:block">
                      {Number(tx.pinetree_fee) > 0
                        ? fmtUSD(Number(tx.pinetree_fee))
                        : <span className="text-gray-300">—</span>}
                    </div>

                    {/* Mobile amount row */}
                    <div className="flex items-center justify-between sm:hidden">
                      <span className="text-sm font-medium text-gray-900">
                        {fmtUSD(Number(tx.gross_amount ?? 0))}
                      </span>
                      <StatusBadge status={tx.status} />
                    </div>

                    {/* Status (desktop) */}
                    <div className="hidden sm:block">
                      <StatusBadge status={tx.status} />
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Pagination */}
        {!loading && totalCount > LIMIT && (
          <div className="flex items-center justify-between pt-1">
            <button
              onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              disabled={currentPage === 1}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-600 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={14} /> Previous
            </button>

            <span className="text-xs text-gray-500">
              Page {fmt(currentPage)} of {fmt(totalPages)}
            </span>

            <button
              onClick={() => setOffset(offset + LIMIT)}
              disabled={currentPage >= totalPages}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-600 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        )}
      </DashboardSection>

      {/* ════════════════════════════════════════════════════════════════════════
          TRANSACTION DETAIL DRAWER
      ════════════════════════════════════════════════════════════════════════ */}
      {selectedTxId && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
            onClick={() => { setSelectedTxId(null); setTxDetail(null) }}
          />
          <div className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-2xl sm:w-[580px] lg:w-[640px]">

            {/* Panel header */}
            <div className="flex-none border-b border-gray-100 px-6 py-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">
                    Platform Transaction Detail
                  </p>
                  <div className="mt-1 flex items-center gap-1">
                    <h2 className="font-mono text-sm text-gray-800 break-all leading-snug">
                      {selectedTxId}
                    </h2>
                    <CopyButton value={selectedTxId} />
                  </div>
                </div>
                <button
                  onClick={() => { setSelectedTxId(null); setTxDetail(null) }}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
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

                {/* ── Status + amounts ─────────────────────────────────────── */}
                {(() => {
                  const meta = extractMeta(txDetail.payment.metadata)
                  const isT = TERMINAL_STATUSES.has(txDetail.payment.status)
                  return (
                    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={txDetail.payment.status} />
                        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.paymentMode === "test" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
                          {meta.paymentMode === "test" ? "Test" : "Live"}
                        </span>
                        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${isT ? "bg-gray-100 text-gray-500 border-gray-200" : "bg-blue-50 text-blue-600 border-blue-200"}`}>
                          {isT ? "Terminal" : "Non-terminal"}
                        </span>
                      </div>
                      {STATUS_DESCRIPTIONS[txDetail.payment.status] && (
                        <p className="text-xs text-gray-500">{STATUS_DESCRIPTIONS[txDetail.payment.status]}</p>
                      )}
                      <div className="grid grid-cols-3 gap-3 pt-1">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-400">Gross Total</p>
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
                          <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-gray-400">PineTree Fee</p>
                          <p className="mt-1 text-lg font-bold text-[#0052FF]">
                            {fmtUSD(Number(txDetail.payment.pinetree_fee ?? 0))}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {/* ── Core details ─────────────────────────────────────────── */}
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">Core Details</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                    <div>
                      <p className="text-gray-400">Merchant ID</p>
                      <div className="mt-0.5 flex items-start gap-1">
                        <p className="font-mono text-gray-700 break-all">{txDetail.payment.merchant_id}</p>
                        <CopyButton value={txDetail.payment.merchant_id} />
                      </div>
                    </div>
                    {txDetail.merchant && (
                      <div>
                        <p className="text-gray-400">Business / Email</p>
                        <p className="mt-0.5 text-gray-700">
                          {txDetail.merchant.business_name || txDetail.merchant.email || "—"}
                        </p>
                        {txDetail.merchant.business_name && txDetail.merchant.email && (
                          <p className="text-[11px] text-gray-400">{txDetail.merchant.email}</p>
                        )}
                      </div>
                    )}
                    <div>
                      <p className="text-gray-400">Network / Rail</p>
                      <p className="mt-0.5 text-gray-700">
                        {txDetail.payment.network
                          ? (NETWORK_LABELS_DETAIL[txDetail.payment.network] ?? txDetail.payment.network)
                          : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400">Provider</p>
                      <p className="mt-0.5 text-gray-700">{txDetail.payment.provider || "—"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Currency</p>
                      <p className="mt-0.5 text-gray-700">{txDetail.payment.currency || "USD"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Payment Mode</p>
                      <p className="mt-0.5 text-gray-700 capitalize">
                        {extractMeta(txDetail.payment.metadata).paymentMode}
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
                  </div>
                </div>

                {/* ── References ───────────────────────────────────────────── */}
                {txDetail.payment.provider_reference && (
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">Reference / Hash</p>
                    <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                      <div className="flex items-start gap-1">
                        <p className="font-mono text-[11px] text-gray-700 break-all leading-relaxed">
                          {txDetail.payment.provider_reference}
                        </p>
                        <CopyButton value={txDetail.payment.provider_reference} />
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Wallet / split ───────────────────────────────────────── */}
                {(() => {
                  const meta = extractMeta(txDetail.payment.metadata)
                  const hasWallet = meta.merchantWallet || meta.pinetreeWallet || meta.splitContract || meta.asset || meta.strategy
                  if (!hasWallet) return null
                  return (
                    <div>
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">Wallet & Routing</p>
                      <div className="space-y-2 text-xs">
                        {meta.merchantWallet && (
                          <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                            <p className="text-gray-400">Merchant Wallet</p>
                            <div className="mt-0.5 flex items-start gap-1">
                              <p className="font-mono text-[11px] text-gray-700 break-all">{meta.merchantWallet}</p>
                              <CopyButton value={meta.merchantWallet} />
                            </div>
                          </div>
                        )}
                        {meta.pinetreeWallet && (
                          <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                            <p className="text-gray-400">PineTree Treasury Wallet</p>
                            <div className="mt-0.5 flex items-start gap-1">
                              <p className="font-mono text-[11px] text-gray-700 break-all">{meta.pinetreeWallet}</p>
                              <CopyButton value={meta.pinetreeWallet} />
                            </div>
                          </div>
                        )}
                        {meta.splitContract && (
                          <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                            <p className="text-gray-400">Split Contract</p>
                            <div className="mt-0.5 flex items-start gap-1">
                              <p className="font-mono text-[11px] text-gray-700 break-all">{meta.splitContract}</p>
                              <CopyButton value={meta.splitContract} />
                            </div>
                          </div>
                        )}
                        {(meta.asset || meta.strategy) && (
                          <div className="grid grid-cols-2 gap-2">
                            {meta.asset && (
                              <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                                <p className="text-gray-400">Asset</p>
                                <p className="mt-0.5 text-gray-700">{meta.asset}</p>
                              </div>
                            )}
                            {meta.strategy && (
                              <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                                <p className="text-gray-400">Strategy</p>
                                <p className="mt-0.5 text-gray-700">{meta.strategy}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}

                {/* ── Payment timeline ─────────────────────────────────────── */}
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-gray-400">
                    Payment Timeline
                  </p>
                  {txDetail.events.length === 0 ? (
                    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                      <p className="text-xs text-gray-400">No payment events recorded.</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {txDetail.events.map((ev) => {
                        const ep = extractEventPayload(ev.raw_payload)
                        const isAdminAction = Boolean(ep.adminAction)
                        return (
                          <div
                            key={ev.id}
                            className={`rounded-xl px-3 py-2.5 ${isAdminAction ? "bg-amber-50 border border-amber-100" : "bg-gray-50"}`}
                          >
                            <div className="flex items-start gap-3">
                              <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${isAdminAction ? "bg-amber-400" : "bg-blue-400"}`} />
                              <div className="min-w-0 flex-1 text-xs">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="font-medium text-gray-800">
                                    {EVENT_LABELS[ev.event_type] ?? ev.event_type}
                                  </p>
                                  <p className="shrink-0 text-[11px] text-gray-400">
                                    {fmtDateTime(ev.created_at)}
                                  </p>
                                </div>
                                {ev.provider_event && (
                                  <p className="mt-0.5 text-[11px] text-gray-400">{ev.provider_event}</p>
                                )}
                                {ep.txHash && (
                                  <div className="mt-1 flex items-center gap-1">
                                    <p className="font-mono text-[11px] text-gray-500 truncate max-w-[240px]" title={ep.txHash}>
                                      {ep.txHash.length > 24 ? ep.txHash.slice(0, 12) + "…" + ep.txHash.slice(-8) : ep.txHash}
                                    </p>
                                    <CopyButton value={ep.txHash} />
                                  </div>
                                )}
                                {ep.failureReason && (
                                  <p className="mt-1 text-[11px] text-red-600">↳ {ep.failureReason}</p>
                                )}
                                {isAdminAction && (
                                  <p className="mt-1 text-[11px] font-medium text-amber-700">
                                    Admin action: {ep.adminAction}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* ── Audit ────────────────────────────────────────────────── */}
                {(() => {
                  const adminEvents = txDetail.events.filter((ev) => {
                    const ep = extractEventPayload(ev.raw_payload)
                    return Boolean(ep.adminAction)
                  })
                  if (!adminEvents.length) return null
                  return (
                    <div className="rounded-2xl border border-amber-200/60 bg-amber-50/50 px-4 py-3 text-xs space-y-1">
                      <p className="font-semibold text-amber-800">Admin Cleanup Detected</p>
                      {adminEvents.map((ev) => {
                        const ep = extractEventPayload(ev.raw_payload)
                        return (
                          <p key={ev.id} className="text-amber-700">
                            {EVENT_LABELS[ev.event_type] ?? ev.event_type} · {ep.adminAction}
                            {ep.failureReason ? ` — ${ep.failureReason}` : ""}
                            <span className="ml-1 text-amber-500">{fmtDateTime(ev.created_at)}</span>
                          </p>
                        )
                      })}
                    </div>
                  )
                })()}

              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-sm text-gray-400">Failed to load transaction detail.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
