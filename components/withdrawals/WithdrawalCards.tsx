"use client"

import { useState, type ReactNode } from "react"
import { Check, CircleAlert, Clock3, Copy, ExternalLink } from "lucide-react"

export type WithdrawalLifecycleState =
  | "REVIEW"
  | "AUTHORIZING"
  | "SUBMITTING"
  | "SUBMITTED"
  | "CONFIRMING"
  | "COMPLETED"
  | "FAILED"
  | "CHECKING_STATUS"
  | "CANCELED"

export type WithdrawalDetail = {
  label: string
  value: ReactNode
  wide?: boolean
  mono?: boolean
}

const statusStyles: Record<WithdrawalLifecycleState, string> = {
  REVIEW: "bg-blue-50 text-blue-700 ring-blue-200",
  AUTHORIZING: "bg-blue-50 text-blue-700 ring-blue-200",
  SUBMITTING: "bg-blue-50 text-blue-700 ring-blue-200",
  SUBMITTED: "bg-blue-50 text-blue-700 ring-blue-200",
  CONFIRMING: "bg-blue-50 text-blue-700 ring-blue-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  FAILED: "bg-red-50 text-red-700 ring-red-200",
  CHECKING_STATUS: "bg-gray-100 text-gray-600 ring-gray-200",
  CANCELED: "bg-gray-100 text-gray-600 ring-gray-200",
}

const resultTone: Record<"success" | "pending" | "failed" | "checking", string> = {
  success: "border-emerald-200/80 bg-emerald-50/65 text-emerald-950",
  pending: "border-blue-200/80 bg-blue-50/65 text-blue-950",
  failed: "border-red-200/80 bg-red-50/65 text-red-950",
  checking: "border-gray-200 bg-gray-50 text-gray-950",
}

export function WithdrawalStatusPill({ state }: { state: WithdrawalLifecycleState }) {
  const label = state === "COMPLETED" ? "Confirmed" : state.replaceAll("_", " ").toLowerCase()
  return (
    <span className={`inline-flex h-7 w-auto shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-[11px] font-semibold capitalize leading-none ring-1 ring-inset ${statusStyles[state]}`}>
      {state === "COMPLETED" ? <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : null}
      {label}
    </span>
  )
}

