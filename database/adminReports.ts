import { supabase, supabaseAdmin } from "./supabase"
import { EXCLUDE_TEST_PAYMENTS_FILTER } from "@/lib/paymentMode"
import { metadataHasPaymentEvidence } from "@/engine/paymentEvidence"

const db = supabaseAdmin || supabase

// ─── Types ─────────────────────────────────────────────────────────────────────

export type PlatformReportPeriod = "7d" | "30d" | "month" | "quarter" | "year"
export type PlatformReportMode = "all" | "live" | "test"

export type PlatformReportMetrics = {
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
  byNetwork: Record<string, { total: number; confirmed: number; volume: number; fees: number }>
  byProvider: Record<string, { total: number; confirmed: number; volume: number; fees: number }>
  topMerchants: Array<{ merchantId: string; confirmedVolume: number; confirmedCount: number }>
  generatedAt: string
}

export const PLATFORM_REPORT_DEFAULT: PlatformReportMetrics = {
  period: "30d",
  mode: "all",
  periodStart: "",
  totalTransactions: 0,
  confirmedTransactions: 0,
  confirmedVolume: 0,
  pinetreeFees: 0,
  processingTransactions: 0,
  incompleteTransactions: 0,
  failedTransactions: 0,
  expiredTransactions: 0,
  awaitingTransactions: 0,
  byNetwork: {},
  byProvider: {},
  topMerchants: [],
  generatedAt: "",
}

// Stale payment eligibility — whether and how a row can be cleaned up
export type StaleEligibility =
  | "eligible_for_incomplete"     // CREATED > 30 min or PENDING > 60 min — state machine allows both → INCOMPLETE
  | "review_required"             // PROCESSING > 24 h — needs manual investigation, never auto-mark
  | "recent_payment_not_eligible" // Under age threshold — still active

export type StaleReasonCode =
  | "pending_no_activity_timeout"        // PENDING > 60 min, eligible for INCOMPLETE
  | "created_no_activity_timeout"        // CREATED > 30 min, eligible for INCOMPLETE (CREATED → INCOMPLETE is valid)
  | "processing_stuck_requires_review"   // PROCESSING > 24 h, needs manual investigation
  | "payment_evidence_requires_review"   // Provider/chain evidence exists; never auto-mark
  | "recent_payment_not_eligible"        // Under threshold, may still complete

export type StaleDiagnosticRow = {
  id: string
  status: string
  ageBucket: "under_15m" | "15m_1h" | "1h_24h" | "1d_7d" | "over_7d"
  network: string | null
  merchant_id: string
  payment_mode: "live" | "test"
  hasReference: boolean
  created_at: string
  gross_amount: number
  latestEventType: string | null
  latestEventAt: string | null
  eligibility: StaleEligibility
  staleReason: StaleReasonCode
}

