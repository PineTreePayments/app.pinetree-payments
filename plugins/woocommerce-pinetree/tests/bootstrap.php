<?php
/**
 * Test bootstrap — stubs the WordPress and WooCommerce globals that the
 * plugin classes depend on, so the core logic can be exercised with plain PHP
 * (no WP install, no PHPUnit required).
 *
 * Load via: require_once __DIR__ . '/bootstrap.php';
 */

// Plugin guard constant.
if (!defined('ABSPATH')) {
    define('ABSPATH', '/test/');
}
if (!defined('PINETREE_WC_VERSION')) {
    define('PINETREE_WC_VERSION', '0.1.0');
}

// ---------------------------------------------------------------------------
// WordPress function stubs
// ---------------------------------------------------------------------------

if (!function_exists('wp_json_encode')) {
    function wp_json_encode($data): string|false {
        return json_encode($data);
    }
}

if (!function_exists('is_wp_error')) {
    function is_wp_error($thing): bool {
        return $thing instanceof WP_Error;
    }
}

if (!function_exists('wp_remote_post')) {
    function wp_remote_post(string $url, array $args = []): array {
        return ['response' => ['code' => 200], 'body' => '{}'];
    }
}

if (!function_exists('wp_remote_get')) {
    function wp_remote_get(string $url, array $args = []): array {
        return ['response' => ['code' => 200], 'body' => '{"data":[]}'];
    }
}

if (!function_exists('add_query_arg')) {
    function add_query_arg(array $args, string $url): string {
        $query = http_build_query($args);
        return $query !== '' ? $url . '?' . $query : $url;
    }
}

if (!function_exists('wp_remote_retrieve_response_code')) {
    function wp_remote_retrieve_response_code(array $response): int {
        return (int) ($response['response']['code'] ?? 200);
    }
}

if (!function_exists('wp_remote_retrieve_body')) {
    function wp_remote_retrieve_body(array $response): string {
        return (string) ($response['body'] ?? '');
    }
}

if (!function_exists('sanitize_text_field')) {
    function sanitize_text_field(string $str): string {
        return trim($str);
    }
}

if (!function_exists('esc_url_raw')) {
    function esc_url_raw(string $url): string {
        return $url;
    }
}

if (!function_exists('__')) {
    function __(string $text, string $domain = ''): string {
        return $text;
    }
}

foreach (['add_action', 'add_filter'] as $hook_function) {
    if (!function_exists($hook_function)) {
        eval("function {$hook_function}(...\$args): void {}");
    }
}

if (!function_exists('wp_kses_post')) {
    function wp_kses_post(string $value): string { return $value; }
}
if (!function_exists('esc_html')) {
    function esc_html(string $value): string { return htmlspecialchars($value, ENT_QUOTES); }
}
if (!function_exists('esc_attr')) {
    function esc_attr(string $value): string { return htmlspecialchars($value, ENT_QUOTES); }
}
if (!function_exists('esc_url')) {
    function esc_url(string $value): string { return $value; }
}
if (!function_exists('get_bloginfo')) {
    function get_bloginfo(string $show = ''): string { return 'https://shop.test'; }
}
if (!function_exists('wc_get_checkout_url')) {
    function wc_get_checkout_url(): string { return 'https://shop.test/checkout'; }
}
if (!function_exists('wc_reduce_stock_levels')) {
    function wc_reduce_stock_levels(int $order_id): void { $GLOBALS['_test_stock_reduced'][] = $order_id; }
}

if (!class_exists('WC_Order')) {
    class WC_Order {}
}

if (!class_exists('WC_Payment_Gateway')) {
    class WC_Payment_Gateway {
        protected array $settings = [];
        public function get_option(string $key, $default = '') {
            return $this->settings[$key] ?? $default;
        }
        public function get_return_url($order = null): string {
            return 'https://shop.test/order-received';
        }
    }
}

if (!function_exists('WC')) {
    function WC(): object {
        return new class {
            public object $cart;
            public function __construct() {
                $this->cart = new class {
                    public bool $emptied = false;
                    public function empty_cart(): void { $this->emptied = true; }
                };
            }
        };
    }
}