export function WithdrawalDetailsCard({ details }: { details: WithdrawalDetail[] }) {
  return (
    <dl className="divide-y divide-gray-200/70 border-y border-gray-200/70 text-sm">
      {details.map((detail) => (
        <div
          key={detail.label}
          className={`flex min-w-0 gap-4 py-2.5 ${detail.wide ? "flex-col sm:flex-row sm:items-start sm:justify-between" : "items-start justify-between"}`}
        >
          <dt className="shrink-0 text-xs font-medium text-gray-500">{detail.label}</dt>
          <dd className={`min-w-0 break-words text-right font-semibold text-gray-900 [overflow-wrap:anywhere] ${detail.wide ? "text-left sm:text-right" : ""} ${detail.mono ? "font-mono text-xs font-normal text-gray-700" : ""}`}>
            {detail.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function DestinationPanel({
  destination,
  destinationLabel = "Destination",
  explorerUrl,
}: {
  destination: string
  destinationLabel?: string
  explorerUrl?: string | null
}) {
  const [copied, setCopied] = useState(false)

  async function copyDestination() {
    try {
      await navigator.clipboard.writeText(destination)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white/70 px-3.5 py-3 sm:px-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">{destinationLabel}</p>
      <div className="mt-1.5 flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-gray-800" title={destination}>{destination}</p>
        <button type="button" onClick={() => void copyDestination()} aria-label={copied ? "Destination copied" : "Copy destination"} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 transition hover:bg-white hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30">
          {copied ? <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
        </button>
        {explorerUrl ? (
          <a href={explorerUrl} target="_blank" rel="noreferrer" aria-label="View transaction in explorer" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 transition hover:bg-white hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </div>
  )
}

export function WithdrawalReviewCard({
  amount,
  network,
  destination,
  destinationLabel,
  details,
  disabled,
  submitting,
  onCancel,
  onConfirm,
  children,
}: {
  amount: string
  network: string
  destination: string
  destinationLabel?: string
  details: WithdrawalDetail[]
  disabled?: boolean
  submitting?: boolean
  onCancel: () => void
  onConfirm: () => void
  children?: ReactNode
}) {
  return (
    <div className="scroll-mt-24 space-y-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <section className="rounded-2xl border border-blue-200/80 bg-[radial-gradient(circle_at_top,rgba(37,99,235,0.10),transparent_48%),linear-gradient(145deg,rgba(255,255,255,0.98),rgba(244,249,255,0.96))] px-4 py-4 shadow-[0_14px_36px_rgba(37,99,235,0.09)] sm:px-5 sm:py-5">
        <header className="text-center">
          <h3 className="text-sm font-semibold text-gray-900">Review withdrawal</h3>
          <p className="mt-2 break-words text-3xl font-semibold tracking-[-0.035em] text-gray-950 sm:text-4xl">{amount}</p>
          <p className="mt-1 text-xs text-gray-500">Ready to send on {network}</p>
        </header>
        <div className="mt-4">
          <WithdrawalDetailsCard details={details} />
        </div>
        <div className="mt-3">
          <DestinationPanel destination={destination} destinationLabel={destinationLabel} />
        </div>
      </section>
      {children}
      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-end">
        <button type="button" onClick={onConfirm} disabled={disabled || submitting} className="inline-flex h-11 items-center justify-center rounded-xl bg-[#0052FF] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none">
          {submitting ? "Confirming…" : "Confirm withdrawal"}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting} className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-sm font-semibold text-gray-600 shadow-sm transition hover:border-red-200 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50">
          Cancel
        </button>
      </div>
    </div>
  )
}

export function WithdrawalProgressCard({ state, network }: { state: "AUTHORIZING" | "SUBMITTING" | "SUBMITTED" | "CONFIRMING" | "CHECKING_STATUS"; network?: string }) {
  const title = state === "AUTHORIZING" ? "Authorizing withdrawal" : state === "SUBMITTING" ? "Submitting withdrawal" : state === "SUBMITTED" ? "Withdrawal submitted" : state === "CONFIRMING" ? `Confirming${network ? ` on ${network}` : ""}` : "Checking withdrawal status"
  const checking = state === "CHECKING_STATUS"
  return (
    <section className={`relative z-0 scroll-mt-24 rounded-2xl border px-4 py-4 sm:px-5 ${checking ? resultTone.checking : resultTone.pending}`} aria-live="polite">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${checking ? "bg-gray-200/70 text-gray-600" : "bg-blue-100 text-blue-700"}`}>
          <Clock3 className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-[-0.01em]">{title}</h3>
          <p className="mt-0.5 text-xs leading-5 opacity-70">PineTree will keep this withdrawal synchronized with its canonical provider status.</p>
        </div>
      </div>
    </section>
  )
}

export function WithdrawalResultCard({
  state,
  title,
  message,
  amount,
  network,
  destination,
  explorerUrl,
  details,
  children,
}: {
  state: "COMPLETED" | "FAILED" | "CHECKING_STATUS" | "CANCELED" | "SUBMITTED" | "CONFIRMING"
  title: string
  message: string
  amount?: string
  network?: string
  destination?: string
  explorerUrl?: string | null
  details?: WithdrawalDetail[]
  children?: ReactNode
}) {
  const tone = state === "COMPLETED" ? resultTone.success : state === "FAILED" ? resultTone.failed : state === "CHECKING_STATUS" || state === "CANCELED" ? resultTone.checking : resultTone.pending
  const Icon = state === "COMPLETED" ? Check : state === "FAILED" ? CircleAlert : Clock3
  const iconTone = state === "COMPLETED" ? "bg-emerald-100 text-emerald-700" : state === "FAILED" ? "bg-red-100 text-red-700" : state === "CHECKING_STATUS" || state === "CANCELED" ? "bg-gray-200/70 text-gray-600" : "bg-blue-100 text-blue-700"

  return (
    <section className={`rounded-2xl border px-4 py-4 shadow-[0_12px_32px_rgba(15,23,42,0.06)] sm:px-6 sm:py-5 ${tone}`} aria-live="polite">
      <header className="text-center">
        <span className={`mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full ${iconTone}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <h3 className="mt-2.5 text-lg font-semibold tracking-[-0.02em]">{title}</h3>
        {amount ? <p className="mt-1 break-words text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">{amount}</p> : null}
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 opacity-70">{message}{network && state !== "COMPLETED" ? ` on ${network}` : ""}</p>
      </header>
      {details?.length ? <div className="mt-4"><WithdrawalDetailsCard details={details} /></div> : null}
      {destination ? <div className="mt-3"><DestinationPanel destination={destination} explorerUrl={explorerUrl} /></div> : null}
      {children}
    </section>
  )
}