export type StaleDiagnosticSummary = {
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

// ─── Helpers ───────────────────────────────────────────────────────────────────

function getPeriodStart(period: PlatformReportPeriod): string {
  const now = new Date()
  switch (period) {
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    case "month":
      return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    case "quarter": {
      const q = Math.floor(now.getMonth() / 3)
      return new Date(now.getFullYear(), q * 3, 1).toISOString()
    }
    case "year":
      return new Date(now.getFullYear(), 0, 1).toISOString()
  }
}

function getAgeBucket(
  createdAt: string
): "under_15m" | "15m_1h" | "1h_24h" | "1d_7d" | "over_7d" {
  const minutes = (Date.now() - new Date(createdAt).getTime()) / 60_000
  if (minutes < 15) return "under_15m"
  if (minutes < 60) return "15m_1h"
  if (minutes < 1_440) return "1h_24h"
  if (minutes < 10_080) return "1d_7d"
  return "over_7d"
}

function computeStaleEligibility(
  status: string,
  ageMinutes: number,
  hasProcessingEvidence: boolean
): { eligibility: StaleEligibility; staleReason: StaleReasonCode } {
  if (hasProcessingEvidence) {
    return { eligibility: "review_required", staleReason: "payment_evidence_requires_review" }
  }
  if (status === "PENDING" && ageMinutes >= 60) {
    return { eligibility: "eligible_for_incomplete", staleReason: "pending_no_activity_timeout" }
  }
  if (status === "CREATED" && ageMinutes >= 30) {
    // CREATED → INCOMPLETE is a valid state machine transition (validTransitions.CREATED includes INCOMPLETE).
    // The conservative 30-minute threshold here is intentional for the admin manual tool;
    // the automated cron sweep uses the tighter 5-minute threshold.
    return { eligibility: "eligible_for_incomplete", staleReason: "created_no_activity_timeout" }
  }
  if (status === "PROCESSING" && ageMinutes >= 1_440) {
    return { eligibility: "review_required", staleReason: "processing_stuck_requires_review" }
  }
  return { eligibility: "recent_payment_not_eligible", staleReason: "recent_payment_not_eligible" }
}

// ─── Platform report ───────────────────────────────────────────────────────────

/**
 * Platform-wide payment report. No merchant scope.
 * mode="live" excludes payments tagged payment_mode=test in metadata.
 * mode="test" returns only payments explicitly tagged payment_mode=test.
 * mode="all" (default) returns every payment in the period.
 */
export async function getPlatformReport(
  period: PlatformReportPeriod = "30d",
  mode: PlatformReportMode = "all"
): Promise<PlatformReportMetrics> {
  try {
    const periodStart = getPeriodStart(period)

    let q = db
      .from("payments")
      .select("id, status, gross_amount, pinetree_fee, network, provider, merchant_id, metadata")
      .gte("created_at", periodStart)

    if (mode === "live") {
      q = q.or(EXCLUDE_TEST_PAYMENTS_FILTER)
    } else if (mode === "test") {
      q = q.eq("metadata->>payment_mode", "test")
    }

    const { data, error } = await q

    if (error) {
      console.error("[admin/reports] getPlatformReport failed", error.message)
      return { ...PLATFORM_REPORT_DEFAULT, period, mode, periodStart, generatedAt: new Date().toISOString() }
    }

    const rows = (data || []) as Array<{
      id: string
      status: string | null
      gross_amount: number | string | null
      pinetree_fee: number | string | null
      network: string | null
      provider: string | null
      merchant_id: string | null
      metadata: unknown
    }>

    let confirmedTransactions = 0
    let confirmedVolume = 0
    let pinetreeFees = 0
    let processingTransactions = 0
    let incompleteTransactions = 0
    let failedTransactions = 0
    let expiredTransactions = 0
    let awaitingTransactions = 0

    const byNetwork: Record<string, { total: number; confirmed: number; volume: number; fees: number }> = {}
    const byProvider: Record<string, { total: number; confirmed: number; volume: number; fees: number }> = {}
    const merchantVolume: Record<string, { volume: number; count: number }> = {}

    for (const row of rows) {
      const status = String(row.status ?? "")
      const gross = Number(row.gross_amount ?? 0)
      const fee = Number(row.pinetree_fee ?? 0)
      const net = String(row.network ?? "unknown")
      const prov = String(row.provider ?? "unknown")
      const mid = String(row.merchant_id ?? "")

      if (!byNetwork[net]) byNetwork[net] = { total: 0, confirmed: 0, volume: 0, fees: 0 }
      byNetwork[net].total++

      if (!byProvider[prov]) byProvider[prov] = { total: 0, confirmed: 0, volume: 0, fees: 0 }
      byProvider[prov].total++

      switch (status) {
        case "CONFIRMED":
          confirmedTransactions++
          confirmedVolume += gross
          pinetreeFees += fee
          byNetwork[net].confirmed++
          byNetwork[net].volume += gross
          byNetwork[net].fees += fee
          byProvider[prov].confirmed++
          byProvider[prov].volume += gross
          byProvider[prov].fees += fee
          if (mid) {
            if (!merchantVolume[mid]) merchantVolume[mid] = { volume: 0, count: 0 }
            merchantVolume[mid].volume += gross
            merchantVolume[mid].count++
          }
          break
        case "PROCESSING":
          processingTransactions++
          break
        case "CREATED":
        case "PENDING":
          awaitingTransactions++
          break
        case "INCOMPLETE":
          incompleteTransactions++
          break
        case "FAILED":
          failedTransactions++
          break
        case "EXPIRED":
          expiredTransactions++
          break
      }
    }

    const topMerchants = Object.entries(merchantVolume)
      .map(([merchantId, v]) => ({ merchantId, confirmedVolume: v.volume, confirmedCount: v.count }))
      .sort((a, b) => b.confirmedVolume - a.confirmedVolume)
      .slice(0, 10)

    return {
      period,
      mode,
      periodStart,
      totalTransactions: rows.length,
      confirmedTransactions,
      confirmedVolume,
      pinetreeFees,
      processingTransactions,
      incompleteTransactions,
      failedTransactions,
      expiredTransactions,
      awaitingTransactions,
      byNetwork,
      byProvider,
      topMerchants,
      generatedAt: new Date().toISOString(),
    }
  } catch (err) {
    console.error("[admin/reports] getPlatformReport exception", err)
    return { ...PLATFORM_REPORT_DEFAULT, period, mode, generatedAt: new Date().toISOString() }
  }
}

// ─── Stale payment diagnostic ──────────────────────────────────────────────────

/**
 * Returns all CREATED/PENDING/PROCESSING payments with age classification,
 * eligibility for safe cleanup, and latest event data.
 * Read-only — does NOT mutate any rows.
 *
 * Eligibility rules (admin manual tool — more conservative than the 5-min automated sweep):
 *   PENDING > 60 min   → eligible_for_incomplete (PENDING → INCOMPLETE is valid per state machine)
 *   CREATED > 30 min   → eligible_for_incomplete (CREATED → INCOMPLETE is valid per state machine)
 *   PROCESSING > 24 h  → review_required (needs manual investigation; never auto-mark)
 */
export async function getAdminStaleDiagnostic(): Promise<{
  rows: StaleDiagnosticRow[]
  summary: StaleDiagnosticSummary
  generatedAt: string
}> {
  const emptySummary: StaleDiagnosticSummary = {
    totalStale: 0,
    byStatus: {},
    byAgeBucket: {},
    byNetwork: {},
    testCount: 0,
    liveCount: 0,
    untaggedCount: 0,
    oldestCreatedAt: null,
    eligibleCount: 0,
    reviewRequiredCount: 0,
  }

  try {
    const { data, error } = await db
      .from("payments")
      .select("id, status, network, merchant_id, provider_reference, metadata, created_at, gross_amount")
      .in("status", ["CREATED", "PENDING", "PROCESSING"])
      .order("created_at", { ascending: true })

    if (error) {
      console.error("[admin/reports] getAdminStaleDiagnostic failed", error.message)
      return { rows: [], summary: emptySummary, generatedAt: new Date().toISOString() }
    }

    const rawRows = (data || []) as Array<{
      id: string
      status: string
      network: string | null
      merchant_id: string
      provider_reference: string | null
      metadata: unknown
      created_at: string
      gross_amount: number | string | null
    }>

    // Fetch latest event per stale payment in one batch query
    const latestEventMap = new Map<string, { event_type: string; created_at: string }>()
    if (rawRows.length > 0) {
      const ids = rawRows.map((r) => r.id)
      const { data: evtData } = await db
        .from("payment_events")
        .select("payment_id, event_type, created_at")
        .in("payment_id", ids)
        .order("created_at", { ascending: false })
      for (const evt of (evtData || []) as Array<{ payment_id: string; event_type: string; created_at: string }>) {
        if (!latestEventMap.has(evt.payment_id)) {
          latestEventMap.set(evt.payment_id, { event_type: evt.event_type, created_at: evt.created_at })
        }
      }
    }

    let testCount = 0
    let liveCount = 0
    let untaggedCount = 0
    let eligibleCount = 0
    let reviewRequiredCount = 0
    const byStatus: Record<string, number> = {}
    const byAgeBucket: Record<string, number> = {}
    const byNetwork: Record<string, number> = {}
    let oldestCreatedAt: string | null = null

    const rows: StaleDiagnosticRow[] = rawRows.map((r) => {
      const meta = r.metadata
      let payment_mode: "live" | "test" = "live"
      if (meta && typeof meta === "object" && !Array.isArray(meta)) {
        const m = (meta as Record<string, unknown>).payment_mode
        if (m === "test") {
          payment_mode = "test"
          testCount++
        } else if (m === "live") {
          liveCount++
        } else {
          untaggedCount++
        }
      } else {
        untaggedCount++
      }

      const ageBucket = getAgeBucket(r.created_at)
      const ageMinutes = (Date.now() - new Date(r.created_at).getTime()) / 60_000
      const latestEvt = latestEventMap.get(r.id) ?? null
      const hasProcessingEvidence =
        Boolean(r.provider_reference) ||
        metadataHasPaymentEvidence(r.metadata) ||
        ["payment.processing", "payment.confirmed", "payment.failed"].includes(
          String(latestEvt?.event_type || "")
        )
      const { eligibility, staleReason } = computeStaleEligibility(
        r.status,
        ageMinutes,
        hasProcessingEvidence
      )

      byStatus[r.status] = (byStatus[r.status] || 0) + 1
      byAgeBucket[ageBucket] = (byAgeBucket[ageBucket] || 0) + 1
      const net = r.network ?? "unknown"
      byNetwork[net] = (byNetwork[net] || 0) + 1
      if (!oldestCreatedAt || r.created_at < oldestCreatedAt) oldestCreatedAt = r.created_at

      if (eligibility === "eligible_for_incomplete") eligibleCount++
      else if (eligibility === "review_required") reviewRequiredCount++

      return {
        id: r.id,
        status: r.status,
        ageBucket,
        network: r.network,
        merchant_id: r.merchant_id,
        payment_mode,
        hasReference: Boolean(r.provider_reference),
        created_at: r.created_at,
        gross_amount: Number(r.gross_amount ?? 0),
        latestEventType: latestEvt?.event_type ?? null,
        latestEventAt: latestEvt?.created_at ?? null,
        eligibility,
        staleReason,
      }
    })

    return {
      rows,
      summary: {
        totalStale: rows.length,
        byStatus,
        byAgeBucket,
        byNetwork,
        testCount,
        liveCount,
        untaggedCount,
        oldestCreatedAt,
        eligibleCount,
        reviewRequiredCount,
      },
      generatedAt: new Date().toISOString(),
    }
  } catch (err) {
    console.error("[admin/reports] getAdminStaleDiagnostic exception", err)
    return { rows: [], summary: emptySummary, generatedAt: new Date().toISOString() }
  }
}
