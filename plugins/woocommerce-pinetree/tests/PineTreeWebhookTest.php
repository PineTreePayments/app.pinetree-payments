<?php
/**
 * Tests for PineTree_Webhook.
 *
 * Covers: signature verification, timestamp tolerance, prefix stripping,
 * malformed payload rejection, and event → order status dispatch.
 *
 * Run via: php tests/run.php
 */

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/../includes/class-pinetree-webhook.php';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a valid signed event fixture. */
function make_signed_event(string $secret, array $event_override = []): array {
    $session = [
        'id'        => 'cs_test_abc123',
        'object'    => 'checkout.session',
        'status'    => 'paid',
        'amount'    => 2500,
        'currency'  => 'USD',
        'reference' => '42',
        'metadata'  => ['wc_order_id' => '42'],
        'paymentId' => 'pay_test_xyz',
    ];

    $event = array_merge([
        'eventId'   => 'evt_test_001',
        'type'      => 'checkout.session.paid',
        'createdAt' => date('c'),
        'data'      => ['object' => $session],
    ], $event_override);

    $raw_body  = json_encode($event);
    $signature = hash_hmac('sha256', $raw_body, $secret, false);
    $timestamp = date('c');

    return ['raw_body' => $raw_body, 'signature' => $signature, 'timestamp' => $timestamp, 'event' => $event];
}

/** Build a PineTree_Webhook with an injected order resolver. */
function make_webhook(string $secret, ?MockWCOrder $order = null, ?string $order_id_for_resolver = null): PineTree_Webhook {
    $resolver = null;
    if ($order !== null) {
        $resolver = function (int $id) use ($order, $order_id_for_resolver): ?MockWCOrder {
            return ($order_id_for_resolver === null || $id === (int) $order_id_for_resolver)
                ? $order
                : null;
        };
    }
    return new PineTree_Webhook($secret, $resolver);
}

// ---------------------------------------------------------------------------
// Signature verification tests
// ---------------------------------------------------------------------------

function test_valid_signature_passes(): void {
    $secret = 'whsec_test_secret_abcdef1234';
    $f      = make_signed_event($secret);
    $wh     = make_webhook($secret);

    $event = $wh->verify_and_parse($f['raw_body'], $f['signature'], $f['timestamp']);

    assert_equals('evt_test_001', $event['eventId'] ?? null, 'eventId parsed');
    assert_equals('checkout.session.paid', $event['type'] ?? null, 'type parsed');
}

function test_sha256_prefix_in_signature_is_stripped(): void {
    $secret = 'whsec_prefix_test';
    $f      = make_signed_event($secret);
    $wh     = make_webhook($secret);

    $prefixed = 'sha256=' . $f['signature'];
    $event    = $wh->verify_and_parse($f['raw_body'], $prefixed, $f['timestamp']);

    assert_equals('evt_test_001', $event['eventId'] ?? null, 'Prefixed signature accepted');
}

function test_sha256_prefix_case_insensitive(): void {
    $secret = 'whsec_case_test';
    $f      = make_signed_event($secret);
    $wh     = make_webhook($secret);

    $prefixed = 'SHA256=' . $f['signature'];
    $event    = $wh->verify_and_parse($f['raw_body'], $prefixed, $f['timestamp']);

    assert_equals('evt_test_001', $event['eventId'] ?? null, 'Uppercase SHA256= prefix accepted');
}

function test_wrong_secret_fails(): void {
    $f  = make_signed_event('whsec_real');
    $wh = make_webhook('whsec_wrong');

    $threw = false;
    try {
        $wh->verify_and_parse($f['raw_body'], $f['signature'], $f['timestamp']);
    } catch (RuntimeException $e) {
        $threw = true;
        assert_true(str_contains($e->getMessage(), 'signature verification failed'), 'Correct exception message');
    }
    assert_true($threw, 'RuntimeException on wrong secret');
}

function test_tampered_body_fails(): void {
    $secret = 'whsec_tamper';
    $f      = make_signed_event($secret);
    $wh     = make_webhook($secret);

    $tampered = str_replace('"paid"', '"open"', $f['raw_body']);

    $threw = false;
    try {
        $wh->verify_and_parse($tampered, $f['signature'], $f['timestamp']);
    } catch (RuntimeException $e) {
        $threw = true;
    }
    assert_true($threw, 'RuntimeException on tampered body');
}

