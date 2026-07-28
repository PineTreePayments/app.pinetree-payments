"use client"

import type { ReactNode } from "react"

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
  CONFIRMING: "bg-amber-50 text-amber-800 ring-amber-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  FAILED: "bg-red-50 text-red-700 ring-red-200",
  CHECKING_STATUS: "bg-amber-50 text-amber-800 ring-amber-200",
  CANCELED: "bg-gray-100 text-gray-700 ring-gray-200",
}

export function WithdrawalStatusPill({ state }: { state: WithdrawalLifecycleState }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusStyles[state]}`}>
      {state.replaceAll("_", " ")}
    </span>
  )
}

export function WithdrawalDetailsCard({ details }: { details: WithdrawalDetail[] }) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      {details.map((detail) => (
        <div
          key={detail.label}
          className={`rounded-xl border border-blue-100/70 bg-white/80 px-3 py-2.5 ${detail.wide ? "sm:col-span-2" : ""}`}
        >
          <dt className="text-xs font-semibold text-gray-500">{detail.label}</dt>
          <dd className={`mt-1 break-words [overflow-wrap:anywhere] font-semibold text-gray-950 ${detail.mono ? "font-mono text-xs font-normal text-gray-800" : ""}`}>
            {detail.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function WithdrawalReviewCard({
  details,
  disabled,
  submitting,
  onCancel,
  onConfirm,
  children,
}: {
  details: WithdrawalDetail[]
  disabled?: boolean
  submitting?: boolean
  onCancel: () => void
  onConfirm: () => void
  children?: ReactNode
}) {
  return (
    <div className="scroll-mt-24 space-y-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <section className="rounded-[1.35rem] border border-blue-200/70 bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.10),transparent_45%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(247,251,255,0.97))] px-4 py-4 shadow-[0_18px_42px_rgba(37,99,235,0.10)] sm:px-5 sm:py-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-950">Review withdrawal</h3>
            <p className="mt-1 text-xs leading-5 text-gray-500">Review the withdrawal details before authorizing.</p>
          </div>
          <WithdrawalStatusPill state="REVIEW" />
        </div>
        <WithdrawalDetailsCard details={details} />
      </section>
      {children}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={onConfirm} disabled={disabled || submitting} className="inline-flex h-11 items-center justify-center rounded-lg bg-[#0052FF] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 disabled:shadow-none sm:order-2">
          {submitting ? "Confirming…" : "Confirm withdrawal"}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting} className="inline-flex h-11 items-center justify-center rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-600 shadow-sm transition hover:border-red-200 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 sm:order-1">
          Cancel
        </button>
      </div>
    </div>
  )
}

export function WithdrawalProgressCard({ state, network }: { state: "AUTHORIZING" | "SUBMITTING" | "SUBMITTED" | "CONFIRMING" | "CHECKING_STATUS"; network?: string }) {
  const title = state === "AUTHORIZING" ? "Authorizing withdrawal" : state === "SUBMITTING" ? "Submitting withdrawal" : state === "SUBMITTED" ? "Withdrawal submitted" : state === "CONFIRMING" ? `Confirming${network ? ` on ${network}` : ""}` : "Checking withdrawal status"
  return (
    <section className="relative z-0 scroll-mt-24 rounded-[1.2rem] border border-blue-100 bg-blue-50/70 px-5 py-5" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-blue-950">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-blue-900">PineTree will keep this withdrawal synchronized with its canonical provider status.</p>
        </div>
        <WithdrawalStatusPill state={state} />
      </div>
    </section>
  )
}

export function WithdrawalResultCard({ state, title, message, details, children }: { state: "COMPLETED" | "FAILED" | "CHECKING_STATUS" | "CANCELED" | "SUBMITTED" | "CONFIRMING"; title: string; message: string; details?: WithdrawalDetail[]; children?: ReactNode }) {
  const tone = state === "COMPLETED" ? "border-emerald-200 bg-emerald-50/70 text-emerald-950" : state === "FAILED" ? "border-red-200 bg-red-50 text-red-900" : state === "CHECKING_STATUS" ? "border-amber-200 bg-amber-50 text-amber-950" : "border-blue-200 bg-blue-50/70 text-blue-950"
  return (
    <section className={`rounded-[1.2rem] border px-5 py-5 ${tone}`} aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="mt-1 text-sm leading-6">{message}</p>
        </div>
        <WithdrawalStatusPill state={state} />
      </div>
      {details?.length ? <div className="mt-4"><WithdrawalDetailsCard details={details} /></div> : null}
      {children}
    </section>
  )
}
