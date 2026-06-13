<?php
/**
 * PineTree WooCommerce Payment Gateway.
 *
 * Extends WC_Payment_Gateway to redirect customers to the PineTree hosted
 * checkout page and receive order-status updates via webhook.
 */

defined('ABSPATH') || exit;

class PineTree_WC_Gateway extends WC_Payment_Gateway {

    public function __construct() {
        $this->id                 = 'pinetree';
        $this->method_title       = __('PineTree Payments', 'woocommerce-pinetree');
        $this->method_description = __('Accept crypto payments via PineTree hosted checkout (private beta).', 'woocommerce-pinetree');
        $this->has_fields         = false;
        $this->supports           = ['products'];

        $this->init_form_fields();
        $this->init_settings();

        $this->title       = $this->get_option('title',       __('Crypto Payments', 'woocommerce-pinetree'));
        $this->description = $this->get_option('description', __('Pay with cryptocurrency via PineTree Payments. You will be redirected to complete your payment.', 'woocommerce-pinetree'));

        add_action(
            'woocommerce_update_options_payment_gateways_' . $this->id,
            [$this, 'process_admin_options']
        );

        // Register WC API endpoint: ?wc-api=pinetree_webhook
        add_action('woocommerce_api_pinetree_webhook', [$this, 'handle_webhook']);

        // Admin-only hooks
        add_action('wp_ajax_pinetree_wc_test_connection', [$this, 'ajax_test_connection']);
        add_action('admin_enqueue_scripts', [$this, 'enqueue_admin_scripts']);
    }

    // ------------------------------------------------------------------
    // Settings
    // ------------------------------------------------------------------

