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
DYNAMIC_EXTERNAL_JWT_AUDIENCE=dynamic
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
Audience: dynamic
Algorithm: RS256
User identity: JWT sub / externalUserId = PineTree merchant_id
Email claim: PineTree merchant email
```

If Dynamic says audience is not required, set `DYNAMIC_EXTERNAL_JWT_AUDIENCE`
to an empty value and configure no audience restriction in Dynamic.

**2026-07-09 finding:** per Dynamic's own BYOA docs, `aud` is an optional,
dashboard-configurable claim with no fixed convention - Dynamic only requires
`iss`, `sub`, and `exp`, and validates `iss` against the dashboard-configured
value. `DYNAMIC_EXTERNAL_JWT_AUDIENCE=dynamic` was a placeholder entered before
this was confirmed with Dynamic support and was never verified against what (if
anything) Dynamic's dashboard actually expects. The route now falls back to
signing `aud` as `NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID` whenever
`DYNAMIC_EXTERNAL_JWT_AUDIENCE` is unset or still literally `dynamic`, since
environment-ID-as-audience is the most common per-project binding for this kind
of integration. If Dynamic support confirms a different required value, set
`DYNAMIC_EXTERNAL_JWT_AUDIENCE` explicitly to override this fallback.

If sign-in fails with `wallet_dynamic_signin_failed { errorName:
"InvalidExternalAuthError", errorCode: "invalid_external_auth_error" }`, this
means Dynamic's backend received and rejected the JWT (JWKS fetch succeeded,
the SDK reached the network call) but does not expose which validation step
failed. Given `aud` is optional, the more likely causes are: the `iss` claim
not exactly matching what's configured in Dynamic's dashboard for this
environment (check for a trailing slash, `www.`, `http://` vs `https://`, or a
preview-deployment URL), or BYOA/External JWT not actually being enabled yet
for the specific Dynamic environment `NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID`
points at. Confirm both directly with Dynamic support - this cannot be fully
diagnosed from application code or logs alone.

If the Dynamic auth sheet shows `Sandbox`, `NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID`
is pointing at a Dynamic sandbox environment. That is fine for staging only when
the sandbox project also has External JWT/BYOA enabled with:

- Issuer: `https://app.pinetree-payments.com`
- Audience: `dynamic`
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
dynamic

JWT identity:
sub is the PineTree merchant_id. The Dynamic SDK externalUserId will be the same
value as sub.

Claims included:
iss, sub, aud, exp, iat, jti, email, emailVerified, merchant_id.

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

## Rollback To Email Fallback

Only use this when Dynamic Email login is enabled in the Dynamic dashboard:

```bash
NEXT_PUBLIC_PINETREE_DYNAMIC_AUTH_MODE=dynamic_email_fallback
NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK=true
DYNAMIC_EXTERNAL_JWT_ENABLED=false
```

Do not leave `NEXT_PUBLIC_PINETREE_DYNAMIC_EMAIL_FALLBACK=false` without working
External JWT/BYOA; signer restore will not complete cleanly.
