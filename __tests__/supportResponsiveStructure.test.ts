import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

const adminModal = read("components/admin/AdminSupportTicketModal.tsx")
const help = read("app/dashboard/help/page.tsx")
const layout = read("app/dashboard/layout.tsx")

describe("support surfaces stay responsive", () => {
  it("uses 100dvh sheets rather than an unreliable fixed 100vh", () => {
    for (const [name, source] of [["admin modal", adminModal], ["help center", help]] as const) {
      expect(source, name).toContain("100dvh")
      expect(source, name).not.toContain("h-[100vh]")
    }
  })

  it("keeps the admin modal header and composer outside the scrolling region", () => {
    const dialog = adminModal.slice(adminModal.indexOf('role="dialog"'))
    // Exactly one flexible child: the conversation.
    const flexibleChildren = dialog.match(/min-h-0 flex-1/g) ?? []
    expect(flexibleChildren).toHaveLength(1)
    expect(dialog).toContain("flex h-[100dvh]")
    expect(dialog).toContain("overflow-hidden")
    // Composer clears the mobile safe area so it is not hidden behind system UI.
    expect(dialog).toContain("pb-[calc(0.75rem+env(safe-area-inset-bottom))]")
  })

  it("scrolls the status row horizontally on very narrow screens instead of wrapping tall", () => {
    const statusRow = adminModal.slice(
      adminModal.indexOf('aria-label="Set ticket status"'),
      adminModal.indexOf("ref={conversationRef}")
    )
    expect(statusRow).toContain("overflow-x-auto")
    expect(statusRow).toContain("[&::-webkit-scrollbar]:hidden")
  })

  it("keeps admin tables and filter rows from forcing horizontal body scroll", () => {
    const transactions = read("app/dashboard/admin/transactions/page.tsx")
    expect(transactions).toContain("overflow-hidden rounded-2xl")
    // Row grids collapse to a stacked layout below sm rather than shrinking text.
    expect(transactions).toContain("sm:grid sm:grid-cols-")
    expect(transactions).not.toContain("text-[9px]")
  })

  it("renders the unread badge legibly at small sizes without stretching rows", () => {
    const badge = read("components/ui/NotificationBadge.tsx")
    expect(badge).toContain("min-w-5")
    expect(badge).toContain("shrink-0")
    expect(badge).toContain("text-[11px]")
    expect(layout).toContain("min-w-0 flex-1 truncate")
  })
})

describe("merchant help center support display", () => {
  it("formats every ticket enum through the shared formatter", () => {
    expect(help).toContain('from "@/lib/support/supportDisplay"')
    expect(help).toContain("formatSupportCategory(ticket.category)")
    expect(help).toContain("formatSupportPriority(ticket.priority)")
    expect(help).not.toContain("{ticket.category} · {ticket.priority}")
    expect(help).not.toContain("ticketFilter.toLowerCase()")
  })

  it("marks unread threads visually and clears them after viewing", () => {
    expect(help).toContain("NotificationBadge")
    expect(help).toContain("new replies from PineTree Support")
    expect(help).toContain('unreadCount > 0 ? "font-bold" : "font-semibold"')
    expect(help).toContain("markSupportTicketRead")
  })

  it("keeps the merchant reply field reachable in the ticket modal", () => {
    const modal = help.slice(help.indexOf("function TicketDetailModal"))
    expect(modal).toContain('role="dialog"')
    expect(modal).toContain('aria-modal="true"')
    expect(modal).toContain("flex-1 overflow-y-auto")
    expect(modal).toContain("Add a follow-up message")
  })
})
