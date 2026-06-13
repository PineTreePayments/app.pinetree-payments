<?php
/**
 * PineTree admin UI.
 *
 * Provides:
 *  - Order meta box with session/payment data, copy buttons, and View Checkout link.
 *  - "Sync PineTree payment status" order action (manual recovery tool).
 *  - WooCommerce System Status section (config summary — no secrets).
 *
 * No API keys, webhook secrets, or raw provider payloads are rendered anywhere.
 */

defined('ABSPATH') || exit;

class PineTree_Admin {

    public function __construct() {
        add_action('add_meta_boxes',                      [$this, 'register_order_meta_box']);
        add_action('woocommerce_system_status_report',    [$this, 'render_system_status']);
        add_filter('woocommerce_order_actions',           [$this, 'add_order_actions']);
        add_action('woocommerce_order_action_pinetree_sync', [$this, 'handle_sync_action']);
        add_action('admin_notices',                       [$this, 'show_sync_notices']);
    }

    // ------------------------------------------------------------------
    // Order meta box
    // ------------------------------------------------------------------

    public function register_order_meta_box(): void {
        foreach (['shop_order', 'woocommerce_page_wc-orders'] as $screen) {
            add_meta_box(
                'pinetree-order-data',
                __('PineTree Payment', 'woocommerce-pinetree'),
                [$this, 'render_order_meta_box'],
                $screen,
                'side',
                'default'
            );
        }
    }

    /**
     * Render order meta box content.
     *
     * @param \WP_Post|\WC_Order $post_or_order
     */
    public function render_order_meta_box($post_or_order): void {
        if (is_a($post_or_order, 'WC_Order')) {
            $order = $post_or_order;
        } elseif (is_a($post_or_order, 'WP_Post')) {
            $order = wc_get_order($post_or_order->ID);
        } else {
            return;
        }

        if (!$order || $order->get_payment_method() !== 'pinetree') {
            return;
        }

        $session_id      = $order->get_meta('_pinetree_session_id');
        $payment_id      = $order->get_meta('_pinetree_payment_id');
        $checkout_url    = $order->get_meta('_pinetree_checkout_url');
        $checkout_status = $order->get_meta('_pinetree_checkout_status');
        $last_event      = $order->get_meta('_pinetree_last_webhook_event');
        $last_evt_id     = $order->get_meta('_pinetree_last_event_id');
        $last_at         = $order->get_meta('_pinetree_last_webhook_at');
        $last_sync_at    = $order->get_meta('_pinetree_last_sync_at');

        if (!$session_id && !$payment_id && !$last_event) {
            echo '<p style="color:#888;font-size:12px;">' . esc_html__('No PineTree payment data on this order.', 'woocommerce-pinetree') . '</p>';
            return;
        }

        echo '<table style="width:100%;font-size:12px;border-collapse:collapse;">';

        // Session ID + copy
        if ($session_id) {
            printf(
                '<tr><th style="text-align:left;padding:3px 0;color:#666;white-space:nowrap;">%s</th>'
                . '<td style="padding:3px 0;word-break:break-all;">'
                . '<code>%s</code>&nbsp;<button type="button" class="button-link" data-pinetree-copy="%s" style="font-size:11px;">%s</button>'
                . '</td></tr>',
                esc_html__('Session', 'woocommerce-pinetree'),
                esc_html($session_id),
                esc_attr($session_id),
                esc_html__('Copy', 'woocommerce-pinetree')
            );
        }

        // Checkout status badge
        if ($checkout_status) {
            $badge_color = match ($checkout_status) {
                'paid'       => '#46b450',
                'processing' => '#f0a500',
                'failed'     => '#dc3232',
                'expired', 'canceled' => '#999',
                default      => '#666',
            };
            printf(
                '<tr><th style="text-align:left;padding:3px 0;color:#666;">%s</th>'
                . '<td style="padding:3px 0;"><span style="color:%s;font-weight:600;">%s</span></td></tr>',
                esc_html__('Status', 'woocommerce-pinetree'),
                esc_attr($badge_color),
                esc_html($checkout_status)
            );
        }

        // Payment ID + copy
        if ($payment_id) {
            printf(
                '<tr><th style="text-align:left;padding:3px 0;color:#666;white-space:nowrap;">%s</th>'
                . '<td style="padding:3px 0;word-break:break-all;">'
                . '<code>%s</code>&nbsp;<button type="button" class="button-link" data-pinetree-copy="%s" style="font-size:11px;">%s</button>'
                . '</td></tr>',
                esc_html__('Payment', 'woocommerce-pinetree'),
                esc_html($payment_id),
                esc_attr($payment_id),
                esc_html__('Copy', 'woocommerce-pinetree')
            );
        }

        // View Checkout link (safe public URL)
        if ($checkout_url) {
            printf(
                '<tr><th style="text-align:left;padding:3px 0;color:#666;">%s</th>'
                . '<td style="padding:3px 0;"><a href="%s" target="_blank" rel="noopener noreferrer">%s</a></td></tr>',
                esc_html__('Checkout', 'woocommerce-pinetree'),
                esc_url($checkout_url),
                esc_html__('View ↗', 'woocommerce-pinetree')
            );
        }

        // Last webhook event
        if ($last_event) {
            printf(
                '<tr><th style="text-align:left;padding:3px 0;color:#666;">%s</th>'
                . '<td style="padding:3px 0;"><code>%s</code></td></tr>',
                esc_html__('Last event', 'woocommerce-pinetree'),
                esc_html($last_event)
            );
        }

        // Last event ID + copy
        if ($last_evt_id) {
            printf(
                '<tr><th style="text-align:left;padding:3px 0;color:#666;white-space:nowrap;">%s</th>'
                . '<td style="padding:3px 0;word-break:break-all;">'
                . '<code>%s</code>&nbsp;<button type="button" class="button-link" data-pinetree-copy="%s" style="font-size:11px;">%s</button>'
                . '</td></tr>',
                esc_html__('Event ID', 'woocommerce-pinetree'),
                esc_html($last_evt_id),
                esc_attr($last_evt_id),
                esc_html__('Copy', 'woocommerce-pinetree')
            );
        }

        // Last webhook timestamp
        if ($last_at) {
            printf(
                '<tr><th style="text-align:left;padding:3px 0;color:#666;">%s</th><td style="padding:3px 0;">%s</td></tr>',
                esc_html__('Webhook at', 'woocommerce-pinetree'),
                esc_html($this->format_timestamp($last_at))
            );
        }

        // Last manual sync timestamp
        if ($last_sync_at) {
            printf(
                '<tr><th style="text-align:left;padding:3px 0;color:#666;">%s</th><td style="padding:3px 0;">%s</td></tr>',
                esc_html__('Synced at', 'woocommerce-pinetree'),
                esc_html($this->format_timestamp($last_sync_at))
            );
        }

        echo '</table>';
    }

