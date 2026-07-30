"use client"

import { useEffect, useSyncExternalStore } from "react"
import {
  getServerSupportUnreadState,
  getSupportUnreadState,
  refreshSupportUnread,
  subscribeSupportUnread,
  type SupportUnreadState,
} from "@/lib/support/supportUnreadClient"

// Ambient refresh budget. Support replies are human-paced, so the badge reads
// the server on mount, when the tab becomes visible again, and on a slow
// heartbeat — never on a high-frequency poll.
const VISIBILITY_REFRESH_MIN_INTERVAL_MS = 30_000
const HEARTBEAT_MS = 120_000

/**
 * Merchant unread support-reply state for navigation badges and ticket rows.
 *
 * Every consumer shares one cache, so marking a thread read in the Help Center
 * updates the sidebar badge in the same tick.
 */
export function useMerchantSupportUnread(options?: { enabled?: boolean }): SupportUnreadState {
  const enabled = options?.enabled ?? true

  const state = useSyncExternalStore(
    subscribeSupportUnread,
    getSupportUnreadState,
    getServerSupportUnreadState
  )

  useEffect(() => {
    if (!enabled) return

    void refreshSupportUnread()

    function handleVisibility() {
      if (document.visibilityState !== "visible") return
      void refreshSupportUnread({ minIntervalMs: VISIBILITY_REFRESH_MIN_INTERVAL_MS })
    }

    const heartbeat = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      void refreshSupportUnread()
    }, HEARTBEAT_MS)

    document.addEventListener("visibilitychange", handleVisibility)
    window.addEventListener("focus", handleVisibility)

    return () => {
      window.clearInterval(heartbeat)
      document.removeEventListener("visibilitychange", handleVisibility)
      window.removeEventListener("focus", handleVisibility)
    }
  }, [enabled])

  return state
}
