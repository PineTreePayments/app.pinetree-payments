# WooCommerce Test Checklist

Use a disposable WordPress and WooCommerce staging site. Do not install the
private plugin on a production store for initial validation.

## Prerequisites

- PHP 8 or later
- Current WordPress and WooCommerce test installation
- HTTPS test-site URL
- PineTree staging merchant account
- Staging-only `pt_live_*` secret API key
- PineTree webhook endpoint and signing secret
- PineTree staging base URL

The plugin stores these values in WooCommerce gateway settings:

| Setting | Value |
|---|---|
| PineTree Secret Key | Staging merchant `pt_live_*` key |
| Webhook Secret | Secret shown when the staging webhook is created |
| PineTree Base URL | PineTree staging deployment URL |

Never put the API key or webhook secret in browser JavaScript, screenshots,
support exports, or public logs.

## Local plugin validation

```bash
node scripts/validate-woocommerce-plugin.mjs
```

If PHP is unavailable, static validation still runs and PHP checks are reported
as skipped. Install PHP 8+ before final test-site validation.

## Safe install sequence

1. Zip or copy `plugins/woocommerce-pinetree` into the test WordPress site.
2. Activate the plugin.
3. Open WooCommerce > Settings > Payments > PineTree Payments.
4. Enter the staging base URL, API key, and webhook secret.
5. Use the plugin connection test.
6. Enable PineTree only for the disposable test store.
7. Create a low-value test order.
8. Confirm checkout redirects to the PineTree staging checkout URL.
9. Complete or simulate payment through approved staging tools.
10. Confirm the signed webhook marks the WooCommerce order paid.
11. Replay the same event and confirm it is ignored.
12. Test manual sync against the PineTree checkout session.

## Expected results

- No secret appears in plugin status output.
- Checkout session creation returns a PineTree checkout URL.
- The customer is redirected to PineTree Checkout.
- Signed webhook delivery updates the order once.
- Duplicate delivery does not update the order again.
- Manual sync updates the order from PineTree session state.

## Common failures

- Connection test fails: base URL is wrong, staging is unreachable, or API key
  is invalid.
- Checkout returns unauthorized: the API key belongs to another environment or
  was revoked.
- Webhook rejected: signing secret differs between PineTree and WooCommerce.
- Order remains pending: webhook URL is blocked by firewall, TLS, or WordPress
  security middleware.
- PHP tests skipped: PHP is not installed in the validation environment.
