<?php
/**
 * Tests for PineTree_API.
 *
 * Exercises: request construction, successful response parsing, idempotency
 * key forwarding, API error propagation, and network error propagation.
 *
 * Run via: php tests/run.php
 */

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/../includes/class-pinetree-api.php';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a fake wp_remote_post response.
 */
function fake_response(int $status_code, array $body): array {
    return [
        'response' => ['code' => $status_code],
        'body'     => json_encode($body),
    ];
}

/**
 * Build an API instance whose HTTP calls are intercepted by $handler.
 *
 * @param callable $handler fn(string $url, array $args): array
 */
function make_api(string $api_key, callable $handler, string $base_url = 'https://api.test'): PineTree_API {
    return new PineTree_API($api_key, $base_url, $handler);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function test_create_session_sends_correct_url_and_auth(): void {
    $captured_url  = null;
    $captured_args = null;

    $api = make_api('pt_live_testkey', function ($url, $args) use (&$captured_url, &$captured_args) {
        $captured_url  = $url;
        $captured_args = $args;
        return fake_response(201, [
            'id'          => 'cs_abc',
            'checkoutUrl' => 'https://checkout.test/abc',
            'status'      => 'open',
        ]);
    });

    $api->create_checkout_session(['amount' => 2500, 'currency' => 'USD']);

    assert_equals('https://api.test/api/v1/checkout/sessions', $captured_url, 'POST URL');
    assert_equals('Bearer pt_live_testkey', $captured_args['headers']['Authorization'] ?? null, 'Authorization header');
    assert_equals('application/json', $captured_args['headers']['Content-Type'] ?? null, 'Content-Type header');

    $body = json_decode($captured_args['body'], true);
    assert_equals(2500, $body['amount'] ?? null, 'amount in body');
    assert_equals('USD', $body['currency'] ?? null, 'currency in body');
}

function test_create_session_returns_parsed_session(): void {
    $session_fixture = [
        'id'          => 'cs_xyz',
        'object'      => 'checkout.session',
        'status'      => 'open',
        'amount'      => 1000,
        'currency'    => 'USD',
        'checkoutUrl' => 'https://checkout.test/xyz',
    ];

    $api = make_api('pt_live_k', function () use ($session_fixture) {
        return fake_response(201, $session_fixture);
    });

    $result = $api->create_checkout_session(['amount' => 1000]);

    assert_equals('cs_xyz', $result['id'] ?? null, 'session id');
    assert_equals('https://checkout.test/xyz', $result['checkoutUrl'] ?? null, 'checkoutUrl');
    assert_equals('open', $result['status'] ?? null, 'status');
}

function test_create_session_forwards_idempotency_key(): void {
    $captured_headers = null;

    $api = make_api('pt_live_k', function ($url, $args) use (&$captured_headers) {
        $captured_headers = $args['headers'];
        return fake_response(201, ['id' => 'cs_1', 'checkoutUrl' => 'https://x.test/1', 'status' => 'open']);
    });

    $api->create_checkout_session(['amount' => 500], 'order_42_attempt_1');

    assert_equals('order_42_attempt_1', $captured_headers['Idempotency-Key'] ?? null, 'Idempotency-Key header');
}

function test_create_session_omits_idempotency_key_when_null(): void {
    $captured_headers = null;

    $api = make_api('pt_live_k', function ($url, $args) use (&$captured_headers) {
        $captured_headers = $args['headers'];
        return fake_response(201, ['id' => 'cs_1', 'checkoutUrl' => 'https://x.test/1', 'status' => 'open']);
    });

    $api->create_checkout_session(['amount' => 500]);

    assert_true(!isset($captured_headers['Idempotency-Key']), 'No Idempotency-Key header when null');
}

function test_create_session_throws_on_api_error(): void {
    $api = make_api('pt_live_k', function () {
        return fake_response(400, [
            'error' => ['code' => 'invalid_amount', 'message' => 'Amount must be greater than zero.'],
        ]);
    });

    $threw = false;
    $message = '';
    try {
        $api->create_checkout_session(['amount' => 0]);
    } catch (RuntimeException $e) {
        $threw   = true;
        $message = $e->getMessage();
    }

    assert_true($threw, 'RuntimeException thrown on 400');
    assert_true(str_contains($message, 'invalid_amount'), 'Error code in message');
    assert_true(str_contains($message, 'Amount must be greater than zero'), 'Error message propagated');
}

function test_create_session_throws_on_auth_error(): void {
    $api = make_api('pt_live_bad', function () {
        return fake_response(401, [
            'error' => ['code' => 'authentication_error', 'message' => 'Invalid API key.'],
        ]);
    });

    $threw = false;
    try {
        $api->create_checkout_session(['amount' => 100]);
    } catch (RuntimeException $e) {
        $threw = true;
    }

    assert_true($threw, 'RuntimeException thrown on 401');
}

function test_create_session_throws_on_network_error(): void {
    $api = make_api('pt_live_k', function () {
        return new WP_Error('http_request_failed', 'cURL error 7: Connection refused');
    });

    $threw = false;
    $message = '';
    try {
        $api->create_checkout_session(['amount' => 100]);
    } catch (RuntimeException $e) {
        $threw   = true;
        $message = $e->getMessage();
    }

    assert_true($threw, 'RuntimeException thrown on WP_Error');
    assert_true(str_contains($message, 'connection error'), 'Connection error in message');
}

// ---------------------------------------------------------------------------
// sslverify and GET transport tests
// ---------------------------------------------------------------------------

/**
 * Build an API instance with an injectable GET transport.
 */
function make_get_api(string $api_key, callable $get_handler, string $base_url = 'https://api.test'): PineTree_API {
    // POST handler returns a dummy 201 so any create_session call won't throw.
    $post_handler = fn($url, $args) => fake_response(201, ['id' => 'cs_x', 'checkoutUrl' => 'https://x.test', 'status' => 'open']);
    return new PineTree_API($api_key, $base_url, $post_handler, $get_handler);
}

function test_create_session_uses_sslverify_true(): void {
    $captured_args = null;

    $api = make_api('pt_live_k', function ($url, $args) use (&$captured_args) {
        $captured_args = $args;
        return fake_response(201, ['id' => 'cs_ssl', 'checkoutUrl' => 'https://x.test', 'status' => 'open']);
    });

    $api->create_checkout_session(['amount' => 100]);

    assert_true(($captured_args['sslverify'] ?? false) === true, 'create_checkout_session uses sslverify => true');
}

function test_list_checkout_sessions_uses_sslverify_true(): void {
    $captured_args = null;

    $api = make_get_api('pt_live_k', function ($url, $args) use (&$captured_args) {
        $captured_args = $args;
        return fake_response(200, ['data' => []]);
    });

    $api->list_checkout_sessions(1);

    assert_true(($captured_args['sslverify'] ?? false) === true, 'list_checkout_sessions uses sslverify => true');
}

function test_get_checkout_session_constructs_correct_url(): void {
    $captured_url = null;

    $api = make_get_api('pt_live_k', function ($url, $args) use (&$captured_url) {
        $captured_url = $url;
        return fake_response(200, ['id' => 'cs_abc', 'status' => 'paid']);
    }, 'https://api.test');

    $api->get_checkout_session('cs_abc');

    assert_equals('https://api.test/api/v1/checkout/sessions/cs_abc', $captured_url, 'GET URL includes session ID');
}

function test_get_checkout_session_url_encodes_session_id(): void {
    $captured_url = null;

    $api = make_get_api('pt_live_k', function ($url, $args) use (&$captured_url) {
        $captured_url = $url;
        return fake_response(200, ['id' => 'cs_test/special', 'status' => 'open']);
    }, 'https://api.test');

    $api->get_checkout_session('cs_test/special');

    assert_equals('https://api.test/api/v1/checkout/sessions/cs_test%2Fspecial', $captured_url, 'Session ID is URL-encoded');
}

function test_get_checkout_session_uses_sslverify_true(): void {
    $captured_args = null;

    $api = make_get_api('pt_live_k', function ($url, $args) use (&$captured_args) {
        $captured_args = $args;
        return fake_response(200, ['id' => 'cs_ssl2', 'status' => 'open']);
    });

    $api->get_checkout_session('cs_ssl2');

    assert_true(($captured_args['sslverify'] ?? false) === true, 'get_checkout_session uses sslverify => true');
}

function test_get_checkout_session_returns_parsed_session(): void {
    $fixture = ['id' => 'cs_get', 'status' => 'paid', 'paymentId' => 'pay_g'];

    $api = make_get_api('pt_live_k', function () use ($fixture) {
        return fake_response(200, $fixture);
    });

    $result = $api->get_checkout_session('cs_get');

    assert_equals('cs_get',   $result['id']        ?? null, 'id returned');
    assert_equals('paid',     $result['status']    ?? null, 'status returned');
    assert_equals('pay_g',    $result['paymentId'] ?? null, 'paymentId returned');
}

function test_get_checkout_session_throws_on_not_found(): void {
    $api = make_get_api('pt_live_k', function () {
        return fake_response(404, [
            'error' => ['code' => 'not_found', 'message' => 'Session not found.'],
        ]);
    });

    $threw = false;
    $message = '';
    try {
        $api->get_checkout_session('cs_missing');
    } catch (RuntimeException $e) {
        $threw   = true;
        $message = $e->getMessage();
    }

    assert_true($threw, 'RuntimeException thrown on 404');
    assert_true(str_contains($message, 'not_found'), 'Error code in message');
}
