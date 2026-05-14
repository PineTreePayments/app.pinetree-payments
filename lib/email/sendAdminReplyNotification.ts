import { Resend } from "resend"
import type { SupportTicketRecord } from "@/database/supportTickets"

const DEFAULT_FROM_EMAIL = "PineTree Support <support@pinetree-payments.com>"

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export async function sendAdminReplyNotification(
  ticket: SupportTicketRecord,
  replyMessage: string
): Promise<{ sent: boolean; warning?: string }> {
  if (!ticket.merchant_email) {
    return { sent: false, warning: "No merchant email on file — reply saved but not emailed." }
  }

  const apiKey = String(process.env.RESEND_API_KEY || "").trim()
  const from = String(process.env.PINETREE_FROM_EMAIL || "").trim() || DEFAULT_FROM_EMAIL

  if (!apiKey) {
    return { sent: false, warning: "Email not configured — reply saved but not emailed." }
  }

  const subject = `PineTree Support replied to your ticket: ${ticket.subject}`
  const statusLabel = ticket.status.replace(/_/g, " ")

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f4f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;box-shadow:0 18px 50px rgba(15,23,42,0.10);">
            <tr>
              <td style="background:#0052FF;padding:22px 28px;">
                <div style="font-size:18px;font-weight:800;color:#ffffff;">PineTree Support</div>
                <div style="margin-top:4px;font-size:12px;font-weight:600;color:rgba(255,255,255,0.75);">Reply to your support ticket</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef2f7;border-radius:12px;overflow:hidden;border-collapse:separate;border-spacing:0;">
                  <tr>
                    <td style="padding:8px 12px;border-bottom:1px solid #eef2f7;color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;width:130px;">Ticket</td>
                    <td style="padding:8px 12px;border-bottom:1px solid #eef2f7;color:#0f172a;font-size:14px;">${escapeHtml(ticket.subject)}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 12px;color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">Status</td>
                    <td style="padding:8px 12px;color:#0f172a;font-size:14px;text-transform:capitalize;">${escapeHtml(statusLabel)}</td>
                  </tr>
                </table>
                <div style="margin-top:18px;">
                  <div style="margin-bottom:8px;color:#0052FF;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;">Reply from PineTree Support</div>
                  <div style="white-space:pre-wrap;border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc;padding:14px 16px;color:#111827;font-size:14px;line-height:1.6;">${escapeHtml(replyMessage)}</div>
                </div>
                <div style="margin-top:18px;padding:12px 14px;background:#eff6ff;border:1px solid #dbeafe;border-radius:10px;color:#1d4ed8;font-size:12px;line-height:1.55;">
                  You can view the full conversation thread in the <strong>Help Center</strong> section of your PineTree dashboard.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from,
    to: ticket.merchant_email,
    subject,
    html,
  })

  if (error) {
    return { sent: false, warning: `Email failed: ${error.message}` }
  }

  return { sent: true }
}
