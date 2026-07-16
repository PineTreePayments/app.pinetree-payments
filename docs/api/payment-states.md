# Payment States

PineTree separates public API status values from merchant-facing labels. The authoritative presentation contract is the [Merchant Status Architecture](../architecture.md#merchant-status-architecture-authoritative).

The visible successful terminal label is **Confirmed**. Do not use **Success** as a payment state label.

## Visible lifecycle

| Visible State | Meaning | Terminal | Color |
|---|---|---:|---|
| Waiting | Payment request open, no funds detected | No | Blue |
| Processing | Payment detected, awaiting final confirmation | No | Darker blue |
| Confirmed | Payment completed | Yes | Green |
| Failed | Provider/network/payment attempt failed | Yes | Red |
| Expired | Payment window timed out | Yes | Red |
| Canceled | Customer canceled or abandoned the payment | Yes | Gray |
| Refunded | Settled funds were returned | Yes | Orange |
| Unknown | Status is not recognized | No | Neutral gray |

## Internal and public mapping

| Internal/canonical status | Public API status | Visible label | Typical webhook |
|---|---|---|---|
| `CREATED` | `open` | Waiting | `payment.created` |
| `PENDING` | `open` | Waiting | `payment.pending` |
| `PROCESSING` | `processing` | Processing | `payment.processing` |
| `CONFIRMED` | `paid` | Confirmed | `payment.confirmed` |
| `FAILED` | `failed` | Failed | `payment.failed` |
| `EXPIRED` | `expired` | Expired | `payment.expired` |
| `INCOMPLETE` | `canceled` | Canceled, or Expired with explicit expiry evidence | `payment.incomplete` or `payment.expired` |
| `CANCELED` or `CANCELLED` | `canceled` | Canceled | `payment.canceled` |
| `REFUNDED` transaction adjustment | refund-specific object/event | Refunded | `payment.refunded` |

Public checkout sessions currently expose `open`, `processing`, `paid`, `failed`, `expired`, and `canceled`. Payment objects use the same mapper in code, so the successful public value is `paid` while the visible product label is **Confirmed**.

## Terminal behavior

`Confirmed`, `Failed`, `Expired`, `Canceled`, and `Refunded` are terminal for merchant fulfillment decisions. They do not mean the same thing:

- `Failed` means an attempted payment failed validation, provider handling, or network execution.
- `Expired` means an explicit provider/payment/session window timed out.
- `Canceled` means the customer abandoned, backed out, switched methods, or no funds were sent before stale cleanup.
- `Refunded` means a previously settled payment was returned.

Stale or abandoned payments are marked `INCOMPLETE` internally when the stale payment sweep handles them and display as Canceled. Explicit expiry evidence displays as Expired.
