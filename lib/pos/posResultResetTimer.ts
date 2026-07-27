// Drives the POS terminal's post-result auto-reset: once a payment reaches a
// terminal UI status (confirmed/incomplete/failed/expired/cancelled), the
// result screen must stay visible for POS_RESULT_RESET_DELAY_MS and then the
// terminal must return to a clean keypad automatically. Extracted from
// components/pos/POSLayout.tsx so the scheduling/cancellation/generation-race
// behavior can be unit-tested with fake timers without rendering the
// component (this project has no @testing-library/react or jsdom — see
// posLayoutSaleCorrelationWiring.test.ts's doc comment).

const POS_TERMINAL_UI_STATUSES = new Set([
  "confirmed",
  "incomplete",
  "failed",
  "expired",
  "cancelled",
])

export type PosTerminalUiStatus =
  | "confirmed"
  | "incomplete"
  | "failed"
  | "expired"
  | "cancelled"

export function isPosTerminalUiStatus(status: string): status is PosTerminalUiStatus {
  return POS_TERMINAL_UI_STATUSES.has(status)
}

export const POS_RESULT_RESET_DELAY_MS = 3000

export type PosResultResetTimerHandle = {
  current: ReturnType<typeof setTimeout> | null
}

/**
 * Schedules the single post-result auto-reset timer. Generation-scoped: the
 * generation live when scheduling started is captured up front, and
 * re-checked against getCurrentGeneration() right before firing — so a timer
 * belonging to a sale that has since been manually reset, canceled, or
 * superseded by a new sale (all of which bump the generation counter) is a
 * silent no-op instead of resetting whatever is currently on screen.
 *
 * Always cancels any previously scheduled timer first, so at most one
 * post-result reset timer is ever pending at a time.
 */
export function schedulePosResultReset(
  handle: PosResultResetTimerHandle,
  generation: number,
  getCurrentGeneration: () => number,
  onReset: () => void,
  delayMs: number = POS_RESULT_RESET_DELAY_MS
): void {
  cancelPosResultReset(handle)
  handle.current = setTimeout(() => {
    handle.current = null
    if (getCurrentGeneration() !== generation) return
    onReset()
  }, delayMs)
}

export function cancelPosResultReset(handle: PosResultResetTimerHandle): void {
  if (handle.current !== null) {
    clearTimeout(handle.current)
    handle.current = null
  }
}
