# Speed Custom Connect Credential Environment Checklist

PineTree creates Speed Custom Connect accounts server-side. Merchants never
receive Speed credentials or interact with a Speed signup flow.

## Active provisioning variable

Set this variable server-side only. Never prefix it with `NEXT_PUBLIC_`, return
it from an API route, persist it to Supabase, or log it.

| Variable | Required | Validation |
|---|---|---|
| `SPEED_CONNECTED_ACCOUNT_PASSWORD` | When `SPEED_CONNECT_ENABLED=true` | 12-128 characters; upper/lower/digit/special; no whitespace, repeated triples, or simple sequences |

The active wallet provisioning path resolves this single value from the
server environment for both test and production Custom Connect requests. It
fails closed if the value is absent or violates Speed's password policy. The
retired `SPEED_TEST_ACCOUNT_PASSWORD` variable is not read in any environment.

New provisioning does not write the configured password to
`merchant_speed_credentials` or any other database table. It stores only the
provider account identifiers and non-secret readiness metadata needed to avoid
creating duplicate accounts.

## Historical credential recovery

Older deployments could store per-merchant encrypted credentials in
`merchant_speed_credentials`. The admin-only recovery code remains so those
historical rows are not stranded:

| Variable | Required | Validation |
|---|---|---|
| `SPEED_CREDENTIAL_ENCRYPTION_KEY` | Only where historical rows must be revealed | The original 64-character hexadecimal AES-256-GCM key |

Do not rotate or replace this key casually: a different key cannot decrypt
existing rows. If the original key is lost, recover access through a controlled
provider password-reset process; do not guess a replacement. New provisioning
does not use this key.

## Verify

```bash
npm run check:env
npm run check:env:strict
```

When Custom Connect is enabled, confirm
`SPEED_CONNECTED_ACCOUNT_PASSWORD` passes policy validation. A legacy
encryption key may remain absent in environments with no historical encrypted
rows.

## Safe behavior

- Missing active configuration fails account creation closed.
- The configured password is never sent to the browser or a merchant API.
- The configured password is never persisted by the active provisioning path.
- Existing account and historical metadata checks run before a create request,
  preventing duplicate connected accounts during retries.
- Historical credential reveal requires an authenticated PineTree admin,
  explicit confirmation, a no-store response, and an audit event.
