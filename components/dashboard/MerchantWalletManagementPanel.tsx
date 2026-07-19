"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, RefreshCw, X } from "lucide-react"
import Card from "@/components/ui/Card"
import Button from "@/components/ui/Button"
import StatusBadge from "@/components/ui/StatusBadge"

// ---------------------------------------------------------------------------
// Normalized PineTree wallet types (mirrors engine/wallet/walletTypes.ts).
// This component never imports anything provider-specific and never calls
// anything under a provider-branded path - only the generic, authenticated
// PineTree wallet routes below.
// ---------------------------------------------------------------------------

type WalletApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } }

type PineTreeWalletCapabilities = {
  balances: boolean
  activity: boolean
  withdrawals: boolean
  payouts: boolean
  swaps: boolean
  automaticPayouts: boolean
  automaticConversion: boolean
}

type CapabilitiesData = {
  provider: string | null
  providerDisplayName: string | null
  configured: boolean
  ready: boolean
  capabilities: PineTreeWalletCapabilities
}

type PineTreeWalletBalance = {
  asset: string
  availableBaseUnits: string
  pendingBaseUnits: string | null
  totalBaseUnits: string | null
  decimals: number
  network: string | null
  providerUpdatedAt: string | null
  cachedAt: string | null
  stale: boolean
}

type BalancesData = {
  capabilityAvailable: boolean
  unavailableReason: string | null
  syncStatus: "live" | "cached" | "unavailable"
  lastSuccessfulSyncAt: string | null
  balances: PineTreeWalletBalance[]
}

type WalletOperation = {
  id: string
  operationType: string
  direction: "credit" | "debit"
  status: string
  asset: string
  amountBaseUnits: string
  feeBaseUnits: string | null
  destinationSummary: string | null
  txHash: string | null
  explorerUrl: string | null
  failureReason: string | null
  createdAt: string
}

type ActivityData = { operations: WalletOperation[]; nextCursor: string | null }

const CAPABILITY_LABELS: Record<keyof PineTreeWalletCapabilities, string> = {
  balances: "Balances",
  activity: "Activity",
  withdrawals: "Withdrawals",
  payouts: "Payouts",
  swaps: "Swaps",
  automaticPayouts: "Automatic payouts",
  automaticConversion: "Automatic conversion",
}

async function callWalletApi<T>(
  path: string,
  accessToken: string | null,
  init?: RequestInit
): Promise<WalletApiResponse<T>> {
  if (!accessToken) {
    return { ok: false, error: { code: "UNAUTHORIZED", message: "Sign in to manage your wallet.", retryable: false } }
  }
  try {
    const res = await fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      credentials: "include",
      cache: "no-store",
    })
    const json = (await res.json().catch(() => null)) as WalletApiResponse<T> | null
    if (!json) {
      return { ok: false, error: { code: "INTERNAL_ERROR", message: "Unexpected response from server.", retryable: true } }
    }
    return json
  } catch {
    return { ok: false, error: { code: "INTERNAL_ERROR", message: "Network error. Please try again.", retryable: true } }
  }
}

function formatAmount(baseUnits: string, decimals: number, asset: string) {
  if (decimals <= 0) return `${baseUnits} ${asset}`
  const value = BigInt(baseUnits)
  const divisor = BigInt(10) ** BigInt(decimals)
  const whole = value / divisor
  const fraction = (value % divisor).toString().padStart(decimals, "0").replace(/0+$/, "")
  return `${fraction ? `${whole}.${fraction}` : whole.toString()} ${asset}`
}

function operationTypeLabel(type: string) {
  return type
    .toLowerCase()
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ")
}