function test_expired_timestamp_fails(): void {
    $secret    = 'whsec_expiry';
    $f         = make_signed_event($secret);
    $old_stamp = date('c', time() - 400); // 400 seconds ago — outside 300s window
    $wh        = make_webhook($secret);

    $threw = false;
    try {
        $wh->verify_and_parse($f['raw_body'], $f['signature'], $old_stamp);
    } catch (RuntimeException $e) {
        $threw = true;
        assert_true(str_contains($e->getMessage(), 'tolerance window'), 'Tolerance window message');
    }
    assert_true($threw, 'RuntimeException on expired timestamp');
}

function test_invalid_timestamp_format_fails(): void {
    $secret = 'whsec_ts';
    $f      = make_signed_event($secret);
    $wh     = make_webhook($secret);

    $threw = false;
    try {
        $wh->verify_and_parse($f['raw_body'], $f['signature'], 'not-a-date');
    } catch (RuntimeException $e) {
        $threw = true;
        assert_true(str_contains($e->getMessage(), 'ISO 8601'), 'ISO 8601 message');
    }
    assert_true($threw, 'RuntimeException on invalid timestamp');
}

function test_malformed_json_payload_fails(): void {
    $secret    = 'whsec_json';
    $bad_body  = 'not valid json';
    $signature = hash_hmac('sha256', $bad_body, $secret);
    $timestamp = date('c');
    $wh        = make_webhook($secret);

    $threw = false;
    try {
        $wh->verify_and_parse($bad_body, $signature, $timestamp);
    } catch (RuntimeException $e) {
        $threw = true;
        assert_true(str_contains($e->getMessage(), 'v1 event contract'), 'Contract message');
    }
    assert_true($threw, 'RuntimeException on malformed payload');
}

function test_missing_event_id_fails(): void {
    $secret    = 'whsec_fields';
    $bad_event = ['type' => 'checkout.session.paid', 'createdAt' => date('c'), 'data' => ['object' => []]];
    $raw_body  = json_encode($bad_event);
    $signature = hash_hmac('sha256', $raw_body, $secret);
    $timestamp = date('c');
    $wh        = make_webhook($secret);

    $threw = false;
    try {
        $wh->verify_and_parse($raw_body, $signature, $timestamp);
    } catch (RuntimeException $e) {
        $threw = true;
    }
    assert_true($threw, 'RuntimeException on missing eventId');
}

// ---------------------------------------------------------------------------
// Dispatch / order update tests
// ---------------------------------------------------------------------------

function test_dispatch_paid_calls_payment_complete(): void {
    $secret = 'whsec_dispatch';
    $order  = new MockWCOrder();
    $wh     = make_webhook($secret, $order);

    $f = make_signed_event($secret, ['type' => 'checkout.session.paid']);
    $wh->dispatch($f['event']);

    assert_true($order->was_payment_complete_called(), 'payment_complete() called for paid event');
    assert_equals('processing', $order->get_status(), 'Order status is processing');
    assert_equals('pay_test_xyz', $order->get_payment_txn_id(), 'Transaction ID set to paymentId');
}

function test_dispatch_processing_sets_on_hold(): void {
    $secret  = 'whsec_dispatch';
    $order   = new MockWCOrder();
    $wh      = make_webhook($secret, $order);
    $session = ['id' => 'cs_1', 'reference' => '42', 'metadata' => ['wc_order_id' => '42']];

    $event = [
        'eventId'   => 'evt_2',
        'type'      => 'checkout.session.processing',
        'createdAt' => date('c'),
        'data'      => ['object' => $session],
    ];

    $wh->dispatch($event);

    assert_equals('on-hold', $order->get_status(), 'Order set to on-hold for processing event');
    assert_false($order->was_payment_complete_called(), 'payment_complete NOT called for processing event');
}

