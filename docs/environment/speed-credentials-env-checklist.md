# Speed Custom Connect Credential Environment Checklist

PineTree creates a Speed Custom Connect account server-side for every
merchant's Lightning rail. PineTree retains administrative access to that
account (to sign into Speed's portal or clean up a test account) without ever
exposing Speed or its credentials to merchants.

## Required variables

Set these as server-side variables only. Never prefix either with
`NEXT_PUBLIC_`, return them from an API route, or log them.

| Variable | Required | Validation |
|---|---|---|
| `SPEED_TEST_ACCOUNT_PASSWORD` | Outside production only | One shared password, server-only |
| `SPEED_CREDENTIAL_ENCRYPTION_KEY` | Always | Exactly 64 hexadecimal characters (32 bytes) |

- `SPEED_TEST_ACCOUNT_PASSWORD` is the one shared password used for every
  non-production (test/dev/staging) Speed Custom Connect account PineTree
  creates. Missing it outside production fails Speed account creation closed
  with a clear configuration error - it does not fall back to a generated
  password.
- In production, PineTree always generates a unique, cryptographically
  random password per merchant account. `SPEED_TEST_ACCOUNT_PASSWORD` is
  never read in production.
- `SPEED_CREDENTIAL_ENCRYPTION_KEY` encrypts every retained Speed account
  password (AES-256-GCM) before it reaches `merchant_speed_credentials`.
  Required in every environment that provisions Speed Custom Connect
  accounts, including non-production.

Generate an encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Storage model

- `merchant_speed_credentials` (see
  `database/migrations/20260712_create_merchant_speed_credentials.sql`)
  stores the encrypted password, IV, and auth tag alongside the Speed
  connected account id, login email, and environment.
- Row Level Security is enabled with no `anon`/`authenticated` policies at
  all - only the service-role client can read or write this table. It is
  never joined into a merchant-facing API response.
- The password is never hashed (PineTree must be able to retrieve it for
  administrative account access) - only reversible, authenticated encryption.

## Verify

```bash
npm run check:env
```

Confirm `SPEED_CREDENTIAL_ENCRYPTION_KEY` reports as a valid 64-hex-char
value, and that `SPEED_TEST_ACCOUNT_PASSWORD` is present in every
non-production environment.

## Safe behavior

- A missing `SPEED_TEST_ACCOUNT_PASSWORD` outside production fails account
  creation closed with a configuration error - never a silently generated
  fallback password.
- A missing or malformed `SPEED_CREDENTIAL_ENCRYPTION_KEY` fails credential
  encryption/decryption closed.
- Credential storage failure after a successful Speed account creation marks
  the merchant's Lightning profile `needs_attention` - it is never reported
  as fully ready.
- Merchants only ever see PineTree-branded Lightning/PineTree Wallet status -
  never Speed, a Speed account id, a Speed login email, or a Speed password.
- Revealing a decrypted credential requires an authenticated PineTree
  administrator, an explicit confirmation, and is audited
  (`lightning.speed_credential_revealed`) - see
  `app/api/admin/speed-credentials/[merchantId]/reveal`.

## Common failures

- Speed account creation stuck in `needs_attention` with
  `speed_connect_password_policy_failed`: the configured
  `SPEED_TEST_ACCOUNT_PASSWORD` does not satisfy Speed's password policy
  (12-128 chars, upper/lower/digit/special, no 3+ repeated or sequential
  characters).
- Speed account creation stuck in `needs_attention` with
  `speed_connect_credential_store_failed`: Speed created the account but
  PineTree failed to encrypt/store its password - the account id is still
  retained; retrying re-attempts storage without creating a duplicate Speed
  account.
- Admin reveal route returns "No retained Speed credential is available":
  the account predates this feature, or its stored credential could not be
  recovered. Check `getAdminSpeedCredentialSummary`'s derived
  `credential_status` (`available`, `unavailable`, `storage_error`) - an
  `unavailable`/pre-existing account needs a manual Speed password reset or
  cleanup instead of an automatic reveal.
