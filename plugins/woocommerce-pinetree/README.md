# PineTree Payments for WooCommerce

Official WooCommerce payment gateway plugin for [PineTree Payments](https://app.pinetree-payments.com).

> **Ready for install testing.** Not for distribution or publication to WordPress.org.

---

## Requirements

- PHP 8.0+
- WordPress 6.0+
- WooCommerce 7.0+
- A PineTree Payments merchant account with a `pt_live_*` API key

---

## Installation

1. Copy `plugins/woocommerce-pinetree/` into your WordPress site's `wp-content/plugins/` directory.
2. Activate **PineTree Payments for WooCommerce** in **WordPress admin → Plugins**.
3. Configure the gateway (see below).

---

## Configuration

Navigate to **WooCommerce → Settings → Payments → PineTree Payments**.

### Settings fields

| Field | Description |
|---|---|
| **Enable/Disable** | Toggle the payment method on or off at checkout. |
| **Title** | Payment method label shown to customers. Default: `Crypto Payments`. |
| **Description** | Short description shown below the title at checkout. |
| **PineTree Secret Key** | Your `pt_live_*` API key from **PineTree dashboard → Developer**. Server-only — never exposed in browser code, logs, or `NEXT_PUBLIC_` variables. |
| **PineTree Public Key** | Optional `pk_live_*` public key. Reserved for future browser-side flows. |
| **Webhook Secret** | Signing secret from your PineTree webhook configuration. Required to verify all incoming events. |
| **API Base URL** | Override the PineTree API base URL (e.g., `http://localhost:3000` for local development). Leave blank for production. |
| **Webhook URL** | Read-only. The URL to register in PineTree dashboard → Developer → Webhooks (see below). |

---

## Webhook Setup

1. Copy the **Webhook URL** shown in the gateway settings page:
   ```
   https://your-site.com/?wc-api=pinetree_webhook
   ```
2. Open **PineTree dashboard → Developer → Webhooks**.
3. Add the URL and select all `checkout.session.*` events.
4. Copy the signing secret into the **Webhook Secret** field in WooCommerce.

---

## Checkout Flow

```
Customer selects "Crypto Payments" → Places order
  → process_payment() called
  → POST /api/v1/checkout/sessions (amount, currency, order ID, customer email, success/cancel URLs)
  → WooCommerce order set to "pending"
  → Customer redirected to session.checkoutUrl (PineTree hosted checkout)
  → Customer selects wallet/rail, completes payment
  → PineTree redirects to successUrl (WooCommerce thank-you page)
  → PineTree fires checkout.session.completed webhook → order updated to "processing"
```

**Idempotency:** Each session creation uses a stable key derived from the order ID and order key, so retrying a failed HTTP request cannot double-charge a customer.

---

## Webhook Flow

```
PineTree fires POST to ?wc-api=pinetree_webhook
  → Raw body read from php://input
  → PineTree-Signature and PineTree-Timestamp headers extracted
  → HMAC-SHA256 verified over PineTree-Timestamp + "." + raw body (hash_equals, timing-safe)
  → Timestamp checked within 300-second window
  → Event payload validated against the PineTree webhook contract (eventId, type, schema, createdAt, livemode, data.object)
  → WooCommerce order resolved via metadata.wc_order_id (fallback: reference field)
  → Order status updated
  → HTTP 200 returned
```

### Event → order status mapping

| PineTree event | WooCommerce status |
|---|---|
| `checkout.session.completed` | `processing` (via `payment_complete()`) |
| `checkout.session.paid` | legacy alias for `checkout.session.completed` |
| `checkout.session.processing` | `on-hold` |
| `checkout.session.failed` | `failed` |
| `checkout.session.expired` | `cancelled` |
| `checkout.session.canceled` | `cancelled` |

---

## Admin Notices

The plugin shows admin notices when:
- **WooCommerce is not active** — error notice on all admin pages.
- **Gateway is enabled but API key is missing** — warning notice.
- **Gateway is enabled but webhook secret is missing** — warning notice.

---

## Order Meta

The gateway stores the following on each WooCommerce order:

| Meta key | Value |
|---|---|
| `_pinetree_session_id` | PineTree checkout session ID (e.g., `cs_...`) |
| `_pinetree_payment_id` | PineTree payment ID (e.g., `pay_...`), set on confirmation |

---

## Local Development

Set **API Base URL** to `http://localhost:3000` in the gateway settings to route
all API calls to your local PineTree dev server. The webhook URL must be publicly
reachable (use [ngrok](https://ngrok.com/) or similar).

---

## Tests

Run the plugin's standalone PHP test suite (no PHPUnit required):

```bash
php plugins/woocommerce-pinetree/tests/run.php
```

Or run the full validation script (PHP syntax + secret scan + tests):

```bash
node scripts/validate-woocommerce-plugin.mjs
```

---

## Plugin Structure

```
plugins/woocommerce-pinetree/
├── woocommerce-pinetree.php          # Plugin bootstrap, hooks, admin notices
├── includes/
│   ├── class-pinetree-api.php        # HTTP client for PineTree API
│   ├── class-pinetree-gateway.php    # WC_Payment_Gateway subclass
│   └── class-pinetree-webhook.php    # Webhook verification and dispatch
├── tests/
│   ├── bootstrap.php                 # WP/WC stubs for standalone testing
│   ├── PineTreeApiTest.php           # API client tests (6 tests)
│   ├── PineTreeWebhookTest.php       # Webhook tests (17 tests)
│   └── run.php                       # Standalone test runner
└── README.md
```

---

## Security Notes

- `pt_live_*` keys are stored in the WordPress options table (same as all WC gateway credentials) and are never exposed in browser source, logs, or API responses.
- Webhook signatures use HMAC-SHA256 over `PineTree-Timestamp + "." + raw body` with `hash_equals()` (timing-safe comparison).
- The timestamp tolerance window is 300 seconds — events older than 5 minutes are rejected.
- Both current (`PineTree-*`) and legacy (`X-PineTree-*`) header names are supported.
