import {
  generateReportEngine,
  generateReportCsv,
  getReportFilename,
  normalizeReportType,
  type ReportInput,
  type ReportSummary
} from "./reports"
import { generateReportPdfFromSummary } from "./reportsPdf"
import { sendReportEmail } from "@/providers/email"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const REPORT_SUBJECT: Record<string, string> = {
  today: "PineTree Today's Report",
  yesterday: "PineTree Yesterday's Report",
  weekly: "PineTree Weekly Report",
  month: "PineTree Monthly Report",
  tax: "PineTree Tax Report",
  year: "PineTree Yearly Summary",
  transactions: "PineTree Transaction Export"
}

export type ReportEmailInput = ReportInput & {
  recipientEmail: string
}

export type ReportEmailResult = {
  success: true
  sentTo: string
  filename: string
  emailId: string
}

function currency(value: number) {
  return `$${value.toFixed(2)}`
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit"
  })
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  })
}

function buildInsightText(report: ReportSummary, isExport: boolean): string {
  if (isExport) {
    const n = report.transactionCount
    return `This export includes ${n} transaction${n !== 1 ? "s" : ""} for the selected period.`
  }
  const parts: string[] = []
  if (report.transactionCount > 0) {
    parts.push(
      `This report covers ${report.transactionCount} tracked transaction${report.transactionCount !== 1 ? "s" : ""} with a ${report.successRate}% success rate.`
    )
  }
  if (report.grossVolume > 0) {
    parts.push(
      `Gross volume for this period was ${currency(report.grossVolume)} with net settlements of ${currency(report.netSettlements)}.`
    )
  }
  return parts.length > 0
    ? parts.join(" ")
    : "No confirmed transactions were recorded in this report period."
}

