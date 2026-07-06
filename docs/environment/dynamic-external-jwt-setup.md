# Dynamic External JWT Setup

PineTree Wallet uses PineTree merchant auth as the canonical identity. Dynamic
External JWT / BYOA lets Dynamic restore the embedded wallet signer session from
a PineTree-issued JWT instead of asking merchants for a second email login.

Dynamic's current BYOA docs require a configured issuer and a public JWKS URL.
PineTree can generate the signing key, JWKS, issuer, audience, and JWTs. Dynamic
must enable/configure BYOA on the project.

## Generate PineTree Values

Run:

```bash
npm run dynamic:jwt:generate
```

This prints:

- RS256 private signing key for server-only env.
- Public JWKS JSON for Dynamic verification.
- Stable `kid`.
- Vercel env blocks.
- Dynamic dashboard values.

Do not commit generated private keys.

## Vercel Env Vars

Server-only:

```bash
DYNAMIC_EXTERNAL_JWT_ENABLED=true
DYNAMIC_EXTERNAL_JWT_ISSUER=https://app.pinetree-payments.com
DYNAMIC_EXTERNAL_JWT_AUDIENCE=dynamic
DYNAMIC_EXTERNAL_JWT_KID=<generated kid>
DYNAMIC_EXTERNAL_JWT_PRIVATE_KEY=<generated private key with \n escapes>
DYNAMIC_EXTERNAL_JWT_JWKS_PUBLIC='<generated public JWKS JSON>'
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
5. Confirm `/.well-known/dynamic-jwks.json` returns only public JWKS.
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
