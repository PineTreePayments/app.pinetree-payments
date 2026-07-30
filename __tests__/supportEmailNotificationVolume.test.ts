import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  supportTicketThreadMessageId,
  supportTicketThreadSubject,
} from "@/lib/email/sendSupportNotification"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

const emailModule = read("lib/email/sendSupportNotification.ts")
const newTicketRoute = read("app/api/support/tickets/route.ts")
const merchantMessageRoute = read("app/api/support/tickets/[ticketId]/messages/route.ts")
const adminReplyRoute = read("app/api/admin/support/tickets/[ticketId]/reply/route.ts")

describe("support email volume", () => {
  it("sends exactly one staff email when a merchant opens a ticket", () => {
    expect(newTicketRoute).toContain("sendSupportTicketNotification(ticket)")
    expect(newTicketRoute.match(/sendSupportTicketNotification\(/g)).toHaveLength(1)
    expect(newTicketRoute).not.toContain("sendMerchantReplyThreadNotification")
  })

  it("sends no email at all when PineTree Support replies", () => {
    // No mailer import, no mailer call, no transport instantiated. (The route's
    // doc comment names Resend and SMTP to say it deliberately uses neither, so
    // these assertions target code shapes rather than the words.)
    expect(adminReplyRoute).not.toContain("@/lib/email/")
    expect(adminReplyRoute).not.toMatch(/send[A-Za-z]*Notification\s*\(/)
    expect(adminReplyRoute).not.toMatch(/new Resend\s*\(/)
    expect(adminReplyRoute).not.toMatch(/emails\.send\s*\(/)
    expect(adminReplyRoute).not.toMatch(/from ["']resend["']/)
    expect(adminReplyRoute).not.toMatch(/nodemailer|createTransport/)
    // The removed merchant-facing reply mailer is gone from the repo entirely.
    expect(fs.existsSync(path.join(process.cwd(), "lib/email/sendAdminReplyNotification.ts"))).toBe(
      false
    )
  })

  it("appends merchant follow-ups to the ticket's existing thread", () => {
    expect(merchantMessageRoute).toContain("sendMerchantReplyThreadNotification")
    expect(merchantMessageRoute.match(/sendMerchantReplyThreadNotification\(/g)).toHaveLength(1)
    // Never a brand new ticket email per reply.
    expect(merchantMessageRoute).not.toContain("sendSupportTicketNotification")
  })

  it("never blocks a saved merchant message on the notification", () => {
    const handler = merchantMessageRoute.slice(merchantMessageRoute.indexOf("export async function POST"))
    const createIndex = handler.indexOf("createSupportTicketMessageForMerchant({")
    const notifyIndex = handler.indexOf("sendMerchantReplyThreadNotification")
    expect(createIndex).toBeGreaterThan(-1)
    expect(notifyIndex).toBeGreaterThan(createIndex)
    expect(handler.slice(notifyIndex)).toContain("catch (emailError)")
  })
})

describe("support email threading", () => {
  it("derives a stable per-ticket thread id with no stored state", () => {
    const id = "6f1c0f2a-1111-4222-8333-444455556666"
    expect(supportTicketThreadMessageId(id)).toBe(
      `<pinetree-ticket-${id}@pinetree-payments.com>`
    )
    // Same ticket always resolves to the same thread.
    expect(supportTicketThreadMessageId(id)).toBe(supportTicketThreadMessageId(` ${id} `))
    // Different tickets never share a thread.
    expect(supportTicketThreadMessageId("a")).not.toBe(supportTicketThreadMessageId("b"))
  })

  it("keeps one subject per ticket, with follow-ups as Re: on the same subject", () => {
    const subject = supportTicketThreadSubject({ subject: "Payout did not arrive" })
    expect(subject).toBe("New PineTree Support Ticket: Payout did not arrive")
    expect(emailModule).toContain("`Re: ${supportTicketThreadSubject(ticket)}`")
  })

  it("sets RFC 5322 threading headers on both the opening mail and follow-ups", () => {
    expect(emailModule).toContain('"Message-ID": messageId')
    expect(emailModule).toContain('"In-Reply-To": messageId')
    expect(emailModule).toContain("References: messageId")
    expect(emailModule).toContain('"X-Entity-Ref-ID": ticketId')
    expect(emailModule).toContain('headers: threadHeaders(ticket.id, "opening")')
    expect(emailModule).toContain('headers: threadHeaders(ticket.id, "follow_up")')
  })

  it("keeps the conversation itself inside PineTree", () => {
    // Only three outbound support mailers exist: new ticket, merchant follow-up,
    // and merchant feedback. Nothing mirrors PineTree Support's own replies.
    const exportedSenders = emailModule.match(/export async function send\w+/g) ?? []
    expect(exportedSenders.sort()).toEqual([
      "export async function sendFeedbackNotification",
      "export async function sendMerchantReplyThreadNotification",
      "export async function sendSupportTicketNotification",
    ])
  })
})
