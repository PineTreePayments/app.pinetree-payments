import { Resend } from "resend"
import type { MerchantFeedbackRecord } from "@/database/feedback"
import type { SupportTicketRecord } from "@/database/supportTickets"

const DEFAULT_FROM_EMAIL = "PineTree Support <support@pinetree-payments.com>"

export type SupportNotificationResult = {
  sent: boolean
  warning?: string
  emailId?: string
}

function getSupportEmailConfig() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim()
  const to = String(process.env.PINETREE_SUPPORT_EMAIL || "").trim()
  const from = String(process.env.PINETREE_FROM_EMAIL || "").trim() || DEFAULT_FROM_EMAIL

  if (!apiKey || !to) {
    return {
      configured: false as const,
      warning: "Saved, but email notifications are not configured."
    }
  }

  return {
    configured: true as const,
    apiKey,
    to,
    from
  }
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function field(label: string, value: string | number | null | undefined) {
  const displayValue = value === null || value === undefined || value === "" ? "Not provided" : value
  return `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eef2f7;color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;width:170px;">${escapeHtml(label)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eef2f7;color:#0f172a;font-size:14px;line-height:1.5;">${escapeHtml(displayValue)}</td>
    </tr>
  `
}

function buildShell(
  title: string,
  rows: string,
  messageLabel: string,
  message: string,
  footerNote?: string
) {
  const noteSection = footerNote
    ? `<div style="margin-top:14px;padding:12px 14px;background:#fffbeb;border:1px solid #fef3c7;border-radius:10px;color:#92400e;font-size:12px;line-height:1.55;"><strong>Note:</strong> ${escapeHtml(footerNote)}</div>`
    : ""

  return `<!doctype html>
<html>
  <body style="margin:0;background:#f4f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;box-shadow:0 18px 50px rgba(15,23,42,0.10);">
            <tr>
              <td style="background:#0052FF;padding:22px 28px;">
                <div style="font-size:18px;font-weight:800;color:#ffffff;">${escapeHtml(title)}</div>
                <div style="margin-top:4px;font-size:12px;font-weight:600;color:rgba(255,255,255,0.75);">PineTree Help Center</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef2f7;border-radius:12px;overflow:hidden;border-collapse:separate;border-spacing:0;">
                  ${rows}
                </table>
                <div style="margin-top:18px;">
                  <div style="margin-bottom:8px;color:#0052FF;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(messageLabel)}</div>
                  <div style="white-space:pre-wrap;border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc;padding:14px 16px;color:#111827;font-size:14px;line-height:1.6;">${escapeHtml(message)}</div>
                </div>
                ${noteSection}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

export async function sendSupportTicketNotification(
  ticket: SupportTicketRecord
): Promise<SupportNotificationResult> {
  const config = getSupportEmailConfig()

  if (!config.configured) {
    return { sent: false, warning: config.warning }
  }

  const subject = `New PineTree Support Ticket: ${ticket.subject}`
  const rows = [
    field("Ticket ID", ticket.id),
    field("Merchant ID", ticket.merchant_id),
    field("Business Name", ticket.merchant_business_name),
    field("Merchant Email", ticket.merchant_email),
    field("Category", ticket.category),
    field("Priority", ticket.priority),
    field("Subject", ticket.subject),
    field("Related Payment ID", ticket.related_payment_id),
    field("Created At", ticket.created_at)
  ].join("")

  const replyNote =
    "Reply-to is set to the merchant email for human follow-up only. " +
    "Replying to this email does not automatically update the ticket thread. " +
    "Ticket-thread replies require the admin dashboard or an inbound email webhook."

  const html = buildShell(subject, rows, "Description", ticket.description, replyNote)

  const resend = new Resend(config.apiKey)

  const sendOptions: Parameters<typeof resend.emails.send>[0] = {
    from: config.from,
    to: config.to,
    subject,
    html
  }

  if (ticket.merchant_email) {
    sendOptions.replyTo = ticket.merchant_email
  }

  const { data, error } = await resend.emails.send(sendOptions)

  if (error) {
    throw new Error(`Email notification failed: ${error.message}`)
  }

  return { sent: true, emailId: data?.id ?? "" }
}

export async function sendFeedbackNotification(
  feedback: MerchantFeedbackRecord
): Promise<SupportNotificationResult> {
  const config = getSupportEmailConfig()

  if (!config.configured) {
    return { sent: false, warning: config.warning }
  }

  const subject = `New PineTree Feedback: ${feedback.type}`
  const rows = [
    field("Feedback ID", feedback.id),
    field("Merchant ID", feedback.merchant_id),
    field("Type", feedback.type),
    field("Rating", feedback.rating),
    field("Created At", feedback.created_at)
  ].join("")

  const html = buildShell(subject, rows, "Message", feedback.message)

  const resend = new Resend(config.apiKey)
  const { data, error } = await resend.emails.send({
    from: config.from,
    to: config.to,
    subject,
    html
  })

  if (error) {
    throw new Error(`Email notification failed: ${error.message}`)
  }

  return { sent: true, emailId: data?.id ?? "" }
}
