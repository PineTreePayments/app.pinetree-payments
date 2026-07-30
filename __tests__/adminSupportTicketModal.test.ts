import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

const modal = read("components/admin/AdminSupportTicketModal.tsx")
const adminPage = read("app/dashboard/admin/page.tsx")

describe("admin support ticket modal structure", () => {
  it("is one shared component the admin page renders, not inline drawer markup", () => {
    expect(adminPage).toContain("AdminSupportTicketModal")
    expect(adminPage).toContain('from "@/components/admin/AdminSupportTicketModal"')
    // The old right-hand drawer that squeezed the thread is gone.
    expect(adminPage).not.toContain('sm:w-[600px] lg:w-[660px]')
    expect(adminPage).not.toContain("Reply as PineTree Support")
  })

  it("collapses ticket details by default at every breakpoint", () => {
    expect(modal).toContain("const [detailsOpen, setDetailsOpen] = useState(false)")
    expect(modal).toContain("View Ticket Details")
    // No breakpoint-conditional default that would expand details on desktop.
    expect(modal).not.toMatch(/useState\(\s*(window|isDesktop|matchMedia)/)
  })

  it("exposes the disclosure with aria-expanded and a controlled panel", () => {
    expect(modal).toContain("aria-expanded={detailsOpen}")
    expect(modal).toContain('aria-controls="admin-ticket-details"')
    expect(modal).toContain('id="admin-ticket-details"')
    expect(modal).toContain("setDetailsOpen((open) => !open)")
  })

  it("keeps every ticket detail field available inside the disclosure", () => {
    const details = modal.slice(
      modal.indexOf('id="admin-ticket-details"'),
      modal.indexOf("Status controls")
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
    const conversation = modal.slice(
      modal.indexOf("ref={conversationRef}"),
      modal.indexOf("{/* ── Composer")
    )
    expect(conversation).toContain("min-h-0 flex-1")
    expect(conversation).toContain("overflow-y-auto")
    // Header, disclosure, status row and composer never take flexible height.
    const shrinkCount = modal.match(/shrink-0 border/g)?.length ?? 0
    expect(shrinkCount).toBeGreaterThanOrEqual(3)
  })

  it("scrolls to the newest message on open without hijacking a reader scrolled up", () => {
    expect(modal).toContain("container.scrollTop = container.scrollHeight")
    expect(modal).toContain("autoScrollRef")
    expect(modal).toContain("distanceFromBottom")
  })

  it("uses 100dvh on mobile and a bounded height on desktop", () => {
    expect(modal).toContain("h-[100dvh]")
    expect(modal).toContain("max-h-[100dvh]")
    expect(modal).toContain("sm:h-[min(88dvh,900px)]")
    expect(modal).not.toContain("h-[100vh]")
  })

  it("keeps one status control system and no duplicate composer status dropdown", () => {
    expect(modal).toContain('aria-label="Set ticket status"')
    expect(modal).toContain("SUPPORT_TICKET_STATUSES.map")

    const composer = modal.slice(modal.indexOf("Composer"))
    expect(composer).not.toContain("<select")
    // The whole modal has no <select> at all — status is the segmented row.
    expect(modal).not.toContain("<select")
    expect(adminPage).not.toContain("replyStatus")
  })

  it("renders every status action with a proper title-cased label", () => {
    expect(modal).toContain("formatSupportStatus(status)")
    expect(modal).not.toContain('label: "Waiting on Merchant"')
    expect(modal).toContain('aria-pressed={active}')
  })

  it("keeps a materially taller composer that grows to a bounded maximum", () => {
    expect(modal).toContain("const COMPOSER_MIN_HEIGHT = 104")
    expect(modal).toContain("const COMPOSER_MAX_HEIGHT = 240")
    expect(modal).toContain("min-h-[104px]")
    expect(modal).toContain("textarea.style.height")
    // The old fixed three-row textarea is gone.
    expect(modal).not.toContain("rows={3}")
  })

  it("disables duplicate submission and shows a sending state", () => {
    expect(modal).toContain("if (!text || sending) return")
    expect(modal).toContain("disabled={sending || !draft.trim()}")
    expect(modal).toContain('{sending ? "Sending…" : "Send Reply"}')
  })

  it("preserves the draft on failure and clears it only after success", () => {
    const handler = modal.slice(
      modal.indexOf("async function handleSend"),
      modal.indexOf('data-pinetree-overlay="true"')
    )

    const successClear = handler.indexOf('setDraft("")')
    const awaitSend = handler.indexOf("await onSendReply(text)")
    expect(awaitSend).toBeGreaterThan(-1)
    expect(successClear).toBeGreaterThan(awaitSend)

    // The catch branch records an error and never touches the draft.
    const catchBlock = handler.slice(handler.indexOf("} catch (error) {"))
    expect(catchBlock).toContain("setSendError")
    expect(catchBlock).not.toContain("setDraft")
    expect(modal).toContain('role="alert"')
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
    expect(modal).toContain('role="dialog"')
    expect(modal).toContain('aria-modal="true"')
    expect(modal).toContain('aria-labelledby="admin-ticket-title"')
    expect(modal).toContain('id="admin-ticket-title"')
    expect(modal).toContain('if (event.key === "Escape")')
    expect(modal).toContain('if (event.key !== "Tab") return')
    expect(modal).toContain("returnFocusRef.current?.focus?.()")
    expect(modal).toContain('aria-label="Close ticket"')
    expect(modal).toContain('aria-label="Send reply"')
    // Message list stays keyboard reachable as a log region.
    expect(modal).toContain('role="log"')
    expect(modal).toContain("tabIndex={0}")
  })

  it("reuses the shared PineTree modal, button and pill atoms", () => {
    expect(modal).toContain("modalCloseButtonClass")
    expect(modal).toContain("primaryActionButtonClass")
    expect(modal).toContain("segmentedButtonClass")
    expect(modal).toContain('data-pinetree-overlay="true"')
    expect(modal).toContain("pinetree-modal-backdrop")
    expect(modal).toContain('from "@/lib/support/supportDisplay"')
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
