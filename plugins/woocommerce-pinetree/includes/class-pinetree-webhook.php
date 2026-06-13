<?php
/**
 * PineTree webhook handler.
 *
 * Responsibilities:
 *  1. Read raw request body + PineTree-Signature / PineTree-Timestamp headers.
 *  2. Verify HMAC-SHA256 signature with timing-safe comparison.
 *  3. Parse and validate the v1 event payload.
 *  4. Map checkout.session.* events to WooCommerce order status updates.
 *
 * verify_and_parse() and dispatch() are public so they can be exercised
 * directly in tests without triggering HTTP I/O or exit.
 */

defined('ABSPATH') || exit;

class PineTree_Webhook {

    /** Reject events with a timestamp older than this many seconds. */
    private const TOLERANCE_SECONDS = 300;

    private string $webhook_secret;
    /** @var callable|null fn(int $order_id): object|null — injectable for tests */
    private $order_resolver;

    /**
     * @param string        $webhook_secret  Signing secret from PineTree dashboard.
     * @param callable|null $order_resolver  Injected order resolver; defaults to wc_get_order().
     */
    public function __construct(string $webhook_secret, ?callable $order_resolver = null) {
        $this->webhook_secret = $webhook_secret;
        $this->order_resolver = $order_resolver;
    }

    // ------------------------------------------------------------------
    // Entry point
    // ------------------------------------------------------------------

    /** Current supported webhook version (matches PineTree Node SDK). */
    private const WEBHOOK_VERSION = '2026-06-12';

    /**
     * Handle an incoming webhook request.
     * Reads superglobals, verifies, dispatches, then exits with HTTP response.
     */
    public function handle(): void {
        $raw_body = (string) file_get_contents('php://input');

        // Support both current (PineTree-*) and legacy (X-PineTree-*) header names.
        $signature = $_SERVER['HTTP_PINETREE_SIGNATURE']  ?? ($_SERVER['HTTP_X_PINETREE_SIGNATURE'] ?? '');
        $timestamp  = $_SERVER['HTTP_PINETREE_TIMESTAMP']  ?? ($_SERVER['HTTP_X_PINETREE_TIMESTAMP'] ?? '');
        $version    = $_SERVER['HTTP_PINETREE_WEBHOOK_VERSION'] ?? '';

        if ('' === $raw_body || '' === $signature || '' === $timestamp) {
            $this->send_response(400, 'Missing required webhook headers or empty body.');
            return;
        }

        // Reject events from unsupported future webhook versions.
        if ('' !== $version && $version !== self::WEBHOOK_VERSION) {
            wc_get_logger()->warning(
                sprintf('PineTree webhook: unsupported version %s (expected %s).', $version, self::WEBHOOK_VERSION),
                ['source' => 'woocommerce-pinetree']
            );
            $this->send_response(400, sprintf('Unsupported PineTree webhook version: %s.', $version));
            return;
        }

        try {
            $event = $this->verify_and_parse($raw_body, $signature, $timestamp);
        } catch (RuntimeException $e) {
            wc_get_logger()->warning(
                'PineTree webhook verification failed: ' . $e->getMessage(),
                ['source' => 'woocommerce-pinetree']
            );
            $this->send_response(400, $e->getMessage());
            return;
        }

        try {
            $this->dispatch($event);
        } catch (\Throwable $e) {
            wc_get_logger()->error(
                'PineTree webhook dispatch error: ' . $e->getMessage(),
                ['source' => 'woocommerce-pinetree']
            );
            // Return 500 so PineTree retries — the event was authentic but we failed to process it.
            $this->send_response(500, 'Webhook received but could not be processed. Please retry.');
            return;
        }

        // Update site-wide summary for WooCommerce → Status page.
        // Stores event type and timestamp only — no raw payload or sensitive data.
        update_option('pinetree_wc_last_webhook_summary', [
            'event' => $event['type'] ?? '',
            'at'    => gmdate('c'),
        ], false);

        $this->send_response(200, 'ok');
    }

    // ------------------------------------------------------------------
    // Verification (pure — no WP or WC dependencies)
    // ------------------------------------------------------------------

