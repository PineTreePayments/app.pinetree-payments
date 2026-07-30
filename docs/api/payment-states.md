# Payment States

PineTree separates strict engine states, public API status values, provider states, and merchant-facing labels. The authoritative presentation contract is the [Merchant Status Architecture](../architecture.md#merchant-status-architecture-authoritative).

The visible positive terminal label is **Confirmed**. Do not use **Success** as a payment state label.

## Visible lifecycle

| Visible State | Meaning | Terminal | Color |
|---|---|---:|---|
| Waiting | Payment request open, no funds detected | No | Blue |
| Processing | Payment detected, awaiting final confirmation | No | Darker blue |
| Confirmed | Payment confirmed | Yes | Green |
| Failed | Provider/network/payment attempt failed | Yes | Red |
| Incomplete | Request ended without payment submission | Yes | Amber |
| Expired | Payment window timed out | Yes | Muted red |
| Canceled | Customer or merchant explicitly canceled the payment | Yes | Gray |
| Refunded | Settled funds were returned | Yes | Orange |
| Unknown | Provider/network outcome needs investigation; recovery continues | No | Neutral gray |

## Strict engine lifecycle

The PineTree Engine owns canonical payment state and accepts these strict lifecycle states:

```text
CREATED -> PENDING -> PROCESSING -> CONFIRMED
                 \-> INCOMPLETE
                         PROCESSING -> FAILED
CREATED/PENDING/PROCESSING -> UNKNOWN -> PROCESSING or a canonical terminal state
```

`CONFIRMED`, `FAILED`, `INCOMPLETE`, `EXPIRED`, and `CANCELED` are terminal
engine states. Provider-specific words are normalized at adapter boundaries;
refund adjustments remain outside the payment state machine.

## Internal and public mapping

| Internal/canonical status | Public API status | Visible label | Typical webhook |
|---|---|---|---|
| `CREATED` | `open` | Waiting | `payment.created` |
| `PENDING` | `open` | Waiting | `payment.pending` |
| `PROCESSING` | `processing` | Processing | `payment.processing` |
| `CONFIRMED` | `paid` | Confirmed | `payment.confirmed` |
| `FAILED` | `failed` | Failed | `payment.failed` |
| `EXPIRED` provider/display input | `expired` | Expired | `payment.expired` |
| `INCOMPLETE` | `incomplete` | Incomplete | `payment.incomplete` |
| `CANCELED` or `CANCELLED` provider/display input | `canceled` | Canceled | `payment.canceled` |
| `UNKNOWN` | `unknown` | Unknown | `payment.unknown` |
| `REFUNDED` transaction adjustment | refund-specific object/event | Refunded | `payment.refunded` |

Public checkout sessions expose `open`, `processing`, `paid`, `failed`,
`incomplete`, `expired`, `canceled`, and `unknown`. Payment objects use the same mapper in
code, so the positive public value is `paid` while the visible product label is
**Confirmed**.

## Terminal behavior

`Confirmed`, `Failed`, `Expired`, `Canceled`, and `Refunded` are terminal for merchant fulfillment decisions. They do not mean the same thing:

- `Failed` means an attempted payment failed validation, provider handling, or network execution.
- `Expired` means an explicit provider/payment/session window timed out.
- `Incomplete` means the request ended without submission or authoritative failure evidence.
- `Canceled` means the customer or merchant explicitly canceled the canonical payment.
- `Refunded` means a previously settled payment was returned.

Stale or abandoned payments are marked `INCOMPLETE` by the stale payment sweep
and display as Incomplete. Explicit expiry and cancellation evidence remain
Expired and Canceled respectively.
