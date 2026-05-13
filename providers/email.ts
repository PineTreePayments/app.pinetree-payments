import { Resend } from "resend"

const FROM_ADDRESS =
  process.env.REPORT_FROM_EMAIL || "PineTree Payments <info@pinetree-payments.com>"

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured")
  }
  return new Resend(apiKey)
}

export type EmailAttachment = {
  filename: string
  content: Buffer
  contentType: string
}

export type SendReportEmailOptions = {
  to: string
  subject: string
  html: string
  attachment: EmailAttachment
}

export async function sendReportEmail(options: SendReportEmailOptions): Promise<string> {
  const resend = getResendClient()

  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: options.to,
    subject: options.subject,
    html: options.html,
    attachments: [
      {
        filename: options.attachment.filename,
        content: options.attachment.content
      }
    ]
  })

  if (error) {
    throw new Error(`Email delivery failed: ${error.message}`)
  }

  return data?.id ?? ""
}