    /**
     * Verify the HMAC-SHA256 webhook signature and parse the event payload.
     *
     * @param string $raw_body  Raw JSON request body bytes.
     * @param string $signature Value of PineTree-Signature header (may carry sha256= prefix).
     * @param string $timestamp Value of PineTree-Timestamp header (ISO 8601).
     * @return array<string, mixed> Parsed and validated v1 event.
     * @throws RuntimeException On invalid signature, expired timestamp, or malformed payload.
     */
    public function verify_and_parse(string $raw_body, string $signature, string $timestamp): array {
        // 1. Validate timestamp within tolerance window.
        $parsed_time = strtotime($timestamp);
        if ($parsed_time === false) {
            throw new RuntimeException('PineTree-Timestamp header is not a valid ISO 8601 timestamp.');
        }

        $age_seconds = abs(time() - $parsed_time);
        if ($age_seconds > self::TOLERANCE_SECONDS) {
            throw new RuntimeException(
                sprintf(
                    'Webhook timestamp is %d seconds old — outside the %d-second tolerance window.',
                    $age_seconds,
                    self::TOLERANCE_SECONDS
                )
            );
        }

        // 2. Compute expected HMAC-SHA256 over the raw body.
        $expected = hash_hmac('sha256', $raw_body, $this->webhook_secret, false);

        // 3. Normalize received signature: strip optional sha256= prefix.
        $actual = trim($signature);
        if (stripos($actual, 'sha256=') === 0) {
            $actual = substr($actual, 7);
        }

        // 4. Timing-safe comparison prevents length-leaking side channels.
        if (!hash_equals($expected, $actual)) {
            throw new RuntimeException('Webhook signature verification failed.');
        }

        // 5. Parse and assert the v1 event contract.
        $event = json_decode($raw_body, true);
        if (
            !is_array($event)
            || empty($event['eventId'])
            || empty($event['type'])
            || empty($event['createdAt'])
            || !isset($event['data']['object'])
        ) {
            throw new RuntimeException('Webhook payload does not match the PineTree v1 event contract.');
        }

        return $event;
    }

    // ------------------------------------------------------------------
    // Dispatching
    // ------------------------------------------------------------------

    /**
     * Route a verified event to the appropriate WooCommerce order update.
     *
     * @param array<string, mixed> $event Verified PineTree v1 event.
     */
    public function dispatch(array $event): void {
        $type     = $event['type']           ?? '';
        $session  = $event['data']['object'] ?? [];
        $event_id = $event['eventId']        ?? '';

        switch ($type) {
            case 'checkout.session.paid':
                $this->update_order($session, 'processing',
                    __('PineTree payment confirmed.', 'woocommerce-pinetree'),
                    true, $event_id, $type);
                break;

            case 'checkout.session.processing':
                $this->update_order($session, 'on-hold',
                    __('PineTree: payment on-chain, awaiting confirmation.', 'woocommerce-pinetree'),
                    false, $event_id, $type);
                break;

            case 'checkout.session.failed':
                $this->update_order($session, 'failed',
                    __('PineTree: payment failed.', 'woocommerce-pinetree'),
                    false, $event_id, $type);
                break;

            case 'checkout.session.expired':
                $this->update_order($session, 'cancelled',
                    __('PineTree: session expired.', 'woocommerce-pinetree'),
                    false, $event_id, $type);
                break;

            case 'checkout.session.canceled':
                $this->update_order($session, 'cancelled',
                    __('PineTree: session cancelled.', 'woocommerce-pinetree'),
                    false, $event_id, $type);
                break;

            default:
                // Unhandled event type — acknowledge with 200 and no action.
                break;
        }
    }

    // ------------------------------------------------------------------
    // Order update
    // ------------------------------------------------------------------

    /** Max processed event IDs to retain per order (prevents unbounded growth). */
    private const MAX_PROCESSED_IDS = 20;

