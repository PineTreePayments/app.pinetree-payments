const TERMINAL_STATUSES = new Set(["CONFIRMED", "FAILED", "EXPIRED", "INCOMPLETE", "CANCELED", "CANCELLED"])

export type LightningPollResult = { status?: string | null }

export type LightningStatusPollerOptions = {
  check: (signal: AbortSignal) => Promise<LightningPollResult>
  onResult?: (result: LightningPollResult) => void
  onError?: (error: unknown) => void
  initialDelayMs?: number
  maxDelayMs?: number
  maxAttempts?: number
  maxDurationMs?: number
}

function normalizedStatus(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase()
}

export function isTerminalLightningPollStatus(value: string | null | undefined) {
  return TERMINAL_STATUSES.has(normalizedStatus(value))
}

export class LightningStatusPoller {
  private options: LightningStatusPollerOptions
  private timer: ReturnType<typeof setTimeout> | null = null
  private controller: AbortController | null = null
  private inFlight = false
  private stopped = false
  private paused = false
  private offline = false
  private attempts = 0
  private unchangedResponses = 0
  private lastStatus = ""
  private startedAt = 0
  private runWhenSettled = false

  constructor(options: LightningStatusPollerOptions) {
    this.options = options
  }

  updateOptions(options: LightningStatusPollerOptions) {
    this.options = options
  }

  start() {
    if (this.startedAt) return
    this.startedAt = Date.now()
    void this.checkNow()
  }

  pause() {
    this.paused = true
    this.clearTimer()
    this.controller?.abort()
  }

  resume() {
    if (this.stopped) return
    const wasPaused = this.paused
    this.paused = false
    if (wasPaused && !this.offline) {
      if (this.inFlight) this.runWhenSettled = true
      else void this.checkNow()
    }
  }

  setOffline(offline: boolean) {
    if (this.stopped || this.offline === offline) return
    this.offline = offline
    if (offline) {
      this.clearTimer()
      this.controller?.abort()
      return
    }
    if (!this.paused) {
      if (this.inFlight) this.runWhenSettled = true
      else void this.checkNow()
    }
  }

  stop() {
    this.stopped = true
    this.clearTimer()
    this.controller?.abort()
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private nextDelayMs() {
    const initial = Math.max(2_000, this.options.initialDelayMs ?? 2_500)
    const maximum = Math.min(10_000, Math.max(initial, this.options.maxDelayMs ?? 9_000))
    const steps = [initial, 4_000, 6_000, maximum]
    return Math.min(maximum, steps[Math.min(this.unchangedResponses, steps.length - 1)])
  }

  private mayContinue() {
    const maxAttempts = Math.max(1, this.options.maxAttempts ?? 60)
    const maxDurationMs = Math.max(30_000, this.options.maxDurationMs ?? 6 * 60_000)
    return !this.stopped && !this.paused && !this.offline && this.attempts < maxAttempts && Date.now() - this.startedAt < maxDurationMs
  }

  private scheduleNext() {
    if (!this.mayContinue()) return
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.checkNow()
    }, this.nextDelayMs())
  }

  private async checkNow() {
    if (!this.mayContinue() || this.inFlight) return
    this.inFlight = true
    this.attempts += 1
    const controller = new AbortController()
    this.controller = controller

    try {
      const result = await this.options.check(controller.signal)
      if (controller.signal.aborted || this.stopped) return
      const status = normalizedStatus(result.status)
      this.unchangedResponses = status && status === this.lastStatus ? this.unchangedResponses + 1 : 0
      if (status) this.lastStatus = status
      this.options.onResult?.(result)
      if (isTerminalLightningPollStatus(status)) {
        this.stop()
        return
      }
    } catch (error) {
      if (!controller.signal.aborted) this.options.onError?.(error)
    } finally {
      if (this.controller === controller) this.controller = null
      this.inFlight = false
    }

    if (this.runWhenSettled && this.mayContinue()) {
      this.runWhenSettled = false
      void this.checkNow()
      return
    }
    this.scheduleNext()
  }
}

type RegistryEntry = {
  poller: LightningStatusPoller
  references: number
  disposeTimer: ReturnType<typeof setTimeout> | null
}

const activePollers = new Map<string, RegistryEntry>()

export function acquireLightningStatusPoller(key: string, options: LightningStatusPollerOptions) {
  const existing = activePollers.get(key)
  if (existing) {
    if (existing.disposeTimer !== null) clearTimeout(existing.disposeTimer)
    existing.disposeTimer = null
    existing.references += 1
    existing.poller.updateOptions(options)
    return { poller: existing.poller, release: () => releaseLightningStatusPoller(key, existing) }
  }

  const entry: RegistryEntry = {
    poller: new LightningStatusPoller(options),
    references: 1,
    disposeTimer: null,
  }
  activePollers.set(key, entry)
  entry.poller.start()
  return { poller: entry.poller, release: () => releaseLightningStatusPoller(key, entry) }
}

function releaseLightningStatusPoller(key: string, entry: RegistryEntry) {
  entry.references = Math.max(0, entry.references - 1)
  if (entry.references > 0 || entry.disposeTimer !== null) return
  // A zero-delay grace period preserves the same controller across React Strict
  // Mode's development-only unmount/remount cycle.
  entry.disposeTimer = setTimeout(() => {
    if (entry.references > 0) return
    entry.poller.stop()
    activePollers.delete(key)
  }, 0)
}

export function getActiveLightningPollerCountForTests() {
  return activePollers.size
}
