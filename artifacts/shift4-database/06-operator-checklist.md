# Shift4 database release operator checklist

- [ ] Confirm an approved disposable/staging PostgreSQL target; never infer production authorization.
- [ ] Verify all feature flags remain disabled.
- [ ] Verify every migration SHA-256 against 00-manifest.json.
- [ ] Run 01-preflight.sql read-only and resolve every exception.
- [ ] Apply migrations exactly in 02-apply-order.txt order using the approved migration mechanism.
- [ ] Run 03-postflight.sql and retain its complete output.
- [ ] Prepare isolated synthetic parents and run 04-smoke-tests.sql; confirm final ROLLBACK.
- [ ] Record runtime evidence separately; this repository package says not_executed.
- [ ] If any gate fails, follow 05-containment.sql and preserve all evidence.
- [ ] Enable no Shift4 traffic until provider credentials, certification, device, onboarding, and production gates are separately approved.