    private function format_timestamp(string $iso): string {
        $ts = strtotime($iso);
        if ($ts === false) {
            return $iso;
        }
        return function_exists('wp_date')
            ? (string) wp_date('Y-m-d H:i:s', $ts)
            : gmdate('Y-m-d H:i:s', $ts) . ' UTC';
    }

    // ------------------------------------------------------------------
    // Manual sync order action
    // ------------------------------------------------------------------

    /**
     * Add "Sync PineTree payment status" to the order actions dropdown.
     * Only shown when the order uses the PineTree gateway.
     */
    public function add_order_actions(array $actions): array {
        global $theorder;
        if ($theorder && is_a($theorder, 'WC_Order') && $theorder->get_payment_method() !== 'pinetree') {
            return $actions;
        }
        $actions['pinetree_sync'] = __('Sync PineTree payment status', 'woocommerce-pinetree');
        return $actions;
    }

    /**
     * Execute the manual sync. Fetches current session state from PineTree API
     * and applies status + metadata to the WooCommerce order.
     *
     * This is the safe alternative to webhook replay:
     *  - Calls GET /api/v1/checkout/sessions/{id} for fresh state.
     *  - Does not store or re-process raw event payloads.
     *  - Applies the same status mapping as the webhook handler.
     */
    public function handle_sync_action(WC_Order $order): void {
        $session_id = $order->get_meta('_pinetree_session_id');

        if (empty($session_id)) {
            $this->set_sync_notice(__('PineTree: no session ID on this order — cannot sync payment status.', 'woocommerce-pinetree'));
            return;
        }

        $settings = get_option('woocommerce_pinetree_settings', []);
        $api_key  = $settings['api_key']  ?? '';
        $base_url = $settings['base_url'] ?? '';

        if (empty($api_key)) {
            $this->set_sync_notice(__('PineTree: API key not configured — cannot sync.', 'woocommerce-pinetree'));
            return;
        }

        $api = $this->create_api(
            $api_key,
            !empty($base_url) ? $base_url : 'https://app.pinetree-payments.com'
        );

        try {
            $session = $api->get_checkout_session($session_id);
        } catch (RuntimeException $e) {
            $order->add_order_note(__('PineTree: manual sync failed — could not reach the API.', 'woocommerce-pinetree'));
            $order->save();
            return;
        }

        $status = $session['status'] ?? '';

        // Update safe metadata (no secrets, no raw payloads).
        if ($status !== '') {
            $order->update_meta_data('_pinetree_checkout_status', sanitize_text_field($status));
        }
        if (!empty($session['paymentId'])) {
            $order->update_meta_data('_pinetree_payment_id', sanitize_text_field($session['paymentId']));
        }
        if (!empty($session['checkoutUrl'])) {
            $order->update_meta_data('_pinetree_checkout_url', esc_url_raw($session['checkoutUrl']));
        }
        $order->update_meta_data('_pinetree_last_sync_at', gmdate('c'));

        $terminal   = ['completed', 'processing', 'cancelled', 'failed', 'refunded'];
        $is_terminal = in_array($order->get_status(), $terminal, true);

        switch ($status) {
            case 'paid':
                if ($is_terminal) {
                    $order->add_order_note(__('PineTree: manual sync — session paid (order already in terminal state).', 'woocommerce-pinetree'));
                } else {
                    $txn = sanitize_text_field($session['paymentId'] ?? ($session['id'] ?? ''));
                    $order->payment_complete($txn);
                    $order->add_order_note(__('PineTree: manual sync — payment confirmed.', 'woocommerce-pinetree'));
                }
                break;

            case 'processing':
                if ($is_terminal) {
                    $order->add_order_note(__('PineTree: manual sync — payment on-chain (order already in terminal state).', 'woocommerce-pinetree'));
                } else {
                    $order->update_status('on-hold', __('PineTree: manual sync — payment on-chain, awaiting confirmation.', 'woocommerce-pinetree'));
                }
                break;

            case 'failed':
                if ($is_terminal) {
                    $order->add_order_note(__('PineTree: manual sync — payment failed (order already in terminal state).', 'woocommerce-pinetree'));
                } else {
                    $order->update_status('failed', __('PineTree: manual sync — payment failed.', 'woocommerce-pinetree'));
                }
                break;

            case 'expired':
                if ($is_terminal) {
                    $order->add_order_note(__('PineTree: manual sync — session expired (order already in terminal state).', 'woocommerce-pinetree'));
                } else {
                    $order->update_status('cancelled', __('PineTree: manual sync — session expired.', 'woocommerce-pinetree'));
                }
                break;

            case 'canceled':
                if ($is_terminal) {
                    $order->add_order_note(__('PineTree: manual sync — session cancelled (order already in terminal state).', 'woocommerce-pinetree'));
                } else {
                    $order->update_status('cancelled', __('PineTree: manual sync — session cancelled.', 'woocommerce-pinetree'));
                }
                break;

            case 'open':
                $order->add_order_note(__('PineTree: manual sync — session open, no payment received yet.', 'woocommerce-pinetree'));
                break;

            default:
                $order->add_order_note(sprintf(
                    /* translators: %s = raw session status */
                    __('PineTree: manual sync completed — session status: %s.', 'woocommerce-pinetree'),
                    esc_html($status)
                ));
                break;
        }

        // Record last sync time site-wide for the Status page.
        update_option('pinetree_wc_last_sync_at', gmdate('c'), false);

        $order->save();
    }

