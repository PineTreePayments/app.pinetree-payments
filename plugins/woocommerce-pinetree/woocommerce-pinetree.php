<?php
/**
 * Plugin Name:       PineTree Payments for WooCommerce
 * Plugin URI:        https://github.com/pinetree-payments/pinetree-payments
 * Description:       Accept crypto payments via PineTree hosted checkout. Private beta — not for distribution.
 * Version:           0.1.0
 * Author:            PineTree Payments
 * Author URI:        https://app.pinetree-payments.com
 * Text Domain:       woocommerce-pinetree
 * Requires at least: 6.0
 * Requires PHP:      8.0
 * WC requires at least: 7.0
 * WC tested up to:   9.0
 * License:           MIT
 */

defined('ABSPATH') || exit;

define('PINETREE_WC_VERSION',     '0.1.0');
define('PINETREE_WC_PLUGIN_FILE', __FILE__);
define('PINETREE_WC_PLUGIN_DIR',  plugin_dir_path(__FILE__));

// Declare HPOS (High-Performance Order Storage) compatibility.
add_action('before_woocommerce_init', static function (): void {
    if (class_exists(\Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
            'custom_order_tables',
            __FILE__,
            true
        );
    }
});

function pinetree_wc_is_woocommerce_active(): bool {
    return class_exists('WooCommerce');
}

// Admin notices for missing WooCommerce or misconfigured gateway.
add_action('admin_notices', static function (): void {
    if (!pinetree_wc_is_woocommerce_active()) {
        printf(
            '<div class="notice notice-error"><p><strong>%s</strong> %s</p></div>',
            esc_html__('PineTree Payments:', 'woocommerce-pinetree'),
            esc_html__('WooCommerce must be installed and activated.', 'woocommerce-pinetree')
        );
        return;
    }

    $settings      = get_option('woocommerce_pinetree_settings', []);
    $enabled       = $settings['enabled']        ?? 'no';
    $api_key       = $settings['api_key']        ?? '';
    $webhook_secret = $settings['webhook_secret'] ?? '';

    if ($enabled !== 'yes') {
        return;
    }

    if (empty($api_key)) {
        printf(
            '<div class="notice notice-warning"><p><strong>%s</strong> %s</p></div>',
            esc_html__('PineTree Payments:', 'woocommerce-pinetree'),
            esc_html__('A PineTree secret key (pt_live_*) is required. Configure it in WooCommerce → Settings → Payments → PineTree Payments.', 'woocommerce-pinetree')
        );
    }

    if (empty($webhook_secret)) {
        printf(
            '<div class="notice notice-warning"><p><strong>%s</strong> %s</p></div>',
            esc_html__('PineTree Payments:', 'woocommerce-pinetree'),
            esc_html__('A webhook secret is required to verify incoming PineTree events. Add it in WooCommerce → Settings → Payments → PineTree Payments.', 'woocommerce-pinetree')
        );
    }
});

// Register gateway class with WooCommerce.
add_filter('woocommerce_payment_gateways', static function (array $gateways): array {
    if (pinetree_wc_is_woocommerce_active()) {
        $gateways[] = 'PineTree_WC_Gateway';
    }
    return $gateways;
});

// Load plugin classes once WooCommerce is ready.
add_action('plugins_loaded', static function (): void {
    if (!pinetree_wc_is_woocommerce_active()) {
        return;
    }

    require_once PINETREE_WC_PLUGIN_DIR . 'includes/class-pinetree-api.php';
    require_once PINETREE_WC_PLUGIN_DIR . 'includes/class-pinetree-webhook.php';
    require_once PINETREE_WC_PLUGIN_DIR . 'includes/class-pinetree-gateway.php';
    require_once PINETREE_WC_PLUGIN_DIR . 'includes/class-pinetree-admin.php';

    new PineTree_Admin();
});
