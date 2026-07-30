import fs from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const tickets: Array<{ id: string; merchant_id: string; merchant_last_read_at: string | null }> = []
const messages: Array<{
  id: string
  ticket_id: string
  merchant_id: string
  sender_type: "merchant" | "pinetree" | "system"
  created_at: string
}> = []

vi.mock("@/database/supportTickets", () => ({
  getSupportTicketByIdForMerchant: async (ticketId: string, merchantId: string) =>
    tickets.find((t) => t.id === ticketId && t.merchant_id === merchantId) ?? null,
  getSupportTicketReadBoundariesForMerchant: async (merchantId: string) =>
    tickets
      .filter((t) => t.merchant_id === merchantId)
      .map((t) => ({ id: t.id, merchant_last_read_at: t.merchant_last_read_at })),
  getSupportMessagesFromSupportForMerchant: async (merchantId: string) =>
    messages
      .filter((m) => m.merchant_id === merchantId && m.sender_type === "pinetree")
      .map((m) => ({ id: m.id, ticket_id: m.ticket_id, created_at: m.created_at }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
  getSupportTicketMessageForMerchant: async (
    messageId: string,
    ticketId: string,
    merchantId: string
  ) =>
    messages.find(
      (m) => m.id === messageId && m.ticket_id === ticketId && m.merchant_id === merchantId
    ) ?? null,
  updateSupportTicketMerchantReadBoundary: async (
    ticketId: string,
    merchantId: string,
    readAt: string
  ) => {
    const ticket = tickets.find((t) => t.id === ticketId && t.merchant_id === merchantId)
    if (!ticket) throw new Error("Failed to update support read state: no row")
    ticket.merchant_last_read_at = readAt
    return { ...ticket }
  },
}))

const {
  computeSupportUnread,
  getMerchantSupportUnread,
  markSupportTicketRead,
} = await import("@/engine/support/supportUnread")

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

beforeEach(() => {
  tickets.length = 0
  messages.length = 0
})

describe("merchant unread support message counting", () => {
  it("counts an admin reply as unread", () => {
    const unread = computeSupportUnread(
      [{ id: "m1", ticket_id: "t1", created_at: "2026-07-30T10:00:00Z" }],
      [{ id: "t1", merchant_last_read_at: null }]
    )

    expect(unread.totalUnread).toBe(1)
    expect(unread.unreadTicketCount).toBe(1)
    expect(unread.tickets[0]).toMatchObject({ ticketId: "t1", unreadCount: 1 })
  })

  it("does not count merchant replies or internal system entries", async () => {
    tickets.push({ id: "t1", merchant_id: "merchant-a", merchant_last_read_at: null })
    messages.push(
      { id: "m1", ticket_id: "t1", merchant_id: "merchant-a", sender_type: "merchant", created_at: "2026-07-30T10:00:00Z" },
      { id: "m2", ticket_id: "t1", merchant_id: "merchant-a", sender_type: "system", created_at: "2026-07-30T10:05:00Z" }
    )

    const unread = await getMerchantSupportUnread("merchant-a")
    expect(unread.totalUnread).toBe(0)

    messages.push({
      id: "m3",
      ticket_id: "t1",
      merchant_id: "merchant-a",
      sender_type: "pinetree",
      created_at: "2026-07-30T10:10:00Z",
    })

    const afterSupportReply = await getMerchantSupportUnread("merchant-a")
    expect(afterSupportReply.totalUnread).toBe(1)
  })

  it("treats a status change with no support message as read", async () => {
    // Status transitions never write support_ticket_messages rows, so a ticket
    // that only changed status has nothing to count.
    tickets.push({ id: "t1", merchant_id: "merchant-a", merchant_last_read_at: null })

    const unread = await getMerchantSupportUnread("merchant-a")
    expect(unread.totalUnread).toBe(0)
  })

  it("clears only the messages the merchant actually viewed", async () => {
    tickets.push({ id: "t1", merchant_id: "merchant-a", merchant_last_read_at: null })
    messages.push(
      { id: "m1", ticket_id: "t1", merchant_id: "merchant-a", sender_type: "pinetree", created_at: "2026-07-30T10:00:00Z" },
      { id: "m2", ticket_id: "t1", merchant_id: "merchant-a", sender_type: "pinetree", created_at: "2026-07-30T10:05:00Z" }
    )

    expect((await getMerchantSupportUnread("merchant-a")).totalUnread).toBe(2)

    // Merchant opened the thread when only m1 existed.
    await markSupportTicketRead({
      merchantId: "merchant-a",
      ticketId: "t1",
      lastMessageId: "m1",
    })

    const afterView = await getMerchantSupportUnread("merchant-a")
    expect(afterView.totalUnread).toBe(1)
    expect(afterView.tickets[0].ticketId).toBe("t1")
  })

  it("keeps a reply that arrives while the thread is open unread", async () => {
    tickets.push({ id: "t1", merchant_id: "merchant-a", merchant_last_read_at: null })
    messages.push({
      id: "m1",
      ticket_id: "t1",
      merchant_id: "merchant-a",
      sender_type: "pinetree",
      created_at: "2026-07-30T10:00:00Z",
    })

    // The merchant sees m1 …
    const viewed = "m1"
    // … and a new reply lands before the mark-read request is processed.
    messages.push({
      id: "m2",
      ticket_id: "t1",
      merchant_id: "merchant-a",
      sender_type: "pinetree",
      created_at: "2026-07-30T10:00:30Z",
    })

    await markSupportTicketRead({ merchantId: "merchant-a", ticketId: "t1", lastMessageId: viewed })

    const unread = await getMerchantSupportUnread("merchant-a")
    expect(unread.totalUnread).toBe(1)
  })

  it("never moves the read boundary backwards", async () => {
    tickets.push({ id: "t1", merchant_id: "merchant-a", merchant_last_read_at: null })
    messages.push(
      { id: "m1", ticket_id: "t1", merchant_id: "merchant-a", sender_type: "pinetree", created_at: "2026-07-30T10:00:00Z" },
      { id: "m2", ticket_id: "t1", merchant_id: "merchant-a", sender_type: "pinetree", created_at: "2026-07-30T11:00:00Z" }
    )

    await markSupportTicketRead({ merchantId: "merchant-a", ticketId: "t1", lastMessageId: "m2" })
    expect((await getMerchantSupportUnread("merchant-a")).totalUnread).toBe(0)

    const replay = await markSupportTicketRead({
      merchantId: "merchant-a",
      ticketId: "t1",
      lastMessageId: "m1",
    })

    expect(replay.advanced).toBe(false)
    expect((await getMerchantSupportUnread("merchant-a")).totalUnread).toBe(0)
  })

  it("leaves the boundary untouched when the thread has no support replies", async () => {
    tickets.push({ id: "t1", merchant_id: "merchant-a", merchant_last_read_at: null })

    const result = await markSupportTicketRead({
      merchantId: "merchant-a",
      ticketId: "t1",
      lastMessageId: null,
    })

    expect(result.advanced).toBe(false)
    expect(tickets[0].merchant_last_read_at).toBeNull()
  })

  it("prevents one merchant from viewing or clearing another merchant's messages", async () => {
    tickets.push(
      { id: "t1", merchant_id: "merchant-a", merchant_last_read_at: null },
      { id: "t2", merchant_id: "merchant-b", merchant_last_read_at: null }
    )
    messages.push({
      id: "m1",
      ticket_id: "t2",
      merchant_id: "merchant-b",
      sender_type: "pinetree",
      created_at: "2026-07-30T10:00:00Z",
    })

    // merchant-a sees nothing from merchant-b's ticket.
    expect((await getMerchantSupportUnread("merchant-a")).totalUnread).toBe(0)
    expect((await getMerchantSupportUnread("merchant-b")).totalUnread).toBe(1)

    // …and cannot clear it.
    await expect(
      markSupportTicketRead({ merchantId: "merchant-a", ticketId: "t2", lastMessageId: "m1" })
    ).rejects.toThrow("Ticket not found")

    expect((await getMerchantSupportUnread("merchant-b")).totalUnread).toBe(1)
  })

  it("ignores support messages whose ticket is outside the merchant's ticket set", () => {
    const unread = computeSupportUnread(
      [{ id: "m1", ticket_id: "unknown-ticket", created_at: "2026-07-30T10:00:00Z" }],
      [{ id: "t1", merchant_last_read_at: null }]
    )

    expect(unread.totalUnread).toBe(0)
  })

  it("reports a later support reply as newly unread after a clean read", async () => {
    tickets.push({ id: "t1", merchant_id: "merchant-a", merchant_last_read_at: null })
    messages.push({
      id: "m1",
      ticket_id: "t1",
      merchant_id: "merchant-a",
      sender_type: "pinetree",
      created_at: "2026-07-30T10:00:00Z",
    })

    await markSupportTicketRead({ merchantId: "merchant-a", ticketId: "t1", lastMessageId: "m1" })
    expect((await getMerchantSupportUnread("merchant-a")).totalUnread).toBe(0)

    messages.push({
      id: "m2",
      ticket_id: "t1",
      merchant_id: "merchant-a",
      sender_type: "pinetree",
      created_at: "2026-07-30T12:00:00Z",
    })

    expect((await getMerchantSupportUnread("merchant-a")).totalUnread).toBe(1)
  })
})

describe("unread support API authorization contract", () => {
  it("resolves the merchant from the verified session, never from the client", () => {
    const unreadRoute = read("app/api/support/unread/route.ts")
    const readRoute = read("app/api/support/tickets/[ticketId]/read/route.ts")

    for (const route of [unreadRoute, readRoute]) {
      expect(route).toContain("requireMerchantIdFromRequest(req)")
      expect(route).not.toContain("body.merchantId")
      expect(route).not.toContain("searchParams.get(\"merchantId\")")
    }

    // Mutations stay server-side: the read route posts through the engine.
    expect(readRoute).toContain("markSupportTicketRead")
    expect(readRoute).toContain("@/engine/support/supportUnread")
  })

  it("scopes every unread query by merchant in the database layer", () => {
    const db = read("database/supportTickets.ts")

    const unreadQuery = db.slice(
      db.indexOf("getSupportMessagesFromSupportForMerchant"),
      db.indexOf("getSupportTicketMessageForMerchant")
    )
    expect(unreadQuery).toContain('.eq("merchant_id", merchantId)')
    expect(unreadQuery).toContain('.eq("sender_type", "pinetree")')

    const boundaryUpdate = db.slice(
      db.indexOf("updateSupportTicketMerchantReadBoundary"),
      db.indexOf("export async function updateSupportTicketStatus")
    )
    expect(boundaryUpdate).toContain('.eq("id", ticketId)')
    expect(boundaryUpdate).toContain('.eq("merchant_id", merchantId)')
  })
})

describe("merchant unread navigation badge", () => {
  it("renders the Help Center badge in the shared sidebar/drawer navigation", () => {
    const layout = read("app/dashboard/layout.tsx")

    expect(layout).toContain("useMerchantSupportUnread")
    expect(layout).toContain("NotificationBadge")
    expect(layout).toContain('{ name: "Help Center", href: "/dashboard/help", unreadCount: supportUnread.totalUnread }')
    // The sidebar element is shared between desktop and the mobile drawer, so
    // one badge covers both surfaces.
    expect(layout).toContain("item.unreadCount ?? 0")
  })

  it("clamps large counts instead of stretching the nav row", async () => {
    const { formatUnreadBadgeCount } = await import("@/lib/support/supportUnreadClient")
    expect(formatUnreadBadgeCount(0)).toBe("")
    expect(formatUnreadBadgeCount(3)).toBe("3")
    expect(formatUnreadBadgeCount(42)).toBe("42")
    expect(formatUnreadBadgeCount(120)).toBe("99+")
  })

  it("clears unread state only through an explicit server mark-read", () => {
    const client = read("lib/support/supportUnreadClient.ts")

    expect(client).toContain("/api/support/tickets/")
    expect(client).toContain("/read")
    // No local-only clearing: sign-in and drawer state cannot zero the badge.
    // (The words appear in the module docs; what matters is that no storage API
    // is actually read or written.)
    expect(client).not.toMatch(/(window\.)?localStorage\s*[.[]/)
    expect(client).not.toMatch(/(window\.)?sessionStorage\s*[.[]/)
  })

  it("marks read from the newest support message the Help Center actually rendered", () => {
    const help = read("app/dashboard/help/page.tsx")

    expect(help).toContain("markSupportTicketRead(ticketId, newestSupportMessageId)")
    expect(help).toContain('message.sender_type === "pinetree"')
    expect(help).toContain("supportUnread.byTicketId[ticket.id]")
  })

  it("avoids high-frequency polling for the badge", async () => {
    const hook = read("hooks/useMerchantSupportUnread.ts")
    const heartbeat = hook.match(/const HEARTBEAT_MS = ([\d_]+)/)?.[1]
    expect(heartbeat).toBeTruthy()
    expect(Number(String(heartbeat).replace(/_/g, ""))).toBeGreaterThanOrEqual(60_000)
  })
})
