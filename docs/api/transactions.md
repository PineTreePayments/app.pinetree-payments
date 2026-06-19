# Transactions

Transaction APIs are internal dashboard APIs. They are not part of the public `/api/v1` developer contract.

Implemented route:

| Method | Path | Classification | Purpose |
|---|---|---|---|
| `GET` | `/api/transactions` | Internal dashboard | Merchant transaction list for the dashboard. |

Admin transaction routes exist under `/api/admin/transactions` and require admin authentication.

Public integrations should use checkout sessions, payment retrieval, and webhooks for reconciliation.
