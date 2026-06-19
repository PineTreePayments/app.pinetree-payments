# Payment States

PineTree separates public API status values from the developer-facing state labels shown in dashboards and documentation.

The visible successful terminal label is **Confirmed**. Do not use **Success** as a payment state label.

## Visible lifecycle

| Visible State | Meaning | Terminal | Color |
|---|---|---:|---|
| Waiting | Payment request open, no funds detected | No | Blue |
| Processing | Payment detected, awaiting final confirmation | No | Blue |
| Confirmed | Payment completed | Yes | Green |
| Failed | Provider/network/payment attempt failed | Yes | Red |
| Expired | Payment window timed out | Yes | Red |
| Incomplete | Customer abandoned/backed out/no funds sent | Yes | Red |

## Internal and public mapping

| Internal/canonical status | Public API status | Visible label | Typical webhook |
|---|---|---|---|
| `CREATED` | `open` | Waiting | `payment.created` |
| `PENDING` | `open` | Waiting | `payment.pending` |
| `PROCESSING` | `processing` | Processing | `payment.processing` |
| `CONFIRMED` | `paid` | Confirmed | `payment.confirmed` |
| `FAILED` | `failed` | Failed | `payment.failed` |
| `EXPIRED` | `expired` | Expired | `payment.expired` |
| `INCOMPLETE` | `canceled` for checkout sessions, `canceled`/`incomplete` depending on public object mapping | Incomplete | `payment.incomplete` |
| `CANCELED` or `CANCELLED` | `canceled` | Incomplete | `payment.cancelled` |
| `REFUNDED` | `open` unless surfaced through a refund-specific event/object | Failed/adjustment context | `payment.refunded` |

Public checkout sessions currently expose `open`, `processing`, `paid`, `failed`, `expired`, and `canceled`. Payment objects use the same mapper in code, so the successful public value is `paid` while the visible product label is **Confirmed**.

## Terminal behavior

`Confirmed`, `Failed`, `Expired`, and `Incomplete` are terminal for merchant fulfillment decisions. `Failed`, `Expired`, and `Incomplete` are all negative terminal labels, but they do not mean the same thing:

- `Failed` means an attempted payment failed validation, provider handling, or network execution.
- `Expired` means an explicit provider/payment/session window timed out.
- `Incomplete` means the customer abandoned, backed out, switched methods, or no funds were sent before stale cleanup.

Stale or abandoned payments are marked `INCOMPLETE` when the stale payment sweep handles them. Provider-expired payments may be `EXPIRED` when explicitly set by the provider or lifecycle route.
