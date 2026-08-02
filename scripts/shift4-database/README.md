# Shift4 database release package

Run `npm run shift4:database:release` to validate the six ordered migration source contracts and regenerate the reviewed SQL under `artifacts/shift4-database/`. The command performs no database or network access and reports `runtimeStatus: not_executed`.

Migrations 1-5 are already deployed and remain in the manifest for byte/hash provenance; do not rerun or modify them. Run preflight, apply only `20260802030000_fix_ledger_posting_link_alias.sql`, and run postflight before repeating the fail-fast smoke SQL. Migration 6 replaces the exact installed `post_ledger_transaction` signature with alias-safe `jsonb_array_elements` ranges, reasserts its owner and privileges, and changes no financial behavior. The smoke script remains self-provisioning and rollback-contained. The containment artifact preserves production attempts, journal postings, onboarding evidence, and recovery data; it never proposes destructive schema rollback.