    /** {@inheritdoc} */
    public function init_form_fields(): void {
        $this->form_fields = [

            // ---- Setup instructions ----------------------------------------
            'setup_header' => [
                'title' => __('Getting Started', 'woocommerce-pinetree'),
                'type'  => 'title',
                'description' => wp_kses_post(
                    '<ol style="margin:.5em 0 0 1.2em;list-style:decimal;">'
                    . '<li>' . __('Log in to your PineTree dashboard → <strong>Developer → API Keys</strong> and copy your <code>pt_live_*</code> secret key.', 'woocommerce-pinetree') . '</li>'
                    . '<li>' . __('Go to <strong>Developer → Webhooks</strong>, create a webhook pointed at the <strong>Webhook URL</strong> below, and copy the signing secret.', 'woocommerce-pinetree') . '</li>'
                    . '<li>' . __('Paste both values into the fields below and click <strong>Save changes</strong>.', 'woocommerce-pinetree') . '</li>'
                    . '<li>' . __('Click <strong>Test Connection</strong> to confirm your secret key is valid.', 'woocommerce-pinetree') . '</li>'
                    . '</ol>'
                ),
            ],

            // ---- Enable / disable ------------------------------------------
            'enabled' => [
                'title'   => __('Enable/Disable', 'woocommerce-pinetree'),
                'type'    => 'checkbox',
                'label'   => __('Enable PineTree Payments', 'woocommerce-pinetree'),
                'default' => 'no',
            ],

            // ---- Payment display -------------------------------------------
            'checkout_display_header' => [
                'title' => __('Payment Display', 'woocommerce-pinetree'),
                'type'  => 'title',
            ],
            'title' => [
                'title'       => __('Title', 'woocommerce-pinetree'),
                'type'        => 'text',
                'description' => __('Payment method label shown to customers at checkout.', 'woocommerce-pinetree'),
                'default'     => __('Crypto Payments', 'woocommerce-pinetree'),
                'desc_tip'    => true,
            ],
            'description' => [
                'title'       => __('Description', 'woocommerce-pinetree'),
                'type'        => 'textarea',
                'description' => __('Short description shown below the title at checkout.', 'woocommerce-pinetree'),
                'default'     => __('Pay with cryptocurrency via PineTree Payments. You will be redirected to complete your payment.', 'woocommerce-pinetree'),
                'desc_tip'    => true,
            ],

            // ---- API credentials ------------------------------------------
            'credentials_header' => [
                'title'       => __('API Credentials', 'woocommerce-pinetree'),
                'type'        => 'title',
                'description' => wp_kses_post(
                    '<strong>' . __('Security:', 'woocommerce-pinetree') . '</strong> '
                    . __('<code>pt_live_*</code> secret keys are server-only. Never paste them into browser JavaScript, React apps, or environment variables prefixed with <code>NEXT_PUBLIC_</code>.', 'woocommerce-pinetree')
                ),
            ],
            'api_key' => [
                'title'       => __('PineTree Secret Key', 'woocommerce-pinetree'),
                'type'        => 'password',
                'description' => wp_kses_post(
                    __('Your <code>pt_live_*</code> key from <strong>PineTree dashboard → Developer → API Keys</strong>. Required for all API calls. Never exposed in browser source or logs.', 'woocommerce-pinetree')
                ),
                'default'     => '',
                'placeholder' => 'pt_live_...',
            ],
            'public_key' => [
                'title'       => __('PineTree Public Key', 'woocommerce-pinetree'),
                'type'        => 'text',
                'description' => wp_kses_post(
                    __('Your <code>pk_live_*</code> public key (optional). Safe to use in browser code. Reserved for future embedded checkout flows.', 'woocommerce-pinetree')
                ),
                'default'     => '',
                'placeholder' => 'pk_live_...',
            ],
            'test_connection' => [
                'title'       => __('Connection Test', 'woocommerce-pinetree'),
                'type'        => 'pinetree_test',
                'description' => __('Save your settings first, then click to verify your secret key can reach the PineTree API.', 'woocommerce-pinetree'),
            ],

            // ---- Webhook configuration ------------------------------------
            'webhook_header' => [
                'title'       => __('Webhook Configuration', 'woocommerce-pinetree'),
                'type'        => 'title',
                'description' => __('Webhooks deliver real-time payment status updates. All incoming events are verified with HMAC-SHA256 before any order update is applied.', 'woocommerce-pinetree'),
            ],
            'webhook_secret' => [
                'title'       => __('Webhook Secret', 'woocommerce-pinetree'),
                'type'        => 'password',
                'description' => wp_kses_post(
                    __('Signing secret from <strong>PineTree dashboard → Developer → Webhooks</strong>. Required to authenticate every incoming event.', 'woocommerce-pinetree')
                ),
                'default'     => '',
                'placeholder' => 'whsec_...',
            ],
            'webhook_url_display' => [
                'title' => __('Webhook URL', 'woocommerce-pinetree'),
                'type'  => 'pinetree_webhook_url',
            ],

            // ---- Advanced -------------------------------------------------
            'advanced_header' => [
                'title'       => __('Advanced', 'woocommerce-pinetree'),
                'type'        => 'title',
                'description' => __('Leave blank unless you are testing against a local or staging PineTree server.', 'woocommerce-pinetree'),
            ],
            'base_url' => [
                'title'       => __('API Base URL', 'woocommerce-pinetree'),
                'type'        => 'text',
                'description' => __('Override the PineTree API base URL. Leave blank for production (<code>https://app.pinetree-payments.com</code>).', 'woocommerce-pinetree'),
                'default'     => '',
                'placeholder' => 'https://app.pinetree-payments.com',
            ],
        ];
    }

    // ------------------------------------------------------------------
    // Custom field renderers
    // ------------------------------------------------------------------

    /** Render the "Test Connection" button row. WC calls generate_{type}_html(). */
    public function generate_pinetree_test_html(string $key, array $data): string {
        ob_start();
        ?>
        <tr valign="top">
            <th scope="row" class="titledesc">
                <label><?php echo esc_html($data['title']); ?></label>
            </th>
            <td class="forminp">
                <button type="button" id="pinetree-test-connection" class="button button-secondary">
                    <?php esc_html_e('Test Connection', 'woocommerce-pinetree'); ?>
                </button>
                <span id="pinetree-connection-status" style="margin-left:10px;display:inline-block;"></span>
                <?php if (!empty($data['description'])): ?>
                <p class="description"><?php echo esc_html($data['description']); ?></p>
                <?php endif; ?>
            </td>
        </tr>
        <?php
        return (string) ob_get_clean();
    }

