# Dependency Risk Register

Review date: 2026-07-18

This register records the result of the production dependency hardening pass. Counts are npm advisory package records, not a count of independently exploitable PineTree defects. Runtime reachability is assessed conservatively: a dependency is not called harmless merely because PineTree does not import the vulnerable leaf package directly.

## Audit summary

| Scope | Critical | High | Moderate | Low | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Production before this pass | 4 | 26 | 113 | 23 | 166 |
| Production after this pass | 0 | 10 | 45 | 1 | 56 |
| All dependencies after this pass | 0 | 11 | 48 | 2 | 61 |

The all-dependency result contains one additional high finding in development-only Solidity tooling. `npm ls --omit=dev --all` and `npm ls --all` both complete successfully. The lock was generated and clean-installed with npm 10.9.8. No force flags, legacy peer mode, audit-force fix, dependency override, or manual lock edit was used.

## Changes made

Removed direct packages after repository-wide import checks showed no active product use:

- `coinbase-commerce-node`
- `@solana/wallet-adapter-base`
- `@solana/wallet-adapter-react`
- `@solana/wallet-adapter-react-ui`
- `@solana/wallet-adapter-wallets`
- `@solana-mobile/wallet-adapter-mobile`
- `@supabase/auth-helpers-nextjs`
- `@dynamic-labs/spark`
- `qrcode.react`
- `react-qr-code`

Upgraded direct packages:

- Dynamic React, Ethereum, Solana, and Bitcoin packages: `^4.90.0` to `^4.92.4`
- Mesh SDK: `^3.9.8` to `^3.10.4`
- Solana SPL Token: `^0.4.14` to `^0.4.15`
- WalletConnect Ethereum provider and universal provider: `^2.23.8` to `^2.23.10`
- Next.js and `eslint-config-next`: `16.1.6` to `16.2.10`
- React and React DOM: `19.2.3` to `19.2.7`
- UUID: `^13.0.0` to `^13.0.2`
- viem: `^2.48.4` to `^2.55.2`
- wagmi: `^3.6.4` to `^3.7.3`
- ws: `^8.21.0` to `^8.21.1`

The active Phantom/Solflare encryption and Solana signing code imports `bs58` and `tweetnacl`. They are now declared directly at `^6.0.0` and `^1.0.3` instead of relying on unrelated wallet packages to install them transitively.

Safe in-range transitive lock updates also moved `flatted` to 3.4.2, `minimatch` to patched 3.1.5/9.0.9 releases, and eligible ws 7 copies to 7.5.13. Those updates removed two high development findings and removed vulnerable ws 7 copies from the production audit. The independently versioned `@dynamic-labs/sdk-api-core` clients remain at the revisions selected by their parents; all other `@dynamic-labs/*` SDK packages resolve to 4.92.4.

The removed dependency graph eliminated the critical `request`/Coinbase Commerce and protobuf/Trezor paths. It also removed unused aggregate Solana adapters, Keystone/legacy QR paths, and their associated advisories. Active Dynamic, Bitcoin, Solana, Base/EVM, WalletConnect, Stripe, and provider integrations remain installed.

## Remaining production critical and high findings

There are no remaining critical findings. The ten high package records are below.