    protected function create_api(string $api_key, string $base_url): PineTree_API {
        return new PineTree_API($api_key, $base_url);
    }

    private function set_sync_notice(string $message): void {
        if (function_exists('set_transient') && function_exists('get_current_user_id')) {
            set_transient('pinetree_sync_error_' . get_current_user_id(), $message, 45);
        }
    }

    public function show_sync_notices(): void {
        if (!function_exists('get_current_user_id') || !function_exists('get_transient')) {
            return;
        }
        $key     = 'pinetree_sync_error_' . get_current_user_id();
        $message = get_transient($key);
        if ($message) {
            delete_transient($key);
            printf(
                '<div class="notice notice-error is-dismissible"><p><strong>%s</strong> %s</p></div>',
                esc_html__('PineTree Payments:', 'woocommerce-pinetree'),
                esc_html($message)
            );
        }
    }

    // ------------------------------------------------------------------
    // WooCommerce → System Status section
    // ------------------------------------------------------------------

    public function render_system_status(): void {
        $settings  = get_option('woocommerce_pinetree_settings', []);
        $enabled   = ($settings['enabled']        ?? 'no') === 'yes';
        $api_key   = $settings['api_key']         ?? '';
        $pub_key   = $settings['public_key']      ?? '';
        $wh_secret = $settings['webhook_secret']  ?? '';
        $base_url  = $settings['base_url']        ?? '';
        $wh_url    = add_query_arg('wc-api', 'pinetree_webhook', get_home_url());

        $last_wh   = get_option('pinetree_wc_last_webhook_summary', []);
        $last_sync = get_option('pinetree_wc_last_sync_at', '');

        $yes   = '<mark class="yes">&#10004; ' . esc_html__('Yes', 'woocommerce-pinetree') . '</mark>';
        $no    = '<mark class="no">&ndash; '   . esc_html__('No', 'woocommerce-pinetree')  . '</mark>';
        $set   = '<mark class="yes">&#10004; ' . esc_html__('Configured', 'woocommerce-pinetree') . '</mark>';
        $unset = '<mark class="no">&ndash; '   . esc_html__('Not set', 'woocommerce-pinetree') . '</mark>';
        $never = '<em style="color:#999;">'    . esc_html__('Never', 'woocommerce-pinetree') . '</em>';

        ?>
        <table class="wc_status_table widefat" cellspacing="0">
            <thead>
                <tr>
                    <th colspan="3" data-export-label="PineTree Payments">
                        <h2><?php esc_html_e('PineTree Payments', 'woocommerce-pinetree'); ?></h2>
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td data-export-label="Plugin Version"><?php esc_html_e('Plugin version', 'woocommerce-pinetree'); ?></td>
                    <td class="help">&ndash;</td>
                    <td><?php echo esc_html(PINETREE_WC_VERSION); ?></td>
                </tr>
                <tr>
                    <td data-export-label="Gateway Enabled"><?php esc_html_e('Gateway enabled', 'woocommerce-pinetree'); ?></td>
                    <td class="help">&ndash;</td>
                    <td><?php echo $enabled ? $yes : $no; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></td>
                </tr>
                <tr>
                    <td data-export-label="Secret Key"><?php esc_html_e('Secret key (pt_live_*)', 'woocommerce-pinetree'); ?></td>
                    <td class="help">&ndash;</td>
                    <td><?php echo !empty($api_key) ? $set : $unset; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></td>
                </tr>
                <tr>
                    <td data-export-label="Public Key"><?php esc_html_e('Public key (pk_live_*)', 'woocommerce-pinetree'); ?></td>
                    <td class="help">&ndash;</td>
                    <td><?php echo !empty($pub_key) ? $set : $unset; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></td>
                </tr>
                <tr>
                    <td data-export-label="Webhook Secret"><?php esc_html_e('Webhook secret', 'woocommerce-pinetree'); ?></td>
                    <td class="help">&ndash;</td>
                    <td><?php echo !empty($wh_secret) ? $set : $unset; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?></td>
                </tr>
                <tr>
                    <td data-export-label="API Base URL"><?php esc_html_e('API base URL', 'woocommerce-pinetree'); ?></td>
                    <td class="help">&ndash;</td>
                    <td><code><?php echo esc_html(!empty($base_url) ? $base_url : 'https://app.pinetree-payments.com (default)'); ?></code></td>
                </tr>
                <tr>
                    <td data-export-label="Webhook URL"><?php esc_html_e('Webhook URL', 'woocommerce-pinetree'); ?></td>
                    <td class="help">&ndash;</td>
                    <td><code><?php echo esc_html($wh_url); ?></code></td>
                </tr>
                <tr>
                    <td data-export-label="Last Webhook Event"><?php esc_html_e('Last webhook event', 'woocommerce-pinetree'); ?></td>
                    <td class="help">&ndash;</td>
                    <td>
                        <?php if (!empty($last_wh['event'])): ?>
                            <code><?php echo esc_html($last_wh['event']); ?></code>
                            <?php if (!empty($last_wh['at'])): ?>
                                <span style="color:#888;font-size:11px;">
                                    &mdash; <?php echo esc_html($this->format_timestamp($last_wh['at'])); ?>
                                </span>
                            <?php endif; ?>
                        <?php else: ?>
                            <?php echo $never; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
                        <?php endif; ?>
                    </td>
                </tr>
                <tr>
                    <td data-export-label="Last Manual Sync"><?php esc_html_e('Last manual sync', 'woocommerce-pinetree'); ?></td>
                    <td class="help">&ndash;</td>
                    <td>
                        <?php if (!empty($last_sync)): ?>
                            <?php echo esc_html($this->format_timestamp($last_sync)); ?>
                        <?php else: ?>
                            <?php echo $never; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>
                        <?php endif; ?>
                    </td>
                </tr>
            </tbody>
        </table>
        <?php
    }
}
