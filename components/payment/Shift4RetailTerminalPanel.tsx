"use client"

export type Shift4RetailUiState = "choose_reader" | "configuring_device" | "ready" | "waiting_for_card" | "processing" | "partial_approval" | "additional_tender" | "referral" | "manual_authorization" | "confirmed" | "declined" | "canceling" | "canceled" | "timeout" | "recovering" | "device_unavailable"
const ACTIVE = new Set<Shift4RetailUiState>(["configuring_device", "waiting_for_card", "processing", "partial_approval", "additional_tender", "referral", "manual_authorization", "canceling", "timeout", "recovering"])

export default function Shift4RetailTerminalPanel(props: { state: Shift4RetailUiState; deviceLabel?: string | null; onCancel?: () => void; onRetryLookup?: () => void }) {
  const active = ACTIVE.has(props.state)
  return <section aria-live="polite" aria-label="Shift4 terminal status" data-keypad-locked={active ? "true" : "false"} className="rounded-xl border border-gray-200 bg-white p-4">
    <p className="text-sm font-semibold text-gray-950">{props.deviceLabel || "Shift4 payment terminal"}</p>
    <p className="mt-2 text-sm text-gray-600">{active ? `${props.state.replaceAll("_", " ")}. The sale keypad remains locked.` : props.state.replaceAll("_", " ")}</p>
    {active && props.onCancel && !["canceling", "recovering"].includes(props.state) ? <button type="button" onClick={props.onCancel} className="mt-4 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium">Cancel terminal session</button> : null}
    {["timeout", "recovering"].includes(props.state) && props.onRetryLookup ? <button type="button" onClick={props.onRetryLookup} className="mt-4 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white">Check invoice status</button> : null}
  </section>
}