// ---------------------------------------------------------------------------
// Dialog shell
// ---------------------------------------------------------------------------

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export default function MerchantWalletManagementPanel({ accessToken }: { accessToken: string | null }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [capabilities, setCapabilities] = useState<CapabilitiesData | null>(null)
  const [balances, setBalances] = useState<BalancesData | null>(null)
  const [activity, setActivity] = useState<ActivityData | null>(null)
  const [notConfigured, setNotConfigured] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [activeDialog, setActiveDialog] = useState<"withdraw" | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotConfigured(false)

    const capRes = await callWalletApi<CapabilitiesData>("/api/wallets/capabilities", accessToken)
    if (!capRes.ok) {
      setError(capRes.error.message)
      setLoading(false)
      return
    }
    setCapabilities(capRes.data)

    if (!capRes.data.configured || !capRes.data.ready) {
      setNotConfigured(true)
      setLoading(false)
      return
    }

    const [balRes, actRes] = await Promise.all([
      callWalletApi<BalancesData>("/api/wallets/balances", accessToken),
      callWalletApi<ActivityData>("/api/wallets/activity", accessToken),
    ])

    if (balRes.ok) setBalances(balRes.data)
    else setError(balRes.error.message)

    if (actRes.ok) setActivity(actRes.data)

    setLoading(false)
  }, [accessToken])

  useEffect(() => {
    // Deferred so load()'s synchronous setState calls never run inline
    // within the effect body itself (avoids a same-tick cascading render).
    const timer = setTimeout(() => void load(), 0)
    return () => clearTimeout(timer)
  }, [load])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 className="animate-spin" size={22} />
      </div>
    )
  }

  if (notConfigured) {
    return (
      <Card className="text-center">
        <p className="text-sm font-semibold text-gray-900">Wallet not connected</p>
        <p className="mt-1 text-sm text-gray-500">
          Finish setting up your Bitcoin/Lightning wallet to manage it here.
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">Bitcoin Lightning</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <CapabilitySummary capabilities={capabilities} />

      <BalancesCard balances={balances} />

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={!capabilities?.capabilities.withdrawals}
          onClick={() => setActiveDialog("withdraw")}
        >
          Withdraw
        </Button>
      </div>

      <ActivityCard activity={activity} />

      <PreferencesCard />

      {activeDialog === "withdraw" ? (
        <SendDialog
          capabilityAvailable={Boolean(capabilities?.capabilities.withdrawals)}
          accessToken={accessToken}
          onClose={() => setActiveDialog(null)}
          onSubmitted={() => {
            setActiveDialog(null)
            void refresh()
          }}
        />
      ) : null}

    </div>
  )
}

