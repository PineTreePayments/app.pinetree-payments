# PineTree Node SDK Release Checklist

The package remains private (`"private": true`) until every item below is
explicitly approved and `private` is removed in the release commit.

## Migration Prerequisites

Before running any integration tests or staging a release, verify that the
following database migrations have been applied to the target environment.

- Confirm migration `20260605` (merchant send approval sessions) is applied.
- Confirm all prior API migrations are applied and healthy.
- Run `SELECT COUNT(*) FROM checkout_sessions LIMIT 1` to verify the table exists.
- Run `SELECT COUNT(*) FROM webhook_deliveries LIMIT 1` to verify webhook delivery
  table exists.
- Confirm no pending migrations are shown in the migration runner output.

If any migration is missing, apply it before proceeding.  Do not run integration
tests against an unmigrated schema.

## Required Environment Variables

Integration tests require the following variables.  Normal CI and unit tests
never require any of these.

| Variable | Required for | Notes |
|---|---|---|
| `PINETREE_RUN_INTEGRATION` | All integration tests | Must be `"true"` |
| `PINETREE_INTEGRATION_BASE_URL` | All integration tests | e.g. `http://localhost:3000` or staging URL |
| `PINETREE_INTEGRATION_API_KEY` | All integration tests | Must be `pt_test_*` against non-production |
| `PINETREE_INTEGRATION_WEBHOOK_SECRET` | Webhook tests | Matching signing secret |
| `PINETREE_ALLOW_PRODUCTION_INTEGRATION` | Production runs only | Must be `"true"`; never set in normal CI |
| `PINETREE_INTEGRATION_PAYMENT_ID` | Payment retrieve test | Optional; skipped if absent |

## Manual SQL Confirmation

Before a staging or production integration run, confirm the following manually
in the target database:

```sql
-- Checkout sessions table is present and accessible
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'checkout_sessions';

-- Webhook deliveries table is present and accessible
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'webhook_deliveries';
```

Both queries must return a row before proceeding.

## Production Safety Guard

The integration test suite enforces a production safety guard automatically:

- Tests abort if `PINETREE_INTEGRATION_BASE_URL` contains a production hostname
  and `PINETREE_ALLOW_PRODUCTION_INTEGRATION` is not set to `"true"`.
- Tests abort if `PINETREE_INTEGRATION_API_KEY` looks like a live key
  (`pt_live_*`) but `PINETREE_INTEGRATION_BASE_URL` points to `localhost`.
- Never set `PINETREE_ALLOW_PRODUCTION_INTEGRATION=true` in automated CI.
  Production integration tests require separate manual approval on each run.

## Package

- Confirm the final package name (`@pinetree/node`) and npm organization ownership.
- Confirm npm authentication, publishing role, and 2FA policy.
- Choose the semantic version and update the changelog/release notes.
- Remove `"private": true` only in the designated release commit — never earlier.
- Review package metadata, exports, supported Node versions (`>=18`, recommend
  `20+`), and included files.

## Supported Node Versions

The SDK targets Node 18 and later (`"engines": { "node": ">=18" }`).

- **Node 18**: supported; minimum version.
- **Node 20 LTS**: recommended for production and the primary CI target.
- **Node 22**: tested in CI matrix; supported.

The CI matrix runs all three versions on every push that touches the SDK.
Do not add version-specific dependencies or polyfills — the SDK relies only on
stable Node built-ins and standard Web APIs available since Node 18.

## Verification

- Run `npm run release-candidate` inside `packages/pinetree-node` (or
  `npm run sdk:release-candidate` from the repository root).  This single
  command runs all of the steps below.
- Confirm the script exits `0` with all steps marked OK.
- Run `npm run build` inside `packages/pinetree-node`.
- Confirm ESM, CJS, and declaration outputs exist under `dist`.
- Confirm `dist/` does not appear in `git ls-files packages/pinetree-node/dist`.
- Run package typecheck, lint, and tests.
- Run the root API and full repository test suites.
- Review README and API documentation examples.
- Run a sandbox integration test using a non-production API key:
  ```
  PINETREE_RUN_INTEGRATION=true \
  PINETREE_INTEGRATION_BASE_URL=http://localhost:3000 \
  PINETREE_INTEGRATION_API_KEY=pt_test_... \
  PINETREE_INTEGRATION_WEBHOOK_SECRET=whsec_... \
  npm run test:integration --workspace packages/pinetree-node
  ```
- Run `npm pack --dry-run` and confirm no unexpected files (src/, test/,
  scripts/, tsconfigs) appear in the archive.

## Publish

**npm publish is disabled until PineTree explicitly approves a public release.**

- Confirm the repository is clean and the release commit/tag is approved.
- Remove `"private": true` from `packages/pinetree-node/package.json`.
- Authenticate with the intended npm account and registry.
- Run `npm publish --access public` from `packages/pinetree-node`.
- Record the published version and integrity information.

## Post-Publish

- Install the published version into a clean Node project.
- Create, retrieve, list, cancel, and expire a sandbox checkout session.
- Retrieve a sandbox payment.
- Verify and retry a sandbox webhook delivery.
- Confirm ESM, CJS, and TypeScript consumer examples.
- Monitor API errors and support channels after release.

Do not execute the publish steps until PineTree explicitly approves a public release.