function test_dispatch_failed_sets_failed(): void {
    $secret  = 'whsec_d';
    $order   = new MockWCOrder();
    $wh      = make_webhook($secret, $order);
    $session = ['id' => 'cs_1', 'metadata' => ['wc_order_id' => '42']];

    $event = ['eventId' => 'e1', 'type' => 'checkout.session.failed', 'createdAt' => date('c'), 'data' => ['object' => $session]];

    $wh->dispatch($event);

    assert_equals('failed', $order->get_status(), 'Order set to failed');
}

function test_dispatch_expired_sets_cancelled(): void {
    $secret  = 'whsec_d';
    $order   = new MockWCOrder();
    $wh      = make_webhook($secret, $order);
    $session = ['id' => 'cs_1', 'metadata' => ['wc_order_id' => '42']];

    $event = ['eventId' => 'e2', 'type' => 'checkout.session.expired', 'createdAt' => date('c'), 'data' => ['object' => $session]];

    $wh->dispatch($event);

    assert_equals('cancelled', $order->get_status(), 'Order set to cancelled for expired event');
}

function test_dispatch_canceled_sets_cancelled(): void {
    $secret  = 'whsec_d';
    $order   = new MockWCOrder();
    $wh      = make_webhook($secret, $order);
    $session = ['id' => 'cs_1', 'metadata' => ['wc_order_id' => '42']];

    $event = ['eventId' => 'e3', 'type' => 'checkout.session.canceled', 'createdAt' => date('c'), 'data' => ['object' => $session]];

    $wh->dispatch($event);

    assert_equals('cancelled', $order->get_status(), 'Order set to cancelled for canceled event');
}

function test_dispatch_falls_back_to_reference_field(): void {
    $secret  = 'whsec_d';
    $order   = new MockWCOrder();
    // Session has no metadata.wc_order_id — only reference
    $session = ['id' => 'cs_1', 'reference' => '99'];
    $wh      = new PineTree_Webhook($secret, function (int $id) use ($order): ?MockWCOrder {
        return $id === 99 ? $order : null;
    });

    $event = ['eventId' => 'e4', 'type' => 'checkout.session.paid', 'createdAt' => date('c'), 'data' => ['object' => $session]];
    $wh->dispatch($event);

    assert_true($order->was_payment_complete_called(), 'Resolved order via reference fallback');
}

function test_dispatch_does_not_reprocess_terminal_order(): void {
    $secret  = 'whsec_d';
    $order   = new MockWCOrder();
    $order->update_status('completed');

    $wh      = make_webhook($secret, $order);
    $session = ['id' => 'cs_1', 'metadata' => ['wc_order_id' => '42']];
    $event   = ['eventId' => 'e5', 'type' => 'checkout.session.paid', 'createdAt' => date('c'), 'data' => ['object' => $session]];

    $wh->dispatch($event);

    // Should not call payment_complete on an already-completed order
    assert_false($order->was_payment_complete_called(), 'payment_complete not called on terminal order');
}

function test_dispatch_stores_pinetree_session_meta(): void {
    $secret  = 'whsec_d';
    $order   = new MockWCOrder();
    $wh      = make_webhook($secret, $order);
    $session = ['id' => 'cs_meta_test', 'paymentId' => 'pay_meta_test', 'metadata' => ['wc_order_id' => '42']];

    $event = ['eventId' => 'e6', 'type' => 'checkout.session.paid', 'createdAt' => date('c'), 'data' => ['object' => $session]];
    $wh->dispatch($event);

    assert_equals('cs_meta_test',  $order->get_meta('_pinetree_session_id'),  '_pinetree_session_id set');
    assert_equals('pay_meta_test', $order->get_meta('_pinetree_payment_id'), '_pinetree_payment_id set');
}

function test_dispatch_unknown_event_type_is_noop(): void {
    $secret  = 'whsec_d';
    $order   = new MockWCOrder();
    $wh      = make_webhook($secret, $order);

    $event = ['eventId' => 'e7', 'type' => 'payment.confirmed', 'createdAt' => date('c'), 'data' => ['object' => []]];
    $wh->dispatch($event);

    // Status should remain 'pending' — no update
    assert_equals('pending', $order->get_status(), 'Unknown event type is a no-op');
}