| Package and installed version | Dependency path / use | Reachability and mitigation | Fixed version / next action / owner |
| --- | --- | --- | --- |
| `@dynamic-labs/bitcoin` 4.92.4 (direct) | PineTree -> Dynamic Bitcoin -> browser-wallet-client, waas, wallet-connector-core, and sats-connect | Active browser-side Bitcoin wallet integration. The vulnerable leaf behavior may be reachable during wallet connection or request processing. Keep wallet inputs bounded and trusted-origin UI controls in place. | npm proposes 4.25.10, an unsafe feature downgrade that does not provide a supported forward fix. Track a patched Dynamic release. Owner: Dynamic. |
| `@dynamic-labs/solana-core` 4.92.4 | PineTree -> Dynamic Solana -> solana-core -> wallet-connector-core, SPL Token, and web3.js | Active browser-side Dynamic Solana integration. Some underlying Solana parsing is also used by PineTree server transaction code, so this is treated as potentially reachable. | No safe npm fix is available. Upgrade when Dynamic publishes a compatible release with patched Solana leaves. Owner: Dynamic/Solana. |
| `@sats-connect/core` 0.10.0 | PineTree -> Dynamic Bitcoin -> sats-connect -> core -> Axios 1.12.0 and Valibot 1.1.0 | Browser-side Bitcoin connector. PineTree does not call the core package directly, but wallet/provider responses can reach it. Avoid passing arbitrary server URLs or unbounded objects into wallet calls. | Patched Axios is >=1.16.0 and patched Valibot is >1.1.0, but sats-connect pins both exact vulnerable versions. npm only proposes an unsafe Dynamic downgrade. Owner: Sats Connect/Dynamic. |
| `sats-connect` 4.2.1 | PineTree -> Dynamic Bitcoin -> sats-connect | Active browser-side Bitcoin connector and aggregation record for its vulnerable exact child pins. | No safe child substitution exists in the current package contract. Track a sats-connect release, then a Dynamic release consuming it. Owner: Sats Connect/Dynamic. |
| `axios` 1.12.0 | PineTree -> Dynamic Bitcoin -> sats-connect -> `@sats-connect/core` -> Axios | This is not PineTree's server HTTP client (the root Axios is patched). It is browser-wallet code, but request configuration, proxy-related Node paths, parsing, and unbounded-input advisories remain potentially relevant wherever the SDK invokes them. | Fixed at >=1.16.0 for the current audit range; the parent pins 1.12.0 exactly. Do not override. Owner: Sats Connect/Dynamic. |
| `valibot` 1.1.0 | PineTree -> Dynamic Bitcoin -> sats-connect -> Valibot | Browser-side validation. The emoji-regex ReDoS may be reachable if attacker-controlled wallet metadata is validated. PineTree does not invoke the vulnerable regex directly. | Fixed after 1.1.0; sats-connect pins 1.1.0 exactly. Owner: Sats Connect/Dynamic. See [GHSA-vqpr-j7v3-hqw9](https://github.com/advisories/GHSA-vqpr-j7v3-hqw9). |
| `@solana/buffer-layout-utils` 0.3.0 and nested 0.2.0 | PineTree -> direct SPL Token and Dynamic Solana -> buffer-layout-utils -> web3.js/bigint-buffer | SPL Token is imported by server-side wallet withdrawal, settlement withdrawal, and Solana split-transaction code. Transaction/account bytes may reach layout decoders, so the finding is potentially reachable. | npm proposes SPL Token 0.1.8, an unsafe downgrade. No compatible patched path exists. Owner: Solana maintainers/Dynamic. |
| `@solana/spl-token` 0.4.15 (direct) and nested 0.4.14 | PineTree and Dynamic Solana -> SPL Token -> buffer-layout-utils, token group/metadata, and web3.js | Active server and browser Solana functionality. This is the aggregate audit record for vulnerable children and is treated as reachable. Existing code validates merchant ownership and transaction inputs but cannot patch the leaf. | npm proposes 0.1.8, an unsafe downgrade. Track a forward SPL Token and Dynamic update. Owner: Solana maintainers/Dynamic. |
| `bigint-buffer` 1.1.5 | PineTree -> SPL Token -> buffer-layout-utils -> bigint-buffer | Native `toBigIntLE` has a buffer-overflow advisory. PineTree has no direct call, but SPL layout processing can reach the package, so server-side reachability cannot be excluded. | No patched package release is available; npm suggests an unsafe SPL Token downgrade. Track [GHSA-3gc7-fjrx-p6mg](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg). Owner: bigint-buffer/Solana maintainers. |
| `ws` 8.18.2/8.18.3 nested copies | PineTree -> Dynamic embedded Solana/Dynamic Solana and WalletConnect core/sign-client -> ws | These SDKs use ws as outbound/browser or client transport. PineTree exposes no inbound WebSocket server using these copies, which materially reduces the server-fragment DoS path, but it does not eliminate all client memory risk. Root ws is patched at 8.21.1 and eligible ws 7 copies are patched at 7.5.13. | Fixed at >=8.21.0 for the affected v8 range. Parent constraints/bundling prevent safe dedupe; no npm fix is available. Track [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) and [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p). Owner: Dynamic/WalletConnect. |

### Axios advisory set

The single Axios package record currently aggregates the following high advisories against the exact nested 1.12.0 copy: [GHSA-3p68-rc4w-qgx5](https://github.com/advisories/GHSA-3p68-rc4w-qgx5), [GHSA-w9j2-pvgh-6h63](https://github.com/advisories/GHSA-w9j2-pvgh-6h63), [GHSA-pmwg-cvhr-8vh7](https://github.com/advisories/GHSA-pmwg-cvhr-8vh7), [GHSA-3w6x-2g7m-8v23](https://github.com/advisories/GHSA-3w6x-2g7m-8v23), [GHSA-xhjh-pmcv-23jw](https://github.com/advisories/GHSA-xhjh-pmcv-23jw), [GHSA-445q-vr5w-6q77](https://github.com/advisories/GHSA-445q-vr5w-6q77), [GHSA-m7pr-hjqh-92cm](https://github.com/advisories/GHSA-m7pr-hjqh-92cm), [GHSA-5c9x-8gcm-mpgx](https://github.com/advisories/GHSA-5c9x-8gcm-mpgx), [GHSA-vf2m-468p-8v99](https://github.com/advisories/GHSA-vf2m-468p-8v99), [GHSA-pf86-5x62-jrwf](https://github.com/advisories/GHSA-pf86-5x62-jrwf), [GHSA-6chq-wfr3-2hj9](https://github.com/advisories/GHSA-6chq-wfr3-2hj9), [GHSA-xx6v-rp6x-q39c](https://github.com/advisories/GHSA-xx6v-rp6x-q39c), [GHSA-43fc-jf86-j433](https://github.com/advisories/GHSA-43fc-jf86-j433), [GHSA-q8qp-cvcw-x6jj](https://github.com/advisories/GHSA-q8qp-cvcw-x6jj), [GHSA-fvcv-3m26-pcqx](https://github.com/advisories/GHSA-fvcv-3m26-pcqx), [GHSA-62hf-57xw-28j9](https://github.com/advisories/GHSA-62hf-57xw-28j9), [GHSA-hfxv-24rg-xrqf](https://github.com/advisories/GHSA-hfxv-24rg-xrqf), [GHSA-777c-7fjr-54vf](https://github.com/advisories/GHSA-777c-7fjr-54vf), [GHSA-p92q-9vqr-4j8v](https://github.com/advisories/GHSA-p92q-9vqr-4j8v), [GHSA-j5f8-grm9-p9fc](https://github.com/advisories/GHSA-j5f8-grm9-p9fc), [GHSA-3g43-6gmg-66jw](https://github.com/advisories/GHSA-3g43-6gmg-66jw), [GHSA-35jp-ww65-95wh](https://github.com/advisories/GHSA-35jp-ww65-95wh), and [GHSA-898c-q2cr-xwhg](https://github.com/advisories/GHSA-898c-q2cr-xwhg).

## Remaining development-only high finding

| Package and installed version | Dependency path / reachability | Fixed version / mitigation / owner |
| --- | --- | --- |
| `tmp` 0.0.33 | PineTree dev dependency -> solc 0.8.34 -> tmp. It is absent from `npm audit --omit=dev` and the deployed runtime. Risk is limited to trusted local/CI Solidity compilation; do not feed attacker-controlled temp prefixes, postfixes, or directories to build tooling. | Fixed at >=0.2.6, but even solc 0.8.36 pins 0.0.33. npm proposes solc 0.5.0, an unsafe downgrade. Track [GHSA-ph9p-34f9-6g65](https://github.com/advisories/GHSA-ph9p-34f9-6g65) and [GHSA-52f5-9888-hmc6](https://github.com/advisories/GHSA-52f5-9888-hmc6). Owner: solc. |

## Follow-up policy

- Re-run both production and all-dependency audits on every wallet SDK upgrade and at least monthly.
- Prefer forward releases from Dynamic, Sats Connect, WalletConnect, and Solana maintainers. Do not use npm's proposed Dynamic 4.25.10 or SPL Token 0.1.8 downgrades.
- Re-test Bitcoin connection/PSBT flows, Solana transaction and withdrawal flows, Dynamic provisioning, WalletConnect, and the full application whenever one of the blocked parents is upgraded.
- Keep root Axios and ws dependencies patched even though the currently vulnerable copies are nested.
- Remove an accepted item only after a clean npm 10 install and both audit scopes prove that its vulnerable path is gone.