function buildEmailHtml(report: ReportSummary, filename: string): string {
  const isExport = report.reportType === "transactions"

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${report.title}</title>
  <style type="text/css">
    /* Stack the two metric cards vertically on narrow screens.
       Apple Mail (WebKit), iOS Mail, and most modern clients honour this. */
    @media only screen and (max-width: 480px) {
      .pt-metric-col {
        display: block !important;
        width: 100% !important;
        padding-right: 0 !important;
      }
      .pt-metric-col + .pt-metric-col {
        padding-top: 10px !important;
      }
      .pt-metric-gap {
        display: none !important;
        width: 0 !important;
        max-width: 0 !important;
        overflow: hidden !important;
        mso-hide: all !important;
      }
      .pt-body {
        padding-left: 20px !important;
        padding-right: 20px !important;
      }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#0052FF;padding:28px 36px 24px;">
              <div style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">PineTree Payments</div>
              <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:4px;font-weight:500;">Financial Reporting</div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="pt-body" style="padding:36px 32px 28px;">

              <!-- Title block -->
              <h1 style="margin:0 0 6px;font-size:26px;font-weight:800;color:#0f1728;letter-spacing:-0.5px;">${report.title}</h1>
              <p style="margin:0 0 4px;font-size:14px;color:#6b7280;font-weight:500;">${report.merchant.name}</p>
              <p style="margin:0 0 28px;font-size:14px;color:#9ba3af;">
                ${formatDate(report.startDate)} &mdash; ${formatDate(report.endDate)}
              </p>

              ${isExport ? "" : `
              <!-- Key metrics: two cards side-by-side on desktop, stacked on mobile -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;border-collapse:collapse;">
                <tr>
                  <!-- Gross Volume card -->
                  <td class="pt-metric-col" valign="top" style="width:48%;padding:0;vertical-align:top;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:16px 18px;background:#eff6ff;border-radius:10px;border:1px solid #dbeafe;">
                          <div style="font-size:11px;font-weight:700;color:#3b82f6;text-transform:uppercase;letter-spacing:0.8px;">Gross Volume</div>
                          <div style="font-size:26px;font-weight:800;color:#0f1728;margin-top:6px;letter-spacing:-0.5px;">${currency(report.grossVolume)}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <!-- Gutter -->
                  <td class="pt-metric-gap" width="16" style="width:16px;min-width:16px;">&nbsp;</td>
                  <!-- Net Settlements card -->
                  <td class="pt-metric-col" valign="top" style="width:48%;padding:0;vertical-align:top;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:16px 18px;background:#f0fdf4;border-radius:10px;border:1px solid #d1fae5;">
                          <div style="font-size:11px;font-weight:700;color:#10b981;text-transform:uppercase;letter-spacing:0.8px;">Net Settlements</div>
                          <div style="font-size:26px;font-weight:800;color:#0f1728;margin-top:6px;letter-spacing:-0.5px;">${currency(report.netSettlements)}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Stats row -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="padding:14px 16px;border:1px solid #e5e7eb;border-radius:8px;text-align:center;">
                    <div style="font-size:11px;color:#9ba3af;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Transactions</div>
                    <div style="font-size:20px;font-weight:800;color:#0f1728;margin-top:4px;">${report.transactionCount}</div>
                  </td>
                  <td width="16"></td>
                  <td style="padding:14px 16px;border:1px solid #e5e7eb;border-radius:8px;text-align:center;">
                    <div style="font-size:11px;color:#9ba3af;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Success Rate</div>
                    <div style="font-size:20px;font-weight:800;color:#0f1728;margin-top:4px;">${report.successRate}%</div>
                  </td>
                </tr>
              </table>
              `}

              ${isExport ? `
              <!-- Export note -->
              <div style="background:#fafafa;border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;margin-bottom:28px;">
                <div style="font-size:13px;color:#6b7280;">This email contains a full CSV transaction export for the period <strong style="color:#0f1728;">${formatDate(report.startDate)} &mdash; ${formatDate(report.endDate)}</strong>. The export includes ${report.transactionCount} transaction${report.transactionCount !== 1 ? "s" : ""}.</div>
              </div>
              ` : ""}

              <!-- PineTree Insights -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:18px 20px;">
                    <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#0052FF;text-transform:uppercase;letter-spacing:1px;">PineTree Insights</p>
                    <p style="margin:0;font-size:13px;color:#374151;line-height:1.6;">${buildInsightText(report, isExport)}</p>
                  </td>
                </tr>
              </table>

              <!-- Generated at -->
              <p style="font-size:12px;color:#9ba3af;margin:0;">
                Generated ${formatDateTime(report.generatedAt)} &middot; PineTree Payments
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #f0f0f0;padding:20px 36px;">
              <p style="margin:0;font-size:12px;color:#9ba3af;text-align:center;">
                PineTree Payments &middot; Secure Financial Processing
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export async function emailReportEngine(input: ReportEmailInput): Promise<ReportEmailResult> {
  const recipientEmail = String(input.recipientEmail || "").trim().toLowerCase()
  if (!EMAIL_PATTERN.test(recipientEmail)) {
    throw Object.assign(new Error("Invalid recipient email address"), { status: 400 })
  }

  const reportType = normalizeReportType(input.type)
  const isCsv = reportType === "transactions"

  const report = await generateReportEngine(input)

  let attachmentContent: Buffer
  let attachmentFilename: string
  let contentType: string

  if (isCsv) {
    const csvString = generateReportCsv(report)
    attachmentContent = Buffer.from(csvString, "utf-8")
    attachmentFilename = getReportFilename(report, "csv")
    contentType = "text/csv"
  } else {
    const pdfBytes = await generateReportPdfFromSummary(report)
    attachmentContent = Buffer.from(pdfBytes)
    attachmentFilename = getReportFilename(report, "pdf")
    contentType = "application/pdf"
  }

  const subject = REPORT_SUBJECT[reportType] ?? "PineTree Report"
  const html = buildEmailHtml(report, attachmentFilename)

  const emailId = await sendReportEmail({
    to: recipientEmail,
    subject,
    html,
    attachment: { filename: attachmentFilename, content: attachmentContent, contentType }
  })

  return { success: true, sentTo: recipientEmail, filename: attachmentFilename, emailId }
}
