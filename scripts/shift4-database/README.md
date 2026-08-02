# Shift4 database release package

Run `npm run shift4:database:release` to validate the four migration source contracts and regenerate the reviewed SQL under `artifacts/shift4-database/`. The command performs no database or network access.

Controlled execution order is preflight, the four migrations in filename order, postflight, and the smoke-test template inside a disposable transaction. The containment artifact disables runtime flags while retaining attempts, journal postings, onboarding evidence, and recovery data; it never proposes destructive schema rollback.