function CapabilitySummary({ capabilities }: { capabilities: CapabilitiesData | null }) {
  if (!capabilities) return null
  return (
    <Card className="!p-4">
      <p className="mb-2 text-xs font-semibold text-gray-500">Capabilities</p>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(CAPABILITY_LABELS) as Array<keyof PineTreeWalletCapabilities>).map((key) => {
          const available = Boolean(capabilities.capabilities[key])
          return (
            <span
              key={key}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                available ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
              }`}
            >
              {CAPABILITY_LABELS[key]}: {available ? "Available" : "Not yet available"}
            </span>
          )
        })}
      </div>
      {!capabilities.capabilities.balances ? (
        <p className="mt-2 text-xs text-gray-400">
          Some wallet operations are not yet enabled by your connected provider. PineTree will enable them
          automatically once available - no action is needed from you.
        </p>
      ) : null}
    </Card>
  )
}

function BalancesCard({ balances }: { balances: BalancesData | null }) {
  const hasCachedBalance = Boolean(balances?.balances.length)
  const hasStaleBalance = Boolean(balances?.balances.some((balance) => balance.stale))
  const syncLabel = balances?.syncStatus === "live"
    ? "Synced"
    : balances?.syncStatus === "cached"
      ? hasStaleBalance ? "Stale" : "Cached"
      : "Unavailable"
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Balances</p>
        <div className="text-right">
          {balances ? <p className={`text-xs font-semibold ${syncLabel === "Synced" ? "text-green-700" : syncLabel === "Unavailable" ? "text-gray-500" : "text-amber-700"}`}>{syncLabel}</p> : null}
          {balances?.lastSuccessfulSyncAt ? <p className="text-xs text-gray-400">Provider sync {new Date(balances.lastSuccessfulSyncAt).toLocaleString()}</p> : null}
        </div>
      </div>
      {!balances ? (
        <p className="text-sm text-gray-500">Loading balance…</p>
      ) : !balances.capabilityAvailable && !hasCachedBalance ? (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Live balance reading is not currently available for this wallet. This will appear automatically once
          available.
        </div>
      ) : balances.balances.length === 0 ? (
        <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
          No confirmed balance has been synchronized yet.
        </div>
      ) : (
        <div className="space-y-2">
          {balances.syncStatus === "cached" ? (
            <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Live synchronization is not currently available. Showing the last confirmed balance without changing it.
            </div>
          ) : null}
          {balances.balances.map((row) => (
            <div key={`${row.asset}-${row.network ?? ""}`} className="flex items-center justify-between text-sm">
              <span className="font-medium text-gray-900">
                {row.asset}
                {row.stale ? <span className="ml-1.5 text-xs font-normal text-amber-600">(stale)</span> : balances.syncStatus === "cached" ? <span className="ml-1.5 text-xs font-normal text-amber-600">(cached)</span> : null}
              </span>
              <span className="text-gray-600">{formatAmount(row.availableBaseUnits, row.decimals, row.asset)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function ActivityCard({ activity }: { activity: ActivityData | null }) {
  const operations = activity?.operations ?? []
  return (
    <Card>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Activity</p>
      {operations.length === 0 ? (
        <p className="text-sm text-gray-500">No wallet activity yet.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {operations.map((op) => (
            <div key={op.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">
                  {operationTypeLabel(op.operationType)}
                  {op.destinationSummary ? ` - ${op.destinationSummary}` : ""}
                </p>
                <p className="text-xs text-gray-500">Bitcoin Lightning · {new Date(op.createdAt).toLocaleString()}</p>
                {op.feeBaseUnits ? <p className="text-xs text-gray-500">Fee: {op.feeBaseUnits} {op.asset}</p> : null}
                {op.failureReason ? <p className="text-xs text-red-600">{op.failureReason}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm text-gray-700">
                  {op.direction === "credit" ? "+" : "-"}
                  {op.amountBaseUnits} {op.asset}
                </span>
                <StatusBadge status={op.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function PreferencesCard() {
  return (
    <Card>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
        Automatic payouts & conversion
      </p>
      <p className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
        Automatic conversion and scheduled payouts are not currently available for Bitcoin Lightning.
      </p>
    </Card>
  )
}

function SendDialog({
  capabilityAvailable,
  accessToken,
  onClose,
  onSubmitted,
}: {
  capabilityAvailable: boolean
  accessToken: string | null
  onClose: () => void
  onSubmitted: () => void
}) {
  const [amount, setAmount] = useState("")
  const [destination, setDestination] = useState("")
  const [reviewing, setReviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  async function submit() {
    setSubmitting(true)
    setSubmitError(null)
    const res = await callWalletApi("/api/wallets/withdrawals", accessToken, {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ asset: "SATS", amount_decimal: amount, destination }),
    })
    setSubmitting(false)
    if (res.ok) {
      onSubmitted()
    } else {
      setSubmitError(res.error.message)
    }
  }

  return (
    <Dialog title="Withdraw Bitcoin Lightning" onClose={onClose}>
      {!capabilityAvailable ? (
        <div className="mb-4 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          Withdrawals are not currently available for this wallet.
          Submission is disabled until this becomes available.
        </div>
      ) : null}
      {submitError ? (
        <div className="mb-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700">{submitError}</div>
      ) : null}

      {reviewing ? (
        <div className="space-y-3 rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-700">
          <p><span className="font-medium text-gray-900">Amount:</span> {amount} SATS</p>
          <p className="break-all"><span className="font-medium text-gray-900">Destination:</span> {destination}</p>
          <p className="text-xs text-gray-500">Network fees, if any, are determined by the provider.</p>
        </div>
      ) : (
      <div className="space-y-3">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
          inputMode="decimal"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
        <input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="Destination address / invoice"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
        />
      </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={reviewing ? () => setReviewing(false) : onClose}>
          {reviewing ? "Back" : "Cancel"}
        </Button>
        <Button
          variant="primary"
          disabled={!capabilityAvailable || submitting || !amount || !destination}
          onClick={() => reviewing ? void submit() : setReviewing(true)}
        >
          {submitting ? "Submitting..." : reviewing ? "Confirm withdrawal" : "Review"}
        </Button>
      </div>
    </Dialog>
  )
}