function test_dispatch_metadata_missing_falls_back_to_reference(): void {
    $secret  = 'whsec_d';
    $order   = new MockWCOrder();
    // Session has no metadata key at all — only reference
    $session = ['id' => 'cs_1', 'reference' => '42'];
    $wh      = new PineTree_Webhook($secret, function (int $id) use ($order): ?MockWCOrder {
        return $id === 42 ? $order : null;
    });

    $event = ['eventId' => 'e8', 'type' => 'checkout.session.paid', 'createdAt' => date('c'), 'data' => ['object' => $session]];
    $wh->dispatch($event);

    assert_true($order->was_payment_complete_called(), 'Order resolved when metadata key absent (reference fallback)');
}

function test_dispatch_metadata_non_array_falls_back_to_reference(): void {
    $secret  = 'whsec_d';
    $order   = new MockWCOrder();
    // Metadata is set but is not an array (edge case: corrupted payload)
    $session = ['id' => 'cs_2', 'reference' => '99', 'metadata' => null];
    $wh      = new PineTree_Webhook($secret, function (int $id) use ($order): ?MockWCOrder {
        return $id === 99 ? $order : null;
    });

    $event = ['eventId' => 'e9', 'type' => 'checkout.session.failed', 'createdAt' => date('c'), 'data' => ['object' => $session]];
    $wh->dispatch($event);

    assert_equals('failed', $order->get_status(), 'Order resolved when metadata is null (reference fallback)');
}

function test_dispatch_on_hold_order_can_be_paid(): void {
    $secret  = 'whsec_d';
    $order   = new MockWCOrder();
    $order->update_status('on-hold');
    $wh      = make_webhook($secret, $order);
    $session = ['id' => 'cs_3', 'paymentId' => 'pay_x', 'metadata' => ['wc_order_id' => '42']];

    $event = ['eventId' => 'e10', 'type' => 'checkout.session.paid', 'createdAt' => date('c'), 'data' => ['object' => $session]];
    $wh->dispatch($event);

    // on-hold is not terminal — should transition to processing
    assert_true($order->was_payment_complete_called(), 'on-hold order transitions to paid via payment_complete');
    assert_equals('processing', $order->get_status(), 'on-hold → processing on paid event');
}

// ---------------------------------------------------------------------------
// Idempotency tests
// ---------------------------------------------------------------------------

function test_duplicate_event_id_is_ignored(): void {
    $secret  = 'whsec_dup';
    $order   = new MockWCOrder();
    $wh      = make_webhook($secret, $order);
    $session = ['id' => 'cs_dup', 'paymentId' => 'pay_dup', 'metadata' => ['wc_order_id' => '42']];
    $event   = ['eventId' => 'evt_dup_001', 'type' => 'checkout.session.paid', 'createdAt' => date('c'), 'data' => ['object' => $session]];

    $wh->dispatch($event);
    $notes_after_first = count($order->get_notes());
    $status_after_first = $order->get_status();

    // Dispatch the same event again — should be a no-op on status but add a duplicate note.
    $wh->dispatch($event);

    $notes = $order->get_notes();
    assert_equals($notes_after_first + 1, count($notes), 'Duplicate dispatch adds exactly one note');

    $last_note = $notes[count($notes) - 1];
    assert_true(str_contains($last_note, 'duplicate'), 'Duplicate note mentions "duplicate"');
    assert_equals($status_after_first, $order->get_status(), 'Order status unchanged after duplicate');
}

function test_first_event_stores_event_id_in_processed_list(): void {
    $secret  = 'whsec_ids';
    $order   = new MockWCOrder();
    $wh      = make_webhook($secret, $order);
    $session = ['id' => 'cs_ids', 'paymentId' => 'pay_ids', 'metadata' => ['wc_order_id' => '42']];
    $event   = ['eventId' => 'evt_store_001', 'type' => 'checkout.session.paid', 'createdAt' => date('c'), 'data' => ['object' => $session]];

    $wh->dispatch($event);

    $raw       = $order->get_meta('_pinetree_processed_event_ids');
    $processed = json_decode($raw, true);

    assert_true(is_array($processed), 'Processed IDs stored as JSON array');
    assert_true(in_array('evt_store_001', $processed, true), 'Event ID is in processed list after dispatch');
}

