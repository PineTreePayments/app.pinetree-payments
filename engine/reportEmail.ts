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
import { REPORT_HEX } from "@/lib/reporting/reportTheme"

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
  const H = REPORT_HEX

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${report.title}</title>
  <style type="text/css">
    /* Keep report metric tiles compact in mobile previews where supported. */
    @media only screen and (max-width: 480px) {
      .pt-metric-col {
        width: 50% !important;
      }
      .pt-metric-gap {
        width: 10px !important;
        min-width: 10px !important;
      }
      .pt-body {
        padding-left: 16px !important;
        padding-right: 16px !important;
      }
      .pt-stat-tile {
        padding: 14px 12px !important;
        height: 104px !important;
      }
      .pt-stat-value {
        font-size: 20px !important;
        line-height: 1.15 !important;
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
            <td style="background:${H.brand};padding:28px 36px 24px;">
              <div style="color:#ffffff;font-size:21px;font-weight:800;letter-spacing:-0.3px;line-height:1.1;">PineTree Payments</div>
              <div style="color:rgba(255,255,255,0.7);font-size:12px;margin-top:4px;font-weight:500;">Financial Reporting</div>
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
              <!-- Key metrics -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;border-collapse:separate;border-spacing:0;">
                <tr>
                  <!-- Gross Volume card -->
                  <td class="pt-metric-col" valign="top" width="50%" style="width:50%;padding:0;vertical-align:top;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td class="pt-stat-tile" height="112" style="height:112px;padding:16px 16px;background:${H.emailCard.bgBlue};border-radius:14px;border:1px solid ${H.emailCard.borderBlue};vertical-align:top;">
                          <div style="font-size:10px;font-weight:800;color:${H.emailCard.labelBlue};text-transform:uppercase;letter-spacing:0.7px;line-height:1.25;">Gross Volume</div>
                          <div class="pt-stat-value" style="font-size:24px;font-weight:800;color:${H.emailCard.value};margin-top:12px;letter-spacing:-0.4px;line-height:1.12;">${currency(report.grossVolume)}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <!-- Gutter -->
                  <td class="pt-metric-gap" width="12" style="width:12px;min-width:12px;">&nbsp;</td>
                  <!-- Net Settlements card -->
                  <td class="pt-metric-col" valign="top" width="50%" style="width:50%;padding:0;vertical-align:top;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td class="pt-stat-tile" height="112" style="height:112px;padding:16px 16px;background:${H.emailCard.bgGreen};border-radius:14px;border:1px solid ${H.emailCard.borderGreen};vertical-align:top;">
                          <div style="font-size:10px;font-weight:800;color:${H.emailCard.labelGreen};text-transform:uppercase;letter-spacing:0.7px;line-height:1.25;">Net Settlements</div>
                          <div class="pt-stat-value" style="font-size:24px;font-weight:800;color:${H.emailCard.value};margin-top:12px;letter-spacing:-0.4px;line-height:1.12;">${currency(report.netSettlements)}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Stats row -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;border-collapse:separate;border-spacing:0;">
                <tr>
                  <td class="pt-metric-col" valign="top" width="50%" style="width:50%;padding:0;vertical-align:top;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td class="pt-stat-tile" height="100" style="height:100px;padding:15px 16px;background:${H.emailCard.bgNeutral};border:1px solid ${H.emailCard.borderGray};border-radius:14px;vertical-align:top;text-align:left;">
                          <div style="font-size:10px;color:${H.emailCard.labelGray};font-weight:800;text-transform:uppercase;letter-spacing:0.7px;line-height:1.25;">Transactions</div>
                          <div class="pt-stat-value" style="font-size:22px;font-weight:800;color:${H.emailCard.value};margin-top:10px;line-height:1.12;">${report.transactionCount}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td class="pt-metric-gap" width="12" style="width:12px;min-width:12px;">&nbsp;</td>
                  <td class="pt-metric-col" valign="top" width="50%" style="width:50%;padding:0;vertical-align:top;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td class="pt-stat-tile" height="100" style="height:100px;padding:15px 16px;background:${H.emailCard.bgNeutral};border:1px solid ${H.emailCard.borderGray};border-radius:14px;vertical-align:top;text-align:left;">
                          <div style="font-size:10px;color:${H.emailCard.labelGray};font-weight:800;text-transform:uppercase;letter-spacing:0.7px;line-height:1.25;">Success Rate</div>
                          <div class="pt-stat-value" style="font-size:22px;font-weight:800;color:${H.emailCard.value};margin-top:10px;line-height:1.12;">${report.successRate}%</div>
                        </td>
                      </tr>
                    </table>
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
                  <td style="background:${H.insightBg};border:1px solid ${H.insightBorder};border-radius:10px;padding:18px 20px;">
                    <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:${H.brand};text-transform:uppercase;letter-spacing:1px;">PineTree Insights</p>
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