    /**
     * Resolve the WooCommerce order and apply the status transition.
     *
     * Order ID is sourced (in priority order):
     *   1. metadata.wc_order_id  (set by the gateway during session creation)
     *   2. reference field       (fallback; gateway sets this to the WC order ID)
     *
     * @param array<string, mixed> $session    PineTree CheckoutSession object.
     * @param string               $wc_status  Target WooCommerce order status slug.
     * @param string               $note       Admin order note.
     * @param bool                 $complete   Call payment_complete() for paid events.
     * @param string               $event_id   PineTree event ID for idempotency tracking.
     * @param string               $event_type PineTree event type for metadata storage.
     */
    private function update_order(
        array $session,
        string $wc_status,
        string $note,
        bool $complete = false,
        string $event_id = '',
        string $event_type = ''
    ): void {
        $metadata = isset($session['metadata']) && is_array($session['metadata']) ? $session['metadata'] : [];
        $order_id = $metadata['wc_order_id'] ?? ($session['reference'] ?? null);

        if (empty($order_id)) {
            wc_get_logger()->warning(
                sprintf('PineTree webhook: cannot resolve WC order from session %s — no wc_order_id or reference.', $session['id'] ?? 'unknown'),
                ['source' => 'woocommerce-pinetree']
            );
            return;
        }

        $resolver = $this->order_resolver ?? static fn($id) => wc_get_order((int) $id);
        $order    = $resolver((int) $order_id);

        if (!$order) {
            wc_get_logger()->warning(
                sprintf('PineTree webhook: WC order %d not found (session %s).', (int) $order_id, $session['id'] ?? 'unknown'),
                ['source' => 'woocommerce-pinetree']
            );
            return;
        }

        // Idempotency: check if this event ID has already been processed.
        if ($event_id !== '') {
            $raw_ids       = $order->get_meta('_pinetree_processed_event_ids');
            $processed_ids = (!empty($raw_ids) && is_string($raw_ids))
                ? (array) json_decode($raw_ids, true)
                : [];

            if (in_array($event_id, $processed_ids, true)) {
                wc_get_logger()->info(
                    sprintf('PineTree webhook: duplicate event %s on order %d — ignored.', $event_id, (int) $order_id),
                    ['source' => 'woocommerce-pinetree']
                );
                $order->add_order_note(
                    sprintf(
                        /* translators: %s = PineTree event ID */
                        __('PineTree: duplicate event %s — already processed, no action taken.', 'woocommerce-pinetree'),
                        $event_id
                    )
                );
                $order->save();
                return;
            }
        } else {
            $processed_ids = [];
        }

        // Do not re-process orders already in a terminal state.
        // on-hold is NOT terminal — allow on-hold → paid transitions.
        $terminal = ['completed', 'processing', 'cancelled', 'failed', 'refunded'];
        if (in_array($order->get_status(), $terminal, true)) {
            return;
        }

        // Persist PineTree identifiers for reconciliation and support.
        if (!empty($session['id'])) {
            $order->update_meta_data('_pinetree_session_id', sanitize_text_field($session['id']));
        }
        if (!empty($session['paymentId'])) {
            $order->update_meta_data('_pinetree_payment_id', sanitize_text_field($session['paymentId']));
        }
        if (!empty($session['status'])) {
            $order->update_meta_data('_pinetree_checkout_status', sanitize_text_field($session['status']));
        }

        if ($complete) {
            // payment_complete() triggers WC stock reduction, emails, and hooks.
            $order->payment_complete(sanitize_text_field($session['paymentId'] ?? ($session['id'] ?? '')));
            $order->add_order_note($note);
        } else {
            $order->update_status($wc_status, $note);
        }

        // Record processed event ID (capped at MAX_PROCESSED_IDS to prevent growth).
        if ($event_id !== '') {
            $processed_ids[] = $event_id;
            if (count($processed_ids) > self::MAX_PROCESSED_IDS) {
                $processed_ids = array_slice($processed_ids, -self::MAX_PROCESSED_IDS);
            }
            $order->update_meta_data('_pinetree_processed_event_ids', json_encode(array_values($processed_ids)));
            $order->update_meta_data('_pinetree_last_event_id', sanitize_text_field($event_id));
        }

        // Store last webhook event type and timestamp for the admin meta box.
        if ($event_type !== '') {
            $order->update_meta_data('_pinetree_last_webhook_event', sanitize_text_field($event_type));
        }
        $order->update_meta_data('_pinetree_last_webhook_at', gmdate('c'));

        $order->save();
    }

    // ------------------------------------------------------------------
    // HTTP response helper
    // ------------------------------------------------------------------

    private function send_response(int $status_code, string $message): void {
        http_response_code($status_code);
        header('Content-Type: application/json');
        echo wp_json_encode(['message' => $message]);
        exit;
    }
}
