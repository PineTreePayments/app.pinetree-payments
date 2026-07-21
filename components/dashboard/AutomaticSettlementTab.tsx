"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, PauseCircle, ShieldAlert, X } from "lucide-react"
import ToggleSwitch from "@/components/ui/ToggleSwitch"
import { SegmentedButtons } from "@/components/ui/SegmentedButtons"
import { modalCloseButtonClass } from "@/components/ui/ModalCloseButton"

type Rail = "base" | "solana" | "bitcoin"
type Asset = "ETH" | "USDC" | "SOL" | "BTC"
type SweepMode = "manual" | "threshold" | "daily" | "per_payment"

type Destination = {
  id: string
  rail: Rail
  asset: Asset
  label: string
  is_enabled: boolean
  confirmation_status: "unconfirmed" | "confirmed"
}

type SweepRule = {
  id: string
  rail: Rail
  asset: Asset
  destination_id: string
  is_enabled: boolean
  mode: SweepMode
  threshold_amount_decimal: string | null
  scheduled_time_utc: string | null
  min_remaining_reserve_decimal: string
  max_daily_sweep_usd: number | null
  last_executed_at: string | null
  last_success_at: string | null
  last_failure_at: string | null
  last_failure_reason: string | null
}

type PendingSweepJob = {
  id: string
  rail: "base" | "solana"
  asset: "ETH" | "USDC" | "SOL"
  amount_decimal: string
  status: string
}

const ACK_PHRASE = "I understand automatic transfers"

const RAIL_ASSETS: Record<Rail, Asset[]> = {
  base: ["ETH", "USDC"],
  solana: ["SOL", "USDC"],
  bitcoin: ["BTC"],
}

function capabilityNote(rail: Rail): string {
  if (rail === "bitcoin") {
    return "Bitcoin sweeps run automatically in the background - no action needed once enabled."
  }
  return "Base and Solana sweeps complete automatically the next time you have an active Wallet session, since these are self-custodial wallets that require your device to approve each transfer. True background transfers aren't available without additional custody infrastructure this account doesn't have yet."
}