    /** Render the webhook URL read-only field with a copy button. */
    public function generate_pinetree_webhook_url_html(string $key, array $data): string {
        $webhook_url = add_query_arg('wc-api', 'pinetree_webhook', get_home_url());
        ob_start();
        ?>
        <tr valign="top">
            <th scope="row" class="titledesc">
                <label><?php echo esc_html($data['title'] ?? __('Webhook URL', 'woocommerce-pinetree')); ?></label>
            </th>
            <td class="forminp">
                <div style="display:flex;gap:8px;align-items:center;max-width:500px;">
                    <input
                        type="text"
                        readonly
                        value="<?php echo esc_attr($webhook_url); ?>"
                        style="flex:1;background:#f9f9f9;cursor:text;font-family:monospace;"
                        aria-label="<?php esc_attr_e('Webhook URL', 'woocommerce-pinetree'); ?>"
                    />
                    <button type="button"
                            id="pinetree-copy-webhook-url"
                            class="button button-secondary"
                            data-url="<?php echo esc_attr($webhook_url); ?>">
                        <?php esc_html_e('Copy', 'woocommerce-pinetree'); ?>
                    </button>
                </div>
                <p class="description">
                    <?php printf(
                        /* translators: %s = dashboard location */
                        esc_html__('Register this URL in %s. Select all checkout.session.* events.', 'woocommerce-pinetree'),
                        '<strong>' . esc_html__('PineTree dashboard → Developer → Webhooks', 'woocommerce-pinetree') . '</strong>'
                    ); ?>
                </p>
            </td>
        </tr>
        <?php
        return (string) ob_get_clean();
    }

    // ------------------------------------------------------------------
    // Admin: connection test AJAX
    // ------------------------------------------------------------------

    public function ajax_test_connection(): void {
        check_ajax_referer('pinetree_wc_test_connection', 'nonce');

        if (!current_user_can('manage_woocommerce')) {
            wp_send_json_error(['message' => __('You do not have permission to perform this action.', 'woocommerce-pinetree')]);
            return;
        }

        $api_key  = $this->get_option('api_key',  '');
        $base_url = $this->get_option('base_url', '');

        if (empty($api_key)) {
            wp_send_json_error(['message' => __('No API key configured. Enter your pt_live_* secret key and save settings before testing.', 'woocommerce-pinetree')]);
            return;
        }

        $api = new PineTree_API(
            $api_key,
            !empty($base_url) ? $base_url : 'https://app.pinetree-payments.com'
        );

        try {
            $api->list_checkout_sessions(1);
            wp_send_json_success(['message' => __('Connected. Your API key is valid and the PineTree API is reachable.', 'woocommerce-pinetree')]);
        } catch (RuntimeException $e) {
            // Strip any key-shaped strings from error messages before sending to browser.
            $safe_message = preg_replace('/pt_live_\S+/i', '[redacted]', $e->getMessage()) ?? $e->getMessage();
            wp_send_json_error(['message' => $safe_message]);
        }
    }

    // ------------------------------------------------------------------
    // Admin: enqueue settings-page script
    // ------------------------------------------------------------------

    public function enqueue_admin_scripts(string $hook): void {
        // phpcs:ignore WordPress.Security.NonceVerification.Recommended
        $is_settings_page = 'woocommerce_page_wc-settings' === $hook
            && sanitize_key($_GET['tab'] ?? '') === 'checkout'
            && sanitize_key($_GET['section'] ?? '') === 'pinetree';

        // phpcs:ignore WordPress.Security.NonceVerification.Recommended
        $is_order_page = ('post.php' === $hook && ($GLOBALS['post']->post_type ?? '') === 'shop_order')
            || ('woocommerce_page_wc-orders' === $hook && !empty($_GET['id']));

        if (!$is_settings_page && !$is_order_page) {
            return;
        }

        wp_enqueue_script(
            'pinetree-wc-admin',
            plugins_url('assets/js/admin.js', PINETREE_WC_PLUGIN_FILE),
            ['jquery'],
            PINETREE_WC_VERSION,
            true
        );

        // Only expose AJAX/nonce data on the settings page.
        $localize = ['copiedLabel' => __('Copied!', 'woocommerce-pinetree')];

        if ($is_settings_page) {
            $localize['ajaxUrl']      = admin_url('admin-ajax.php');
            $localize['nonce']        = wp_create_nonce('pinetree_wc_test_connection');
            $localize['testingLabel'] = __('Testing…', 'woocommerce-pinetree');
        }

        wp_localize_script('pinetree-wc-admin', 'pinetreeWC', $localize);
    }

