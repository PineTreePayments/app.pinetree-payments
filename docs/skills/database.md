# ROLE: Database

## Rules
- payments.status is source of truth
- Only engine updates status

## Never
- UI updates
- Provider updates
- Watcher updates