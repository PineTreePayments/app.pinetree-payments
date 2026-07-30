"use client"

import { supabase } from "@/lib/supabaseClient"

/**
 * Client-side cache of the merchant's unread support-reply state.
 *
 * The authoritative count always comes from GET /api/support/unread, which
 * resolves the merchant from the verified session — this module never persists
 * unread state in localStorage and never decides on its own that something has
 * been read. Clearing happens only through
 * POST /api/support/tickets/:ticketId/read, whose response reseeds this cache so
 * the sidebar badge and the Help Center rows update together.
 *
 * A tiny external store (rather than a provider) keeps the dashboard layout and
 * the Help Center page in sync without adding a global query client.
 */

export type SupportUnreadState = {
  totalUnread: number
  unreadTicketCount: number
  byTicketId: Record<string, number>
  loaded: boolean
}

type UnreadResponse = {
  totalUnread?: number
  unreadTicketCount?: number
  tickets?: Array<{ ticketId?: string; unreadCount?: number }>
}

const EMPTY_STATE: SupportUnreadState = {
  totalUnread: 0,
  unreadTicketCount: 0,
  byTicketId: {},
  loaded: false,
}

let state: SupportUnreadState = EMPTY_STATE
const listeners = new Set<() => void>()
let inFlight: Promise<void> | null = null
let lastRefreshAt = 0

function emit() {
  for (const listener of listeners) listener()
}

function setState(next: SupportUnreadState) {
  state = next
  emit()
}

function projectResponse(payload: UnreadResponse | null): SupportUnreadState {
  const tickets = payload?.tickets || []
  const byTicketId: Record<string, number> = {}
  for (const ticket of tickets) {
    if (!ticket?.ticketId) continue
    byTicketId[ticket.ticketId] = Number(ticket.unreadCount || 0)
  }

  return {
    totalUnread: Number(payload?.totalUnread || 0),
    unreadTicketCount: Number(payload?.unreadTicketCount || tickets.length || 0),
    byTicketId,
    loaded: true,
  }
}

export function getSupportUnreadState(): SupportUnreadState {
  return state
}

export function getServerSupportUnreadState(): SupportUnreadState {
  return EMPTY_STATE
}

export function subscribeSupportUnread(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token || null
}

/**
 * Refreshes the unread count. Single-flight, and `minIntervalMs` lets ambient
 * triggers (tab focus, navigation) share one low-frequency budget instead of
 * polling.
 */
export function refreshSupportUnread(options?: { minIntervalMs?: number }): Promise<void> {
  const minIntervalMs = options?.minIntervalMs ?? 0
  if (minIntervalMs > 0 && Date.now() - lastRefreshAt < minIntervalMs) {
    return Promise.resolve()
  }
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const token = await getAccessToken()
      if (!token) return

      const res = await fetch("/api/support/unread", {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
        cache: "no-store",
      })
      if (!res.ok) return

      const payload = (await res.json().catch(() => null)) as UnreadResponse | null
      setState(projectResponse(payload))
      lastRefreshAt = Date.now()
    } catch {
      // Badge state is non-critical: keep the last known count.
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

/**
 * Marks support replies up to `lastMessageId` as read. Passing null (a thread
 * with no support replies) is a no-op server-side.
 */
export async function markSupportTicketRead(
  ticketId: string,
  lastMessageId: string | null
): Promise<void> {
  try {
    const token = await getAccessToken()
    if (!token) return

    const res = await fetch(`/api/support/tickets/${encodeURIComponent(ticketId)}/read`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
      body: JSON.stringify({ lastMessageId }),
    })
    if (!res.ok) return

    const payload = (await res.json().catch(() => null)) as { unread?: UnreadResponse } | null
    if (payload?.unread) {
      setState(projectResponse(payload.unread))
      lastRefreshAt = Date.now()
    }
  } catch {
    // Leave the badge as-is; the next refresh reconciles with the server.
  }
}

/** Compact badge text — never wider than three characters. */
export function formatUnreadBadgeCount(count: number): string {
  if (count <= 0) return ""
  if (count > 99) return "99+"
  if (count > 9) return `${count}`
  return `${count}`
}

/** Test seam: clears the module cache between test cases. */
export function resetSupportUnreadStateForTests() {
  state = EMPTY_STATE
  inFlight = null
  lastRefreshAt = 0
}
