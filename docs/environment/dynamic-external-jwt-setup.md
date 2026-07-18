# Dynamic External JWT Setup

PineTree Wallet uses PineTree merchant auth as the canonical identity. Dynamic
External JWT / BYOA lets Dynamic restore the embedded wallet signer session from
a PineTree-issued JWT instead of asking merchants for a second email login.

Dynamic's current BYOA docs require a configured issuer and a public JWKS URL.
PineTree generates one RS256 signing key and derives the public JWKS at
`/.well-known/dynamic-jwks.json` from that signing key at runtime. Dynamic must
enable/configure BYOA on the project.

## Generate PineTree Values

Run:

```bash
npm run dynamic:jwt:generate
```

This prints:

- Base64-encoded RS256 PEM signing key for server-only env.
- Public JWKS URL for Dynamic verification.
- Stable `kid`.
- Vercel env blocks.
- Dynamic dashboard values.

Do not commit generated signing keys.

## Vercel Env Vars

Server-only:

```bash
DYNAMIC_EXTERNAL_JWT_ENABLED=true
DYNAMIC_EXTERNAL_JWT_ISSUER=https://app.pinetree-payments.com
# Audience is derived from NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID (verified Dynamic
# contract). Do NOT set DYNAMIC_EXTERNAL_JWT_AUDIENCE - it is legacy and ignored
# whenever an environment ID is configured.
DYNAMIC_EXTERNAL_JWT_KID=<generated kid>
DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64=<generated base64 signing key>
```

Public/client:

```bash
NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE=external_jwt
NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK=false
NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID=<from Dynamic dashboard>
```

## Dynamic Dashboard Values

PineTree can provide these:

```text
Issuer: https://app.pinetree-payments.com
JWKS URL: https://app.pinetree-payments.com/.well-known/dynamic-jwks.json
Audience: <the Dynamic environment ID> (verified 2026-07-10)
Algorithm: RS256
User identity: JWT sub / externalUserId = PineTree merchant_id
Email claim: PineTree merchant email
```

**2026-07-10 VERIFIED CONTRACT** (probed directly against Dynamic's live
`POST /api/v0/sdk/{environmentId}/externalAuth/signin` with PineTree-signed
JWTs):

- `aud` **is required** and must equal the **Dynamic environment ID**
  (`NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID`). A JWT without that audience is
  rejected `422 invalid_external_auth` with `"Audience (aud) does not match"` -
  surfaced by the SDK as `InvalidExternalAuthError`. This was the production
  failure: any deploy signing the old `dynamic` placeholder (or any other
  stale audience value) fails exactly this way and used to fall back to the
  email login sheet.
- With `aud` = environment ID and the existing issuer/JWKS/kid, sign-in
  succeeds and returns a Dynamic user carrying an `externalUser` verified
  credential whose public identifier equals the JWT `sub` (the PineTree
  merchant_id). That credential - not any email - is the canonical identity
  binding for the session (see `lib/wallets/dynamicExternalIdentity.ts`).
- `security.externalAuth.enabled` was confirmed `true` for the sandbox
  environment via Dynamic's public SDK settings endpoint.
- Note: the sandbox environment has `automaticEmbeddedWalletCreationForExternal:
  false`, so externally-authenticated users do NOT get embedded wallets
  auto-created by Dynamic - PineTree's client-side explicit
  `createWalletAccount` call covers this.

The route therefore signs `aud` as the environment ID whenever one is
configured; the legacy `DYNAMIC_EXTERNAL_JWT_AUDIENCE` var is consulted only
when no environment ID exists (and its `dynamic` placeholder is never signed).
If Dynamic support ever mandates a different value, set
`DYNAMIC_EXTERNAL_JWT_AUDIENCE_OVERRIDE` - it wins over everything.

**Email fallback is a developer recovery path only.** In production builds the
client no longer opens Dynamic's email login when the external JWT is rejected;
it fails with `dynamic_external_jwt_rejected` and boolean contract diagnostics
(`wallet_dynamic_jwt_auth_failed { issuerMatch, audienceMatch, jwksLoaded,
subjectPresent, environmentIdPresent }`). The fallback still opens in dev
builds or with `?walletDebug=1`.

**Smoke check:** `GET /api/debug/pinetree-wallet/smoke` (admin) reports JWT
generation + claim matches + JWKS reachability + Dynamic external-auth
enablement; add `&probe=1` to submit a real signed JWT for the merchant to
Dynamic and report acceptance, Dynamic-user existence, and Base/Solana
embedded-wallet existence (booleans only).

If the Dynamic auth sheet shows `Sandbox`, `NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID`
is pointing at a Dynamic sandbox environment. That is fine for staging only when
the sandbox project also has External JWT/BYOA enabled with:

- Issuer: `https://app.pinetree-payments.com`
- Audience: the matching `NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID`
- JWKS URL: `https://app.pinetree-payments.com/.well-known/dynamic-jwks.json`
  or the matching public key
- KID matching `DYNAMIC_EXTERNAL_JWT_KID`
- Public key derived from `DYNAMIC_EXTERNAL_JWT_SIGNING_KEY_B64`

## Dynamic Support Request

```text
Please enable BYOA / External JWT authentication for our Dynamic project.

We will issue RS256 JWTs from PineTree for PineTree Wallet embedded wallet
session restore.

Issuer:
https://app.pinetree-payments.com

JWKS URL:
https://app.pinetree-payments.com/.well-known/dynamic-jwks.json

Audience:
<the Dynamic environment ID>

JWT identity:
sub is the PineTree merchant_id. The Dynamic SDK externalUserId will be the same
value as sub. PineTree does not bind Dynamic external authentication through
email.

Claims included:
iss, sub, aud, exp, iat, jti.

Please confirm:
- BYOA / External JWT is enabled for sandbox and production projects.
- RS256 is accepted.
- Whether aud is required and whether "dynamic" is the correct value.
- Any additional required claims.
- The sandbox and production Dynamic environment IDs.
- Where these values should be configured in the Dynamic dashboard.
```

## Rollout

1. Generate keys with `npm run dynamic:jwt:generate`.
2. Add server-only env vars in staging.
3. Add public/client env vars in staging.
4. Deploy staging.
5. Confirm `/.well-known/dynamic-jwks.json` derives and returns only public JWKS.
6. Ask Dynamic to enable/configure BYOA using the values above.
7. Test PineTree Wallet setup and reconnect with `?walletDebug=1`.
8. Confirm debug fields show `dynamicExternalAuthAttempted=true` and
   `dynamicExternalAuthSucceeded=true`.
9. Repeat for production with production keys and production Dynamic project.

## Sandbox Cleanup After Email-Fallback Tests

Prior Dynamic email-fallback testing may have created a separate Dynamic user
for the same test email. If Dynamic rejects a fully verified external JWT with
`invalid_external_auth`, clean up the sandbox test account manually:

1. Open the Dynamic dashboard Users page.
2. Find the test user created through email sign-in.
3. Confirm it is the sandbox test account.
4. Delete that stale Dynamic user before retrying PineTree external auth.

Do not delete Dynamic users or wallets automatically from PineTree application
code.

## Rollback To Email Fallback

Only use this when Dynamic Email login is enabled in the Dynamic dashboard:

```bash
NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE=dynamic_email_fallback
NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK=true
DYNAMIC_EXTERNAL_JWT_ENABLED=false
```

Do not leave `NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK=false` without working
External JWT/BYOA; signer restore will not complete cleanly.
