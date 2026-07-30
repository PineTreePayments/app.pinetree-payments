import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

const panel = read("components/admin/AdminSupportTicketPanel.tsx")
const adminPage = read("app/dashboard/admin/page.tsx")

describe("admin support ticket panel structure", () => {
  it("is one shared component the admin page renders, not inline panel markup", () => {
    expect(adminPage).toContain("AdminSupportTicketPanel")
    expect(adminPage).toContain('from "@/components/admin/AdminSupportTicketPanel"')
    // The page owns no ticket-panel markup of its own.
    expect(adminPage).not.toContain("Reply as PineTree Support")
    expect(adminPage).not.toContain('aria-label="Set ticket status"')
  })

  it("is a right-side slide-over matching the Platform Transaction Detail panel", () => {
    const transactionPanel = read("app/dashboard/admin/transactions/page.tsx")

    // Same shell geometry and chrome as the transaction detail drawer.
    expect(panel).toContain("fixed inset-y-0 right-0 z-50 flex")
    expect(panel).toContain("flex-col bg-white shadow-2xl")
    expect(panel).toContain("pinetree-modal-backdrop fixed inset-0 z-40")
    expect(transactionPanel).toContain("fixed inset-y-0 right-0 z-50 flex")
    expect(transactionPanel).toContain("pinetree-modal-backdrop fixed inset-0 z-40")

    // Not a centered floating modal, and not a full page replacement.
    expect(panel).not.toContain("sm:max-w-3xl")
    expect(panel).not.toContain("items-center justify-center sm:p-4")
    expect(panel).not.toContain("rounded-t-[1.35rem]")
  })

  it("lays the panel out in the required section order", () => {
    const order = [
      'id="admin-ticket-title"', // ticket header
      "supportStatusPillClass(ticket.status)", // status pills
      "Merchant Email", // merchant information
      'aria-label="Set ticket status"', // status workflow
      'aria-label="Ticket conversation"', // conversation history
      'htmlFor="admin-ticket-reply"', // reply box
      'aria-label="Send reply"', // send reply
    ].map((marker) => ({ marker, index: panel.indexOf(marker) }))

    for (const { marker, index } of order) {
      expect(index, marker).toBeGreaterThan(-1)
    }
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i].index, order[i].marker).toBeGreaterThan(order[i - 1].index)
    }

    // The original ticket leads the conversation region so the whole exchange
    // reads top to bottom in one scroll container.
    const conversation = panel.slice(
      panel.indexOf('aria-label="Ticket conversation"'),
      panel.indexOf("{/* ── Reply box")
    )
    expect(conversation).toContain("Original Ticket")
    expect(conversation.indexOf("Original Ticket")).toBeLessThan(
      conversation.indexOf("formatSupportSenderLabel")
    )
  })

  it("collapses ticket details by default at every breakpoint", () => {
    expect(panel).toContain("const [detailsOpen, setDetailsOpen] = useState(false)")
    expect(panel).toContain("View Ticket Details")
    // No breakpoint-conditional default that would expand details on desktop.
    expect(panel).not.toMatch(/useState\(\s*(window|isDesktop|matchMedia)/)
  })

  it("exposes the disclosure with aria-expanded and a controlled panel", () => {
    expect(panel).toContain("aria-expanded={detailsOpen}")
    expect(panel).toContain('aria-controls="admin-ticket-details"')
    expect(panel).toContain('id="admin-ticket-details"')
    expect(panel).toContain("setDetailsOpen((open) => !open)")
  })

  it("keeps every ticket detail field available inside the disclosure", () => {
    const details = panel.slice(
      panel.indexOf('id="admin-ticket-details"'),
      panel.indexOf("Status workflow")
    )
    for (const label of [
      "Ticket ID",
      "Merchant Email",
      "Business Name",
      "Merchant ID",
      "Created",
      "Last Response",
      "Resolved",
      "Archived",
      "Related Payment",
    ]) {
      expect(details).toContain(label)
    }
  })

  it("gives the conversation the flexible height and its own scroll container", () => {
    const conversation = panel.slice(
      panel.indexOf("ref={conversationRef}"),
      panel.indexOf("{/* ── Reply box")
    )
    expect(conversation).toContain("min-h-0 flex-1")
    expect(conversation).toContain("overflow-y-auto")
    // Header, disclosure, status row and reply box never take flexible height,
    // so the message history absorbs every remaining pixel.
    const flexNoneCount = panel.match(/flex-none border/g)?.length ?? 0
    expect(flexNoneCount).toBeGreaterThanOrEqual(4)
    expect(panel.match(/min-h-0 flex-1/g)).toHaveLength(1)
  })

  it("scrolls to the newest message on open without hijacking a reader scrolled up", () => {
    expect(panel).toContain("container.scrollTop = container.scrollHeight")
    expect(panel).toContain("autoScrollRef")
    expect(panel).toContain("distanceFromBottom")
  })

  it("uses a full-height dvh panel rather than an unreliable fixed 100vh", () => {
    expect(panel).toContain("h-[100dvh]")
    expect(panel).toContain("max-h-[100dvh]")
    expect(panel).not.toContain("h-[100vh]")
    // Full width on mobile, drawer width from sm up.
    expect(panel).toContain("w-full flex-col")
    expect(panel).toContain("sm:w-[600px] lg:w-[680px]")
  })

  it("keeps one status control system and no duplicate composer status dropdown", () => {
    expect(panel).toContain('aria-label="Set ticket status"')
    expect(panel).toContain("SUPPORT_TICKET_STATUSES.map")

    const composer = panel.slice(panel.indexOf("Composer"))
    expect(composer).not.toContain("<select")
    // The whole modal has no <select> at all — status is the segmented row.
    expect(panel).not.toContain("<select")
    expect(adminPage).not.toContain("replyStatus")
  })

  it("renders every status action with a proper title-cased label", () => {
    expect(panel).toContain("formatSupportStatus(status)")
    expect(panel).not.toContain('label: "Waiting on Merchant"')
    expect(panel).toContain('aria-pressed={active}')
  })

  it("keeps a materially taller composer that grows to a bounded maximum", () => {
    expect(panel).toContain("const COMPOSER_MIN_HEIGHT = 104")
    expect(panel).toContain("const COMPOSER_MAX_HEIGHT = 240")
    expect(panel).toContain("min-h-[104px]")
    expect(panel).toContain("textarea.style.height")
    // The old fixed three-row textarea is gone.
    expect(panel).not.toContain("rows={3}")
  })

  it("disables duplicate submission and shows a sending state", () => {
    expect(panel).toContain("if (!text || sending) return")
    expect(panel).toContain("disabled={sending || !draft.trim()}")
    expect(panel).toContain('{sending ? "Sending…" : "Send Reply"}')
  })

  it("preserves the draft on failure and clears it only after success", () => {
    const handler = panel.slice(
      panel.indexOf("async function handleSend"),
      panel.indexOf('data-pinetree-overlay="true"')
    )

    const successClear = handler.indexOf('setDraft("")')
    const awaitSend = handler.indexOf("await onSendReply(text)")
    expect(awaitSend).toBeGreaterThan(-1)
    expect(successClear).toBeGreaterThan(awaitSend)

    // The catch branch records an error and never touches the draft.
    const catchBlock = handler.slice(handler.indexOf("} catch (error) {"))
    expect(catchBlock).toContain("setSendError")
    expect(catchBlock).not.toContain("setDraft")
    expect(panel).toContain('role="alert"')
  })

  it("appends the confirmed reply instead of clearing state on an unverified send", () => {
    const sendReply = adminPage.slice(
      adminPage.indexOf("const sendReply = useCallback"),
      adminPage.indexOf("// ── Update status")
    )
    expect(sendReply).toContain("throw new Error(data?.error || \"Failed to send reply\")")
    expect(sendReply).toContain("[...prev.messages, data.message as Message]")
  })

  it("carries dialog semantics, focus trap, Escape and focus restoration", () => {
    expect(panel).toContain('role="dialog"')
    expect(panel).toContain('aria-modal="true"')
    expect(panel).toContain('aria-labelledby="admin-ticket-title"')
    expect(panel).toContain('id="admin-ticket-title"')
    expect(panel).toContain('if (event.key === "Escape")')
    expect(panel).toContain('if (event.key !== "Tab") return')
    expect(panel).toContain("returnFocusRef.current?.focus?.()")
    expect(panel).toContain('aria-label="Close ticket detail"')
    expect(panel).toContain('aria-label="Send reply"')
    // Message list stays keyboard reachable as a log region.
    expect(panel).toContain('role="log"')
    expect(panel).toContain("tabIndex={0}")
  })

  it("reuses the shared PineTree modal, button and pill atoms", () => {
    expect(panel).toContain("modalCloseButtonClass")
    expect(panel).toContain("primaryActionButtonClass")
    expect(panel).toContain("segmentedButtonClass")
    expect(panel).toContain('data-pinetree-overlay="true"')
    expect(panel).toContain("pinetree-modal-backdrop")
    expect(panel).toContain('from "@/lib/support/supportDisplay"')
  })
})

