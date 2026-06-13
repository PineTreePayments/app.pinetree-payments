# PineTree SDK — npm Publish Checklist

Use this checklist for each npm release of `@pinetree/node`, `@pinetree/js`,
and `@pinetree/react`. Complete every item in order; do not skip steps.

See also: [version-strategy.md](./version-strategy.md)

---

## 1. npm org setup (one-time)

- [ ] Create the `@pinetree` npm organization at <https://www.npmjs.com/org/create>
- [ ] Add all engineers who need publish access to the org
- [ ] Set org package visibility default to **Public** (packages are scoped
      but open-source)
- [ ] Confirm `@pinetree/node`, `@pinetree/js`, and `@pinetree/react` are
      available (not squatted) by running:
      ```bash
      npm view @pinetree/node
      npm view @pinetree/js
      npm view @pinetree/react
      ```
      A 404 / "not found" response means the names are free.

---

## 2. Package name reservation

- [ ] Publish a minimal placeholder `0.0.1` under each name immediately after
      org creation to reserve the names, if any concern about squatting.
- [ ] Mark the placeholder as deprecated:
      ```bash
      npm deprecate @pinetree/node@0.0.1 "Reserved — first beta coming soon"
      ```

---

## 3. Repository metadata (per package)

Before publishing, verify each `package.json` contains correct values for:

- [ ] `"repository"` — update to the actual GitHub URL:
      ```json
      "repository": {
        "type": "git",
        "url": "https://github.com/<org>/<repo>.git",
        "directory": "packages/pinetree-node"
      }
      ```
- [ ] `"homepage"` — canonical docs or landing page URL
- [ ] `"bugs"` — GitHub issues URL
- [ ] `"license"` — must match the LICENSE file in the package directory

---

## 4. npm authentication

- [ ] Log in to npm: `npm login --scope=@pinetree`
- [ ] Verify identity: `npm whoami`
- [ ] For CI/CD, create an npm **Automation** token (bypasses 2FA for
      non-interactive publish) and store it as a repo secret (`NPM_TOKEN`)
- [ ] Confirm the token has publish access to the `@pinetree` org

---

## 5. Version bump

- [ ] Review [version-strategy.md](./version-strategy.md) to determine the
      correct next version for each package
- [ ] Update `"version"` in each package's `package.json` to the release
      version (e.g. `0.1.0-beta.1`)
- [ ] Update CHANGELOG.md — move items from `[Unreleased]` to the new version
      section and set today's date
- [ ] For `@pinetree/react`: if `@pinetree/js` was bumped, update the
      `"dependencies"` entry from the `file:` reference to a semver range:
      ```json
      "dependencies": { "@pinetree/js": "^0.4.0" }
      ```
- [ ] Commit the version bump (do not tag yet):
      ```bash
      git add packages/pinetree-node/package.json packages/pinetree-node/CHANGELOG.md
      git commit -m "chore(node): bump to 0.1.0-beta.1"
      ```

---

## 6. Build verification

- [ ] Clean the dist directories:
      ```bash
      rm -rf packages/pinetree-node/dist
      rm -rf packages/pinetree-js/dist
      rm -rf packages/pinetree-react/dist
      ```
- [ ] Rebuild all packages:
      ```bash
      npm run build --workspace packages/pinetree-node
      npm run build --workspace packages/pinetree-js
      npm run build --workspace packages/pinetree-react
      ```
- [ ] Run the full release-candidate validation:
      ```bash
      npm run release-candidate
      ```
      All checks must pass before continuing.

---

## 7. Package dry-runs

Run `npm pack --dry-run` for each package and review the file list:

```bash
npm pack --dry-run --workspace packages/pinetree-node
npm pack --dry-run --workspace packages/pinetree-js
npm pack --dry-run --workspace packages/pinetree-react
```

Confirm the archive includes:

- [ ] `package.json`
- [ ] `README.md`
- [ ] `CHANGELOG.md`
- [ ] `dist/esm/index.js`
- [ ] `dist/cjs/index.js`
- [ ] `dist/types/index.d.ts`

Confirm the archive does **not** include:

- [ ] `src/`
- [ ] `test/`
- [ ] `scripts/`
- [ ] `tsconfig*.json`
- [ ] `vitest.config.ts`
- [ ] `.env*` files
- [ ] Any `.tsbuildinfo` file

---

## 8. Tarball inspection

Generate actual tarballs and inspect the contents:

```bash
cd packages/pinetree-node && npm pack
tar tf pinetree-node-0.1.0-beta.1.tgz
```

Repeat for `pinetree-js` and `pinetree-react`. Verify the file tree matches
expectations from step 7. Remove the generated `.tgz` files after inspection:

```bash
rm packages/pinetree-node/*.tgz
rm packages/pinetree-js/*.tgz
rm packages/pinetree-react/*.tgz
```

---

## 9. Private flag removal — release commit only

**Do not remove `"private": true` before this step.**

In the release commit only, set `"private": false` (or remove the field) for
each package being published. Keep all other packages private.

```bash
# Edit packages/pinetree-node/package.json — remove "private": true
git add packages/pinetree-node/package.json
git commit -m "release(node): 0.1.0-beta.1"
git tag @pinetree/node@0.1.0-beta.1
```

---

## 10. Publish

Publish each package from the repo root using the npm workspace flag.
Use `--tag beta` for pre-release versions so `npm install @pinetree/node`
installs the stable version (not the beta).

```bash
# Beta release
npm publish --workspace packages/pinetree-node --tag beta --access public

# Stable release (omit --tag; defaults to "latest")
npm publish --workspace packages/pinetree-node --access public
```

Repeat for `@pinetree/js` and `@pinetree/react`.

**Publish order for a coordinated release:**
1. `@pinetree/node` (no inter-package deps)
2. `@pinetree/js` (no inter-package deps)
3. `@pinetree/react` (depends on `@pinetree/js`)

---

## 11. Post-publish smoke test

In a fresh directory outside this repo, install the newly published package
and verify basic functionality:

```bash
mkdir /tmp/pinetree-smoke && cd /tmp/pinetree-smoke
npm init -y
npm install @pinetree/node@beta

node -e "
const { default: PineTree } = require('@pinetree/node');
const client = new PineTree('pt_live_test');
console.log('import ok, client type:', typeof client);
"
```

Repeat for `@pinetree/js` (browser bundle import check) and `@pinetree/react`
(import of named exports from the package root).

- [ ] Package installs without errors
- [ ] Imports resolve (ESM and CJS)
- [ ] TypeScript types resolve (`npx tsc --noEmit` in the smoke dir)
- [ ] `npm view @pinetree/node@beta dist-tags` shows the new version

---

## 12. Rollback / deprecate

If a critical bug is found after publishing, respond within 72 hours:

**Option A — Deprecate** (preferred; keeps the package resolvable by pinned
consumers):

```bash
npm deprecate @pinetree/node@0.1.0-beta.1 "Critical bug — upgrade to 0.1.0-beta.2"
```

Then publish a fixed version (`0.1.0-beta.2`) immediately.

**Option B — Unpublish** (only if no consumer could have installed yet, and
within 72 h of the original publish):

```bash
npm unpublish @pinetree/node@0.1.0-beta.1
```

npm will refuse `unpublish` after 72 hours unless the package is the only
version of the package — prefer deprecation.

After rollback:

- [ ] Revert `"private": true` in `package.json` and push
- [ ] Add a CHANGELOG entry documenting the yanked version
- [ ] Notify any known consumers