function test_processed_ids_capped_at_20(): void {
    $secret = 'whsec_cap';
    $order  = new MockWCOrder();
    $wh     = new PineTree_Webhook($secret, function () use ($order): MockWCOrder { return $order; });

    // Pre-populate with exactly 20 event IDs.
    $existing = [];
    for ($i = 1; $i <= 20; $i++) {
        $existing[] = "evt_old_{$i}";
    }
    $order->update_meta_data('_pinetree_processed_event_ids', json_encode($existing));

    // Dispatch a 21st unique event.
    $session = ['id' => 'cs_cap', 'metadata' => ['wc_order_id' => '42']];
    $event   = ['eventId' => 'evt_new_21', 'type' => 'checkout.session.failed', 'createdAt' => date('c'), 'data' => ['object' => $session]];
    $wh->dispatch($event);

    $processed = json_decode($order->get_meta('_pinetree_processed_event_ids'), true);

    assert_equals(20, count($processed), 'Processed IDs capped at 20 after overflow');
    assert_true(in_array('evt_new_21', $processed, true), 'Newest event ID is retained');
    assert_false(in_array('evt_old_1', $processed, true), 'Oldest event ID is dropped');
}

function test_last_webhook_event_metadata_stored(): void {
    $secret  = 'whsec_lwe';
    $order   = new MockWCOrder();
    $wh      = make_webhook($secret, $order);
    $session = ['id' => 'cs_lwe', 'metadata' => ['wc_order_id' => '42']];
    $event   = ['eventId' => 'evt_lwe_001', 'type' => 'checkout.session.failed', 'createdAt' => date('c'), 'data' => ['object' => $session]];

    $wh->dispatch($event);

    assert_equals('checkout.session.failed', $order->get_meta('_pinetree_last_webhook_event'), '_pinetree_last_webhook_event stored');
    assert_equals('evt_lwe_001', $order->get_meta('_pinetree_last_event_id'), '_pinetree_last_event_id stored');
    assert_true(!empty($order->get_meta('_pinetree_last_webhook_at')), '_pinetree_last_webhook_at stored');
}

function test_no_last_event_meta_on_terminal_order(): void {
    $secret = 'whsec_term';
    $order  = new MockWCOrder();
    $order->update_status('completed');
    $wh     = make_webhook($secret, $order);

    $session = ['id' => 'cs_t', 'metadata' => ['wc_order_id' => '42']];
    $event   = ['eventId' => 'evt_t', 'type' => 'checkout.session.paid', 'createdAt' => date('c'), 'data' => ['object' => $session]];
    $wh->dispatch($event);

    // Terminal state guard fires after idempotency check — event was not processed, so
    // no metadata should be stored.
    assert_true(empty($order->get_meta('_pinetree_last_webhook_event')), 'No last event stored for terminal order');
}

// ---------------------------------------------------------------------------
// Checkout status metadata tests
// ---------------------------------------------------------------------------

function test_dispatch_paid_stores_checkout_status(): void {
    $secret  = 'whsec_cs';
    $order   = new MockWCOrder();
    $wh      = make_webhook($secret, $order);
    $session = ['id' => 'cs_paid', 'paymentId' => 'pay_p', 'status' => 'paid', 'metadata' => ['wc_order_id' => '42']];
    $event   = ['eventId' => 'evt_cs_paid', 'type' => 'checkout.session.paid', 'createdAt' => date('c'), 'data' => ['object' => $session]];

    $wh->dispatch($event);

    assert_equals('paid', $order->get_meta('_pinetree_checkout_status'), '_pinetree_checkout_status set to "paid" for paid event');
}

function test_dispatch_failed_stores_checkout_status(): void {
    $secret  = 'whsec_cs';
    $order   = new MockWCOrder();
    $wh      = make_webhook($secret, $order);
    $session = ['id' => 'cs_fail', 'status' => 'failed', 'metadata' => ['wc_order_id' => '42']];
    $event   = ['eventId' => 'evt_cs_failed', 'type' => 'checkout.session.failed', 'createdAt' => date('c'), 'data' => ['object' => $session]];

    $wh->dispatch($event);

    assert_equals('failed', $order->get_meta('_pinetree_checkout_status'), '_pinetree_checkout_status set to "failed" for failed event');
}
