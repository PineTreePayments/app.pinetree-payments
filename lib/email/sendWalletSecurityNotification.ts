import { Resend } from "resend"

const DEFAULT_FROM_EMAIL = "PineTree Wallet <security@pinetree-payments.com>"

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export type WalletSecurityNotificationKind =
  | "destination_added"
  | "destination_updated"
  | "destination_archived"
  | "withdrawal_submitted"

export type WalletSecurityNotificationInput = {
  merchantEmail: string | null
  kind: WalletSecurityNotificationKind
  summary: string
  details: Array<{ label: string; value: string }>
}

const TITLES: Record<WalletSecurityNotificationKind, string> = {
  destination_added: "A new withdrawal destination was added",
  destination_updated: "A withdrawal destination was updated",
  destination_archived: "A withdrawal destination was archived",
  withdrawal_submitted: "A withdrawal was submitted",
}

/**
 * Best-effort security notification for wallet-affecting actions (address
 * book changes, withdrawal submissions). Mirrors
 * lib/email/sendAdminReplyNotification.ts's pattern exactly: direct Resend
 * instantiation, inline HTML, graceful no-op (never throws) if email isn't
 * configured or the merchant has no email on file - this is a notification,
 * not a step-up authentication mechanism (this repo has no real 2FA/reauth
 * system; see docs/environment/wallet-sweep-env-checklist.md).
 */
export async function sendWalletSecurityNotification(
  input: WalletSecurityNotificationInput
): Promise<{ sent: boolean; warning?: string }> {
  if (!input.merchantEmail) {
    return { sent: false, warning: "No merchant email on file — action recorded but not emailed." }
  }

  const apiKey = String(process.env.RESEND_API_KEY || "").trim()
  const from = String(process.env.PINETREE_FROM_EMAIL || "").trim() || DEFAULT_FROM_EMAIL

  if (!apiKey) {
    return { sent: false, warning: "Email not configured — action recorded but not emailed." }
  }

  const title = TITLES[input.kind]
  const subject = `PineTree Wallet: ${title}`
  const rows = input.details
    .map(
      (row) => `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eef2f7;color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;width:140px;">${escapeHtml(row.label)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eef2f7;color:#0f172a;font-size:14px;">${escapeHtml(row.value)}</td>
      </tr>`
    )
    .join("")

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f4f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;box-shadow:0 18px 50px rgba(15,23,42,0.10);">
            <tr>
              <td style="background:#0052FF;padding:22px 28px;">
                <div style="font-size:18px;font-weight:800;color:#ffffff;">PineTree Wallet</div>
                <div style="margin-top:4px;font-size:12px;font-weight:600;color:rgba(255,255,255,0.75);">${escapeHtml(title)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 16px;color:#0f172a;font-size:14px;line-height:1.6;">${escapeHtml(input.summary)}</p>
                <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef2f7;border-radius:12px;overflow:hidden;border-collapse:separate;border-spacing:0;">
                  ${rows}
                </table>
                <div style="margin-top:18px;padding:12px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;color:#b91c1c;font-size:12px;line-height:1.55;">
                  If you didn't make this change, review your PineTree Wallet activity immediately and contact support.
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
    to: input.merchantEmail,
    subject,
    html,
  })

  if (error) {
    return { sent: false, warning: `Email failed: ${error.message}` }
  }

  return { sent: true }
}