if (!function_exists('http_response_code')) {
    function http_response_code(int $code): void {
        // no-op in test context
    }
}

// ---------------------------------------------------------------------------
// WooCommerce function stubs
// ---------------------------------------------------------------------------

if (!function_exists('wc_get_order')) {
    function wc_get_order(int $id): ?object {
        return $GLOBALS['_test_order'] ?? null;
    }
}

if (!function_exists('wc_get_logger')) {
    function wc_get_logger(): object {
        return new class {
            public array $warnings = [];
            public array $errors   = [];
            public array $infos    = [];
            public function warning(string $msg, array $ctx = []): void { $this->warnings[] = $msg; }
            public function error(string $msg,   array $ctx = []): void { $this->errors[]   = $msg; }
            public function info(string $msg,    array $ctx = []): void { $this->infos[]    = $msg; }
        };
    }
}

if (!function_exists('wc_add_notice')) {
    function wc_add_notice(string $message, string $type = 'success'): void {
        // no-op in test context
    }
}

if (!function_exists('header')) {
    function header(string $header, bool $replace = true, int $response_code = 0): void {
        // no-op in test context
    }
}

// ---------------------------------------------------------------------------
// WP_Error stub
// ---------------------------------------------------------------------------

if (!class_exists('WP_Error')) {
    class WP_Error {
        private string $message;
        public function __construct(string $code = '', string $message = '', $data = '') {
            $this->message = $message;
        }
        public function get_error_message(string $code = ''): string {
            return $this->message;
        }
    }
}

// ---------------------------------------------------------------------------
// Mock WooCommerce order
// ---------------------------------------------------------------------------

if (!function_exists('update_option')) {
    function update_option(string $option, $value, $autoload = null): bool {
        $GLOBALS['_test_options'][$option] = $value;
        return true;
    }
}

if (!function_exists('get_option')) {
    function get_option(string $option, $default = false) {
        return $GLOBALS['_test_options'][$option] ?? $default;
    }
}

if (!function_exists('delete_transient')) {
    function delete_transient(string $transient): bool {
        unset($GLOBALS['_test_options']['_transient_' . $transient]);
        return true;
    }
}

if (!function_exists('set_transient')) {
    function set_transient(string $transient, $value, int $expiration = 0): bool {
        $GLOBALS['_test_options']['_transient_' . $transient] = $value;
        return true;
    }
}

if (!function_exists('get_transient')) {
    function get_transient(string $transient) {
        return $GLOBALS['_test_options']['_transient_' . $transient] ?? false;
    }
}

if (!class_exists('MockWCOrder')) {
    class MockWCOrder extends WC_Order {
        private string $status         = 'pending';
        private array  $meta           = [];
        private array  $notes          = [];
        private bool   $payment_called = false;
        private string $payment_txn_id = '';
        private string $total          = '49.99';
        private string $currency       = 'USD';
        private string $billing_email  = 'buyer@example.com';
        private string $order_key      = 'order_key_42';
        private string $payment_method = 'pinetree';

        public function get_status(): string { return $this->status; }

        public function update_status(string $status, string $note = ''): void {
            $this->status  = $status;
            $this->notes[] = $note;
        }

        public function payment_complete(string $txn_id = ''): void {
            $this->payment_called = true;
            $this->payment_txn_id = $txn_id;
            $this->status         = 'processing';
        }

        public function add_order_note(string $note): void {
            $this->notes[] = $note;
        }

        public function update_meta_data(string $key, $value): void {
            $this->meta[$key] = $value;
        }

        public function get_meta(string $key): mixed {
            return $this->meta[$key] ?? null;
        }

        public function save(): void {}

        public function was_payment_complete_called(): bool { return $this->payment_called; }
        public function get_payment_txn_id(): string        { return $this->payment_txn_id; }
        public function get_notes(): array                  { return $this->notes; }
        public function get_total(): string                 { return $this->total; }
        public function get_currency(): string              { return $this->currency; }
        public function get_billing_email(): string         { return $this->billing_email; }
        public function get_order_key(): string             { return $this->order_key; }
        public function get_payment_method(): string        { return $this->payment_method; }
    }
}
