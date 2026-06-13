<?php
/**
 * Simulated end-to-end wiring checks for checkout and manual reconciliation.
 */

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/../includes/class-pinetree-api.php';
require_once __DIR__ . '/../includes/class-pinetree-gateway.php';
require_once __DIR__ . '/../includes/class-pinetree-admin.php';

class FakePineTreeApi extends PineTree_API {
    public array $created_params = [];
    public ?string $idempotency_key = null;
    public array $session;

    public function __construct(array $session) {
        $this->session = $session;
    }

    public function create_checkout_session(array $params, ?string $idempotency_key = null): array {
        $this->created_params = $params;
        $this->idempotency_key = $idempotency_key;
        return $this->session;
    }

    public function get_checkout_session(string $session_id): array {
        return $this->session;
    }
}

class SmokeGateway extends PineTree_WC_Gateway {
    public FakePineTreeApi $fake_api;
    public function __construct(FakePineTreeApi $api) {
        $this->fake_api = $api;
        $this->settings = ['api_key' => 'pt_live_fake_test_key'];
    }
    protected function create_api(string $api_key, string $base_url): PineTree_API {
        return $this->fake_api;
    }
}

class SmokeAdmin extends PineTree_Admin {
    public FakePineTreeApi $fake_api;
    public function __construct(FakePineTreeApi $api) {
        $this->fake_api = $api;
    }
    protected function create_api(string $api_key, string $base_url): PineTree_API {
        return $this->fake_api;
    }
}

function test_gateway_creates_session_and_returns_checkout_redirect(): void {
    $order = new MockWCOrder();
    $GLOBALS['_test_order'] = $order;
    $api = new FakePineTreeApi([
        'id' => 'cs_wc_42',
        'status' => 'open',
        'checkoutUrl' => 'https://app.test/checkout/wc-42',
    ]);
    $gateway = new SmokeGateway($api);

    $result = $gateway->process_payment(42);

    assert_equals('success', $result['result'] ?? null, 'Gateway checkout succeeds');
    assert_equals('https://app.test/checkout/wc-42', $result['redirect'] ?? null, 'Redirect contains PineTree checkoutUrl');
    assert_equals(4999, $api->created_params['amount'] ?? null, 'Fake WooCommerce total maps to cents');
    assert_equals('42', $api->created_params['metadata']['wc_order_id'] ?? null, 'WooCommerce order ID is sent in metadata');
    assert_equals('cs_wc_42', $order->get_meta('_pinetree_session_id'), 'Session ID stored on order');
}

function test_manual_sync_updates_order_from_mocked_session(): void {
    $order = new MockWCOrder();
    $order->update_meta_data('_pinetree_session_id', 'cs_wc_sync');
    $GLOBALS['_test_options']['woocommerce_pinetree_settings'] = [
        'api_key' => 'pt_live_fake_test_key',
    ];
    $api = new FakePineTreeApi([
        'id' => 'cs_wc_sync',
        'status' => 'paid',
        'paymentId' => 'pay_wc_sync',
        'checkoutUrl' => 'https://app.test/checkout/wc-sync',
    ]);

    (new SmokeAdmin($api))->handle_sync_action($order);

    assert_true($order->was_payment_complete_called(), 'Manual sync marks mocked paid session complete');
    assert_equals('paid', $order->get_meta('_pinetree_checkout_status'), 'Manual sync stores checkout status');
    assert_equals('pay_wc_sync', $order->get_meta('_pinetree_payment_id'), 'Manual sync stores payment ID');
}
