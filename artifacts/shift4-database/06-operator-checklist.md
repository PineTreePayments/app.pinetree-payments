# Shift4 database release operator checklist

- [ ] Confirm migrations 1-5 listed as installed in 02-apply-order.txt are present and hash-exact; do not rerun them.
- [ ] Confirm an approved disposable/staging PostgreSQL target; never infer production authorization.
- [ ] Verify all feature flags remain disabled.
- [ ] Verify every migration SHA-256 against 00-manifest.json.
- [ ] Run 01-preflight.sql read-only and resolve every exception.
- [ ] Apply only migration 6, 20260802030000_fix_ledger_posting_link_alias.sql, using the approved migration mechanism.
- [ ] Run 03-postflight.sql and retain its complete output, including exact post_ledger_transaction owner, SECURITY DEFINER, search_path, and EXECUTE checks.
- [ ] Run 04-smoke-tests.sql without supplying merchant, connection, payment, credential, or customer data; it generates all synthetic fixtures inside its rollback-only transaction.
- [ ] Confirm S05 rejects account/merchant mismatch, the smoke success result is returned, final containment assertions pass, and the last statement is ROLLBACK.
- [ ] Record runtime evidence separately; this repository package says not_executed.
- [ ] If any gate fails, follow 05-containment.sql and preserve all evidence.
- [ ] Enable no Shift4 traffic until provider credentials, certification, device, onboarding, and production gates are separately approved.
