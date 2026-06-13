# PineTree SDK — Version Strategy

This document covers the versioning conventions for the three PineTree SDK
packages: `@pinetree/node`, `@pinetree/js`, and `@pinetree/react`.

---

## Current private-beta versions

| Package | Current (private) | First public release |
|---|---|---|
| `@pinetree/node` | `0.1.0` | `0.1.0-beta.1` |
| `@pinetree/js` | `0.3.0` (+ unreleased Phase 14) | `0.4.0-beta.1` |
| `@pinetree/react` | `0.1.0` | `0.1.0-beta.1` |

`@pinetree/js` must bump to `0.4.0` before publishing because Phase 14
lifecycle-event changes are already in the codebase and are not reflected in
the current `0.3.0` version tag.

---

## Semver rules

These packages follow [Semantic Versioning 2.0.0](https://semver.org/).

| Change | Version bump |
|---|---|
| New exported symbol, parameter, or option (additive only) | minor (`0.x.0`) |
| Bug fix with no API surface change | patch (`0.0.x`) |
| Removed or renamed export, breaking param change, behavioral contract change | major (`x.0.0`) |
| Pre-release iteration on a version | pre-release suffix (`0.4.0-beta.2`) |

During the `0.x` range, minor bumps may contain breaking changes with a
changelog entry. The stable `1.0.0` signal means the public API is locked.

---

## Beta release flow

1. Set the package version to `<next-version>-beta.1` in `package.json`.
2. Build the package (`npm run build --workspace packages/<pkg>`).
3. Run `npm run release-candidate` from the repo root.
4. Remove `"private": true` from the package's `package.json` **only** in the
   release commit.
5. `npm publish --tag beta --access public` from the package directory.
6. Consumers install via `npm install @pinetree/node@beta`.
7. Collect feedback; iterate with `-beta.2`, `-beta.3`, … as needed.
8. When stable, publish the same version without the pre-release suffix:
   `npm publish --access public` (the `latest` tag).

---

## Stable `1.0.0` criteria

All three conditions must be met:

1. **API stability** — the public interface has been stable across at least
   two consecutive minor releases without breaking changes.
2. **Integration test coverage** — the integration test suite passes against a
   staging deployment with real payment rails.
3. **Platform readiness** — `docs/api/platform-readiness-report.md` is
   marked complete and sign-off from the PineTree team has been recorded.

---

## Package coordination

`@pinetree/react` depends on `@pinetree/js`. When `@pinetree/js` ships a
breaking change, `@pinetree/react` must also release a new major version that
pins the new `@pinetree/js` peer range.

During private beta the dependency is a workspace `file:` reference.
On publish, change it to a semver range:

```json
"dependencies": {
  "@pinetree/js": "^0.4.0"
}
```

Update `peerDependencies` in `@pinetree/react` to match.
