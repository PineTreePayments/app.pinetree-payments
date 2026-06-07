"use client"

/**
 * Temporary local fixture — verifies every lifecycle status renders correctly.
 * Do NOT ship to production. Delete when verification is complete.
 */

import TransactionActivityTable, { type DashboardTransactionRow } from "../TransactionActivityTable"
import StatusBadge from "@/components/ui/StatusBadge"
import { getPaymentDisplayStatus } from "@/lib/utils/paymentStatus"

const ALL_STATUSES = [
  "CREATED",
  "PENDING",
  "PROCESSING",
  "CONFIRMED",
  "FAILED",
  "INCOMPLETE",
  "EXPIRED",
  "CANCELLED",
  "REFUNDED",
]

function makeTx(status: string, index: number): DashboardTransactionRow {
  return {
    id: `fixture-${status.toLowerCase()}-${index}`,
    payment_id: `pay-${status.toLowerCase()}-${index}`,
    provider: index % 3 === 0 ? "solana" : index % 3 === 1 ? "base" : "cash",
    status,
    network: index % 3 === 0 ? "solana" : index % 3 === 1 ? "base" : null,
    channel: "checkout",
    created_at: new Date(Date.now() - index * 60_000).toISOString(),
    payments: {
      id: `pay-${status.toLowerCase()}-${index}`,
      status,
      gross_amount: 10.00 + index,
      currency: "USD",
      created_at: new Date(Date.now() - index * 60_000).toISOString(),
    },
  }
}

const MOCK_TRANSACTIONS: DashboardTransactionRow[] = ALL_STATUSES.map((s, i) => makeTx(s, i))

export default function TestStatusesPage() {
  return (
    <div className="space-y-8 pb-16 px-2">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800">
        <strong>Local fixture — not in production.</strong> This page verifies all payment lifecycle status badges render correctly.
      </div>

      {/* ── 1. Shared StatusBadge component (used by merchant ledger + overview) */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
          Shared StatusBadge — all statuses (merchant ledger + overview style)
        </h2>
        <div className="flex flex-wrap gap-3 rounded-2xl border border-gray-200 bg-white p-5">
          {ALL_STATUSES.map((s) => {
            const ds = getPaymentDisplayStatus(s)
            return (
              <div key={s} className="flex flex-col items-center gap-1.5">
                <StatusBadge label={ds.status} classes={ds.classes} />
                <span className="text-[10px] text-gray-400 font-mono">{s}</span>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── 2. Admin overview / transactions — soft-filled pill (border removed) */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
          Admin pill — soft-filled, no border (fixed)
        </h2>
        <div className="flex flex-wrap gap-3 rounded-2xl border border-gray-200 bg-white p-5">
          {ALL_STATUSES.map((s) => {
            const ds = getPaymentDisplayStatus(s)
            return (
              <div key={s} className="flex flex-col items-center gap-1.5">
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ds.classes}`}>
                  {ds.status}
                </span>
                <span className="text-[10px] text-gray-400 font-mono">{s}</span>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── 3. TransactionActivityTable with all 9 statuses (merchant ledger surface) */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-3">
          Merchant transaction ledger — all 9 statuses
        </h2>
        <TransactionActivityTable
          transactions={MOCK_TRANSACTIONS}
          emptyMessage="No mock transactions."
        />
      </section>
    </div>
  )
}
