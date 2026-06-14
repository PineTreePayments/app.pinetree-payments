"use client"

import { useEffect, useRef } from "react"

export interface UseDashboardAutoRefreshOptions {
  /** The data-load function to call on refresh. May return a Promise or void. */
  refresh: () => Promise<void> | void
  /** Master switch — set to false to disable all auto-refresh (e.g. while another load is in progress). Default: true */
  enabled?: boolean
  /** Refresh immediately on component mount. Default: true */
  refreshOnMount?: boolean
  /** Refresh when the browser tab becomes visible. Default: true */
  refreshOnVisibility?: boolean
  /** Refresh when the window regains focus. Default: true */
  refreshOnFocus?: boolean
  /**
   * Minimum milliseconds between visibility/focus-triggered refreshes.
   * Mount refresh always fires regardless. Default: 60 000 (1 minute).
   */
  minIntervalMs?: number
}

/**
 * Triggers a dashboard data refresh on mount, tab-visible, and window-focus events.
 *
 * Rules:
 * - Mount refresh always fires immediately (regardless of throttle).
 * - Visibility/focus refreshes are throttled by minIntervalMs.
 * - Only one refresh runs at a time (concurrent calls are dropped).
 * - Errors from the refresh callback are swallowed here; the callback
 *   itself is responsible for its own error display.
 */
export function useDashboardAutoRefresh({
  refresh,
  enabled = true,
  refreshOnMount = true,
  refreshOnVisibility = true,
  refreshOnFocus = true,
  minIntervalMs = 60_000,
}: UseDashboardAutoRefreshOptions): void {
  // Stable ref to the latest refresh callback — updated every render so
  // visibility/focus handlers always call the current closure.
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  // Tracks when the last throttled refresh was initiated (ms since epoch).
  const lastThrottledAtRef = useRef(0)
  // True while a hook-initiated refresh Promise is still pending.
  const pendingRef = useRef(false)

  // Mount: fire once per component lifetime, bypassing throttle.
  useEffect(() => {
    if (!enabled || !refreshOnMount) return
    pendingRef.current = true
    lastThrottledAtRef.current = Date.now()
    void Promise.resolve(refreshRef.current()).finally(() => {
      pendingRef.current = false
    })
    // Intentionally no dependencies — runs on every mount (page navigation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Visibility & focus: throttled refresh.
  useEffect(() => {
    if (typeof window === "undefined") return

    function attemptRefresh() {
      if (!enabled) return
      if (pendingRef.current) return
      if (Date.now() - lastThrottledAtRef.current < minIntervalMs) return

      pendingRef.current = true
      lastThrottledAtRef.current = Date.now()
      void Promise.resolve(refreshRef.current()).finally(() => {
        pendingRef.current = false
      })
    }

    function onVisibilityChange() {
      if (refreshOnVisibility && document.visibilityState === "visible") {
        attemptRefresh()
      }
    }

    function onFocus() {
      if (refreshOnFocus) attemptRefresh()
    }

    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("focus", onFocus)

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("focus", onFocus)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, refreshOnVisibility, refreshOnFocus, minIntervalMs])
}
