# PineTree Auth Email Templates

Use this document to apply PineTree branding to hosted authentication emails and
to keep the Supabase dashboard consistent with the repository implementation.

## Password Reset

Supabase Dashboard path:

1. Go to Authentication -> Emails -> Reset Password.
2. Set Subject to `Reset your PineTree password`.
3. Paste the HTML template below into the email body.
4. Go to Authentication -> Emails / SMTP settings.
5. Set Sender name to `PineTree Payments`.
6. Recommended sender email: `support@pinetree-payments.com` or `no-reply@pinetree-payments.com`.

If custom SMTP is not configured yet, the platform may still use managed sender
behavior until SMTP is configured.

### Recovery flow: server-verified token hash, not PKCE

PineTree password recovery uses `{{ .TokenHash }}` plus a server-side
`verifyOtp({ token_hash, type: "recovery" })` call in
[app/auth/confirm/route.ts](../../app/auth/confirm/route.ts).

It deliberately does **not** use the PKCE `{{ .ConfirmationURL }}` /
`exchangeCodeForSession()` flow. PKCE requires the browser that finishes the
flow to still hold the code verifier that the browser which *started* the flow
wrote to storage. `@supabase/ssr` stores that verifier in a first-party cookie
(`sb-<project-ref>-auth-token-code-verifier`) on the PineTree origin, and
`@supabase/auth-js` throws `AuthPKCECodeVerifierMissingError`
(`pkce_code_verifier_not_found`) when it is absent. Its own error text names the
cause: *"This can happen if the auth flow was initiated in a different browser or
device."*

Password recovery is delivered out of band by email, so the link routinely opens
in a Gmail/Outlook in-app webview, a different default browser, or a different
device than the one that requested the reset. In all of those cases the verifier
cookie does not exist and the exchange fails on a link that is seconds old.
Token-hash verification has no browser-local dependency, so it works from any
context.

### Template link markup (exact)

The reset button must point at:

```text
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password
```

`{{ .SiteURL }}` resolves to the configured Site URL, so the link stays correct
without depending on any client-side environment variable.

Do **not** use `{{ .ConfirmationURL }}` in this template. That variable produces
a Supabase `/auth/v1/verify` link whose result is delivered either as a PKCE
`?code=` (needs the verifier) or as an implicit-grant URL fragment
(`#access_token=...`), and a URL fragment is never transmitted to the server, so
the callback route cannot see it at all.

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
                <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password" style="display:inline-block;background:#0052ff;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 22px;border-radius:12px;">
                  Reset password
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 28px;text-align:center;">
                <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">
                  This link can be used once and expires after one hour. If you did not request this, you can safely ignore this email.
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

## Required production configuration

### Authentication -> URL Configuration

| Setting | Required value |
| --- | --- |
| Site URL | `https://app.pinetree-payments.com` |
| Redirect URLs | `https://app.pinetree-payments.com/**` |

Verified against production on 2026-07-30 by probing
`/auth/v1/verify?...&redirect_to=<candidate>` and observing whether Supabase
honored the candidate or fell back to the Site URL:

- `https://app.pinetree-payments.com/auth/callback` — honored (allowlisted)
- `https://app.pinetree-payments.com/auth/confirm` — honored (allowlisted)
- `https://app.pinetree-payments.com/<any-other-path>` — honored, which
  confirms the allowlist entry is a `/**` wildcard
- `https://www.app.pinetree-payments.com/auth/callback` — **not** allowlisted
- `http://localhost:3000/auth/callback` — **not** allowlisted
- `https://<deployment>.vercel.app/auth/callback` — **not** allowlisted

Because the Site URL wildcard already covers `/auth/confirm`, moving the flow to
the token-hash route needs no Redirect URL change.

To test recovery locally or on a preview deployment, temporarily add that
origin's `/**` entry to Redirect URLs. The template's `{{ .SiteURL }}` still
points at production, so a local test additionally requires pointing Site URL at
the local origin — prefer testing recovery against production.

### Authentication -> Providers -> Email

| Setting | Required value |
| --- | --- |
| Email OTP Expiration | `3600` seconds (Supabase default) — governs reset link lifetime |

### Environment (Vercel, Production)

| Variable | Required value |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | `https://app.pinetree-payments.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://tyuwbyasqhwcqfprvqzj.supabase.co` |

Note that the repository's `.env` file carries a stale
`NEXT_PUBLIC_SUPABASE_URL=https://tyuwbyasqhwcqfprvqzj.supabase.com` (`.com`
rather than `.co`). It is masked locally because `.env.local` overrides it, and
Vercel's production value is correct, so it affects nothing deployed — but it
should be corrected to avoid confusing a future local debugging session.

## Recovery diagnostics

`logRecoveryDiagnostic` in [lib/auth/recovery.ts](../../lib/auth/recovery.ts)
emits single-line JSON with `"scope":"auth-recovery"` and runs in production
(it is suppressed only under test). Filter Vercel runtime logs on `auth-recovery`.

Recorded fields are metadata only: `correlationId`, `route`, `method`, `origin`,
`protocol`, `userAgentClass`, `hasCode`, `hasTokenHash`, `hasVerifier`,
`strategy`, `type`, `next`, `supabaseErrorCode`, `supabaseStatus`, and
`outcome`.

Never add authorization codes, token hashes, cookies, sessions, access or
refresh tokens, passwords, or email addresses to these payloads.