describe("admin support page cleanup", () => {
  it("uses the shared admin metric tile for the support status counts", () => {
    const supportTab = adminPage.slice(
      adminPage.indexOf('{activeTab === "support" && ('),
      adminPage.indexOf("FEEDBACK TAB")
    )
    expect(supportTab).toContain("CompactMetricTile")
    expect(supportTab).toContain("MetricGrid")
    expect(supportTab).toContain("formatSupportStatusShort(s.key)")
  })

  it("keeps all support filters and routes them through the shared filter controls", () => {
    const supportTab = adminPage.slice(
      adminPage.indexOf('{activeTab === "support" && ('),
      adminPage.indexOf("FEEDBACK TAB")
    )
    expect(supportTab).toContain("SegmentedButtons")
    expect(supportTab).toContain("filterSelectClass")
    expect(supportTab).toContain("filterSearchInputClass")
    expect(supportTab).toContain("filterIconButtonClass")
    expect(supportTab).toContain('aria-label="Refresh tickets"')
    expect(supportTab).toContain("All Priorities")
  })

  it("filters priority against the canonical stored lowercase values", () => {
    expect(adminPage).toContain('const PRIORITY_FILTERS = ["urgent", "high", "normal", "low"]')
    expect(adminPage).toContain("supportEnumEquals(t.priority, priorityFilter)")
    expect(adminPage).not.toContain('<option value="Urgent">')
  })

  it("renders status, priority and category through the shared formatter only", () => {
    expect(adminPage).toContain("formatSupportStatus(status)")
    expect(adminPage).toContain("formatSupportPriority(priority)")
    expect(adminPage).toContain("formatSupportCategory(ticket.category)")
    expect(adminPage).toContain("Ticket marked ${formatSupportStatus(status)}")
    // No hand-maintained label/style tables left behind.
    expect(adminPage).not.toContain("const STATUS_LABELS")
    expect(adminPage).not.toContain("const PRIORITY_STYLES")
    expect(adminPage).not.toContain("const ACTION_STATUSES")
  })
})