    // ------------------------------------------------------------------
    // Checkout flow
    // ------------------------------------------------------------------

    /** {@inheritdoc} */
    public function process_payment($order_id): array {
        $order = wc_get_order((int) $order_id);
        if (!$order) {
            wc_add_notice(__('Order not found.', 'woocommerce-pinetree'), 'error');
            return ['result' => 'failure'];
        }

        $api_key  = $this->get_option('api_key',  '');
        $base_url = $this->get_option('base_url', '');

        if (empty($api_key)) {
            wc_add_notice(
                __('Payment cannot be initiated — PineTree is not configured. Please contact the site administrator.', 'woocommerce-pinetree'),
                'error'
            );
            return ['result' => 'failure'];
        }

        $api = new PineTree_API(
            $api_key,
            !empty($base_url) ? $base_url : 'https://app.pinetree-payments.com'
        );

        // WooCommerce totals are strings; convert to integer cents.
        $amount_cents = (int) round((float) $order->get_total() * 100);
        $currency     = strtoupper($order->get_currency());

        $params = [
            'amount'     => $amount_cents,
            'currency'   => $currency,
            'reference'  => (string) $order_id,
            'customer'   => ['email' => $order->get_billing_email()],
            'metadata'   => [
                'wc_order_id'    => (string) $order_id,
                'wc_order_key'   => $order->get_order_key(),
                'wc_site'        => get_bloginfo('url'),
                'plugin_version' => PINETREE_WC_VERSION,
            ],
            'successUrl' => $this->get_return_url($order),
            'cancelUrl'  => wc_get_checkout_url(),
        ];

        // Stable idempotency key: safe to retry on network failure.
        $idempotency_key = 'wc_' . $order_id . '_' . $order->get_order_key();

        try {
            $session = $api->create_checkout_session($params, $idempotency_key);
        } catch (RuntimeException $e) {
            wc_get_logger()->error(
                'PineTree create_checkout_session failed for order ' . $order_id . ': ' . $e->getMessage(),
                ['source' => 'woocommerce-pinetree']
            );
            wc_add_notice(
                __('Payment could not be initiated. Please try again or choose another payment method.', 'woocommerce-pinetree'),
                'error'
            );
            return ['result' => 'failure'];
        }

        if (empty($session['checkoutUrl'])) {
            wc_get_logger()->error(
                'PineTree API response missing checkoutUrl for order ' . $order_id,
                ['source' => 'woocommerce-pinetree']
            );
            wc_add_notice(
                __('Payment could not be initiated. Please try again.', 'woocommerce-pinetree'),
                'error'
            );
            return ['result' => 'failure'];
        }

        // Persist PineTree identifiers and checkout URL for admin support tooling.
        $order->update_meta_data('_pinetree_session_id',  sanitize_text_field($session['id'] ?? ''));
        $order->update_meta_data('_pinetree_checkout_url', esc_url_raw($session['checkoutUrl']));
        $order->add_order_note(__('PineTree checkout session created.', 'woocommerce-pinetree'));
        $order->update_status('pending', __('Awaiting PineTree payment.', 'woocommerce-pinetree'));
        $order->save();

        // Reduce stock now to prevent overselling during async confirmation.
        wc_reduce_stock_levels((int) $order_id);

        WC()->cart->empty_cart();

        return [
            'result'   => 'success',
            'redirect' => esc_url_raw($session['checkoutUrl']),
        ];
    }

    // ------------------------------------------------------------------
    // Webhook
    // ------------------------------------------------------------------

    /**
     * WC API callback: ?wc-api=pinetree_webhook
     */
    public function handle_webhook(): void {
        $webhook_secret = $this->get_option('webhook_secret', '');

        if (empty($webhook_secret)) {
            http_response_code(400);
            header('Content-Type: application/json');
            echo wp_json_encode(['message' => 'Webhook secret not configured.']);
            exit;
        }

        $handler = new PineTree_Webhook($webhook_secret);
        $handler->handle();
    }

    // ------------------------------------------------------------------
    // Availability check
    // ------------------------------------------------------------------

    /** {@inheritdoc} */
    public function is_available(): bool {
        if (!parent::is_available()) {
            return false;
        }
        return !empty($this->get_option('api_key', ''));
    }
}
