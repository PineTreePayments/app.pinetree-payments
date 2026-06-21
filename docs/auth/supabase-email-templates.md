# PineTree Auth Email Templates

Use this document to apply PineTree branding to hosted authentication emails.

## Password Reset

Supabase Dashboard path:

1. Go to Authentication -> Emails -> Reset Password.
2. Set Subject to `Reset your PineTree password`.
3. Paste the HTML template below into the email body.
4. Go to Authentication -> Emails / SMTP settings.
5. Set Sender name to `PineTree Payments`.
6. Recommended sender email: `support@pinetree-payments.com` or `no-reply@pinetree-payments.com`.

If custom SMTP is not configured yet, the platform may still use managed sender behavior until SMTP is configured.

### Subject

```text
Reset your PineTree password
```

### HTML Template

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Reset your PineTree password</title>
  </head>
  <body style="margin:0;background:#f6f8fb;font-family:Inter,Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f8fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 12px;text-align:center;">
                <div style="font-size:22px;font-weight:800;color:#0052ff;letter-spacing:-0.02em;">PineTree Payments</div>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 28px 4px;text-align:center;">
                <h1 style="margin:0;font-size:24px;line-height:1.25;color:#111827;">Reset your PineTree password</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 28px 0;text-align:center;">
                <p style="margin:0;font-size:15px;line-height:1.6;color:#4b5563;">
                  We received a request to reset the password for your PineTree account. Use the button below to create a new password.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:26px 28px 22px;">
                <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0052ff;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 22px;border-radius:12px;">
                  Reset password
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 28px;text-align:center;">
                <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">
                  If you did not request this, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
```
