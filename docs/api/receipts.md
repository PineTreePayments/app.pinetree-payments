# Receipts

Receipt APIs are internal app APIs used by checkout and dashboard surfaces.

Implemented routes:

| Method | Path | Classification | Purpose |
|---|---|---|---|
| `GET` | `/api/receipts/{paymentId}` | Internal receipt | Return receipt data for a payment. |
| `GET` | `/api/receipts/{paymentId}/download` | Internal receipt | Download a receipt. |

Receipt payloads are derived from payment, merchant, and settlement data. Public server integrations should store their own order receipt state from `payment.confirmed` webhooks.