export default function AutomaticSettlementTab({
  accessToken,
  onContinuePendingJob,
}: {
  accessToken: string | null
  onContinuePendingJob: (job: PendingSweepJob) => void
}) {
  const [rules, setRules] = useState<SweepRule[] | null>(null)
  const [destinations, setDestinations] = useState<Destination[]>([])
  const [pendingJobs, setPendingJobs] = useState<PendingSweepJob[]>([])
  const [loadError, setLoadError] = useState("")
  const [actionError, setActionError] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [formRail, setFormRail] = useState<Rail>("base")
  const [formAsset, setFormAsset] = useState<Asset>("ETH")
  const [formDestinationId, setFormDestinationId] = useState("")
  const [formMode, setFormMode] = useState<SweepMode>("manual")
  const [formThreshold, setFormThreshold] = useState("")
  const [formScheduledTime, setFormScheduledTime] = useState("09:00:00")
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState("")

  const [enableModalRule, setEnableModalRule] = useState<SweepRule | null>(null)
  const [enableAckText, setEnableAckText] = useState("")
  const [enableAckChecked, setEnableAckChecked] = useState(false)
  const [enableBusy, setEnableBusy] = useState(false)
  const [enableError, setEnableError] = useState("")

  async function loadAll() {
    if (!accessToken) return
    try {
      const [rulesRes, destRes, pendingRes] = await Promise.all([
        fetch("/api/wallets/pinetree-wallet/sweep-rules", { headers: { Authorization: `Bearer ${accessToken}` } }),
        fetch("/api/wallets/pinetree-wallet/withdrawal-destinations", { headers: { Authorization: `Bearer ${accessToken}` } }),
        fetch("/api/wallets/pinetree-wallet/sweep-jobs/pending", { headers: { Authorization: `Bearer ${accessToken}` } }),
      ])
      const rulesJson = await rulesRes.json()
      const destJson = await destRes.json()
      const pendingJson = await pendingRes.json()
      if (!rulesRes.ok) {
        setLoadError(rulesJson?.error || "Couldn't load automatic sweep rules.")
        return
      }
      setRules(rulesJson.rules || [])
      setDestinations((destJson.destinations || []).filter((d: Destination) => d.confirmation_status === "confirmed"))
      setPendingJobs(pendingJson.jobs || [])
    } catch {
      setLoadError("Couldn't load automatic sweep rules.")
    }
  }

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken])

  const eligibleDestinations = useMemo(
    () => destinations.filter((d) => d.rail === formRail && d.asset === formAsset),
    [destinations, formRail, formAsset]
  )

  async function handlePauseAll() {
    if (!accessToken) return
    setBusyId("pause-all")
    setActionError("")
    try {
      const res = await fetch("/api/wallets/pinetree-wallet/sweep-rules/pause-all", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const json = await res.json()
      if (!res.ok) {
        setActionError(json?.error || "Couldn't pause automatic sweeps.")
        return
      }
      await loadAll()
    } finally {
      setBusyId(null)
    }
  }

  async function handleToggle(rule: SweepRule, nextEnabled: boolean) {
    if (!accessToken) return
    if (!nextEnabled) {
      setBusyId(rule.id)
      setActionError("")
      try {
        const res = await fetch(`/api/wallets/pinetree-wallet/sweep-rules/${rule.id}`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ is_enabled: false }),
        })
        const json = await res.json()
        if (!res.ok) {
          setActionError(json?.error || "Couldn't disable this rule.")
          return
        }
        await loadAll()
      } finally {
        setBusyId(null)
      }
      return
    }
    setEnableModalRule(rule)
    setEnableAckText("")
    setEnableAckChecked(false)
    setEnableError("")
  }

  async function confirmEnable() {
    if (!accessToken || !enableModalRule) return
    if (enableAckText.trim() !== ACK_PHRASE || !enableAckChecked) {
      setEnableError(`Type "${ACK_PHRASE}" exactly and check the box to continue.`)
      return
    }
    setEnableBusy(true)
    setEnableError("")
    try {
      const res = await fetch(`/api/wallets/pinetree-wallet/sweep-rules/${enableModalRule.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ is_enabled: true, acknowledgment_text: enableAckText.trim() }),
      })
      const json = await res.json()
      if (!res.ok) {
        setEnableError(json?.error || "Couldn't enable this rule.")
        return
      }
      setEnableModalRule(null)
      await loadAll()
    } finally {
      setEnableBusy(false)
    }
  }

  async function handleCreateRule() {
    if (!accessToken) return
    setFormSaving(true)
    setFormError("")
    try {
      const res = await fetch("/api/wallets/pinetree-wallet/sweep-rules", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          rail: formRail,
          asset: formAsset,
          destination_id: formDestinationId,
          mode: formMode,
          threshold_amount_decimal: formMode === "threshold" ? formThreshold : null,
          scheduled_time_utc: formMode === "daily" ? formScheduledTime : null,
          is_enabled: false,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setFormError(json?.error || "Couldn't create this sweep rule.")
        return
      }
      setShowCreate(false)
      setFormDestinationId("")
      setFormThreshold("")
      await loadAll()
    } finally {
      setFormSaving(false)
    }
  }

  if (loadError) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5">
        <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-600" />
        <p className="text-xs leading-5 text-red-700">{loadError}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2 rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2.5">
        <p className="text-xs leading-5 text-blue-900">
          Move confirmed balance to a saved destination automatically. Manual only by default - immediate per-payment sweeps may incur a separate network fee per transfer.
        </p>
        <button
          type="button"
          onClick={() => void handlePauseAll()}
          disabled={busyId === "pause-all"}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
        >
          <PauseCircle size={12} /> Pause all
        </button>
      </div>

      {actionError ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-600" />
          <p className="text-xs leading-5 text-red-700">{actionError}</p>
        </div>
      ) : null}

      {pendingJobs.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
          <p className="text-xs font-semibold text-amber-800">Automatic transfers ready to complete</p>
          {pendingJobs.map((job) => (
            <div key={job.id} className="flex items-center justify-between gap-2 rounded-lg bg-white/70 px-2.5 py-2">
              <p className="text-xs text-gray-700">{job.amount_decimal} {job.asset} on {job.rail}</p>
              <button
                type="button"
                onClick={() => onContinuePendingJob(job)}
                className="rounded-md bg-[#0052FF] px-2.5 py-1 text-[11px] font-semibold text-white"
              >
                Complete now
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-gray-600">Sweep rules</p>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="text-xs font-semibold text-blue-700 hover:underline"
        >
          + New rule
        </button>
      </div>

      {showCreate ? (
        <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.11em] text-gray-600">Network</span>
              <SegmentedButtons
                ariaLabel="Network"
                value={formRail}
                onChange={(value) => {
                  const rail = value as Rail
                  setFormRail(rail)
                  setFormAsset(RAIL_ASSETS[rail][0])
                  setFormDestinationId("")
                }}
                options={[
                  { value: "base", label: "Base" },
                  { value: "solana", label: "Solana" },
                  { value: "bitcoin", label: "Bitcoin" },
                ]}
              />
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.11em] text-gray-600">Asset</span>
              <SegmentedButtons
                ariaLabel="Asset"
                value={formAsset}
                onChange={(value) => { setFormAsset(value as Asset); setFormDestinationId("") }}
                options={RAIL_ASSETS[formRail].map((asset) => ({ value: asset, label: asset }))}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.11em] text-gray-600">Destination</span>
            <select
              value={formDestinationId}
              onChange={(event) => setFormDestinationId(event.target.value)}
              className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
            >
              <option value="">Select a confirmed destination...</option>
              {eligibleDestinations.map((destination) => (
                <option key={destination.id} value={destination.id}>{destination.label || destination.id}</option>
              ))}
            </select>
            {eligibleDestinations.length === 0 ? (
              <p className="mt-1 text-[11px] text-amber-700">
                No confirmed destinations for this asset/network yet - add and confirm one in Address Book first.
              </p>
            ) : null}
          </label>

          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.11em] text-gray-600">Mode</span>
            <SegmentedButtons
              ariaLabel="Sweep mode"
              value={formMode}
              onChange={(value) => setFormMode(value as SweepMode)}
              options={[
                { value: "manual", label: "Manual only" },
                { value: "threshold", label: "Threshold" },
                { value: "daily", label: "Daily" },
                { value: "per_payment", label: "Per payment" },
              ]}
            />
          </label>

          {formMode === "threshold" ? (
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.11em] text-gray-600">Sweep when balance exceeds</span>
              <input
                value={formThreshold}
                onChange={(event) => setFormThreshold(event.target.value)}
                placeholder="0.00"
                className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
              />
            </label>
          ) : null}

          {formMode === "daily" ? (
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.11em] text-gray-600">Scheduled time (UTC)</span>
              <input
                type="time"
                step={1}
                value={formScheduledTime}
                onChange={(event) => setFormScheduledTime(`${event.target.value}:00`)}
                className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
              />
            </label>
          ) : null}

          {formMode === "per_payment" ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-600" />
              <p className="text-[11px] leading-4 text-amber-800">Each transfer may incur a separate network fee.</p>
            </div>
          ) : null}

          {formError ? <p className="text-xs text-red-600">{formError}</p> : null}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600">
              Cancel
            </button>
            <button
              type="button"
              disabled={formSaving || !formDestinationId}
              onClick={() => void handleCreateRule()}
              className="rounded-lg bg-[#0052FF] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {formSaving ? "Saving..." : "Save rule (disabled)"}
            </button>
          </div>
        </div>
      ) : null}

      {rules === null ? (
        <p className="py-6 text-center text-sm text-gray-500">Loading sweep rules...</p>
      ) : rules.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">No automatic sweep rules configured yet.</p>
      ) : (
        <ul className="space-y-2">
          {rules.map((rule) => (
            <li key={rule.id} className="rounded-xl border border-gray-200/80 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-950">{rule.asset} · {rule.rail}</p>
                  <p className="mt-0.5 text-xs text-gray-500 capitalize">{rule.mode.replace("_", " ")} mode</p>
                  <p className="mt-1 text-[10px] leading-4 text-gray-400">{capabilityNote(rule.rail)}</p>
                  {rule.last_failure_reason ? (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-red-600">
                      <ShieldAlert size={11} /> {rule.last_failure_reason}
                    </p>
                  ) : null}
                </div>
                <ToggleSwitch checked={rule.is_enabled} onChange={(next) => void handleToggle(rule, next)} disabled={busyId === rule.id} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {enableModalRule ? (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => { if (event.currentTarget === event.target) setEnableModalRule(null) }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="enable-sweep-rule-title"
            className="w-full max-w-[26rem] rounded-[1.25rem] border border-white/70 bg-white px-5 py-5 shadow-[0_28px_80px_rgba(15,23,42,0.28)]"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="enable-sweep-rule-title" className="text-base font-semibold text-gray-950">Enable automatic sweeps</h2>
              <button type="button" onClick={() => setEnableModalRule(null)} aria-label="Close" className={modalCloseButtonClass}>
                <X size={16} />
              </button>
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />
              <p className="text-xs leading-5 text-amber-800">
                This will automatically move confirmed {enableModalRule.asset} balance to your saved destination without asking each time. This account has no separate reauthentication step for this action - this typed confirmation is the strongest safeguard available.
              </p>
            </div>
            <label className="mt-3 block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.11em] text-gray-600">
                Type &quot;{ACK_PHRASE}&quot; to continue
              </span>
              <input
                value={enableAckText}
                onChange={(event) => setEnableAckText(event.target.value)}
                className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-800 outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
              />
            </label>
            <label className="mt-2 flex items-start gap-1.5">
              <input
                type="checkbox"
                checked={enableAckChecked}
                onChange={(event) => setEnableAckChecked(event.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300"
              />
              <span className="text-[11px] leading-4 text-gray-700">I understand this authorizes unattended transfers and want to proceed.</span>
            </label>
            {enableError ? <p className="mt-2 text-xs text-red-600">{enableError}</p> : null}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setEnableModalRule(null)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={enableBusy}
                onClick={() => void confirmEnable()}
                className="rounded-lg bg-[#0052FF] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {enableBusy ? "Enabling..." : "Enable automatic sweeps"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
