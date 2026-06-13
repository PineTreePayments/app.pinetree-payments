<?php
/**
 * PineTree API HTTP client.
 *
 * Uses the WordPress HTTP API (wp_remote_post / wp_remote_get).
 * Both transports are injectable for unit testing:
 *   POST: fn(string $url, array $args): array|WP_Error
 *   GET:  fn(string $url, array $args): array|WP_Error
 *
 * SECURITY: never log or expose $api_key in responses, notices, or errors.
 */

defined('ABSPATH') || exit;

class PineTree_API {

    private const DEFAULT_BASE_URL = 'https://app.pinetree-payments.com';
    private const TIMEOUT_SECONDS  = 30;

    private string $api_key;
    private string $base_url;
    /** @var callable|null Injected POST transport; defaults to wp_remote_post. */
    private $http_post_client;
    /** @var callable|null Injected GET transport; defaults to wp_remote_get. */
    private $http_get_client;

    /**
     * @param string        $api_key          pt_live_* secret key. Server-only.
     * @param string        $base_url         Override for local dev / staging.
     * @param callable|null $http_post_client Injected POST transport (for tests).
     * @param callable|null $http_get_client  Injected GET transport (for tests).
     */
    public function __construct(
        string $api_key,
        string $base_url = self::DEFAULT_BASE_URL,
        ?callable $http_post_client = null,
        ?callable $http_get_client = null
    ) {
        $this->api_key          = $api_key;
        $this->base_url         = rtrim($base_url, '/');
        $this->http_post_client = $http_post_client;
        $this->http_get_client  = $http_get_client;
    }

    /**
     * Create a PineTree checkout session.
     *
     * @param array{
     *   amount:      int,
     *   currency?:   string,
     *   reference?:  string,
     *   customer?:   array{email?: string},
     *   metadata?:   array<string, mixed>,
     *   rails?:      string[],
     *   successUrl?: string,
     *   cancelUrl?:  string,
     * } $params
     * @param string|null $idempotency_key Stable per-order key; safe to retry.
     * @return array<string, mixed> Parsed CheckoutSession object.
     * @throws RuntimeException On network error or non-2xx API response.
     */
    public function create_checkout_session(array $params, ?string $idempotency_key = null): array {
        $headers = [
            'Authorization' => 'Bearer ' . $this->api_key,
            'Content-Type'  => 'application/json',
            'Accept'        => 'application/json',
        ];

        if ($idempotency_key !== null) {
            $headers['Idempotency-Key'] = $idempotency_key;
        }

        $response = $this->post(
            $this->base_url . '/api/v1/checkout/sessions',
            [
                'headers'     => $headers,
                'body'        => wp_json_encode($params),
                'timeout'     => self::TIMEOUT_SECONDS,
                'sslverify'   => true,
                'data_format' => 'body',
            ]
        );

        return $this->parse_response($response);
    }

    /**
     * List checkout sessions — read-only, no side effects. Used for connection tests.
     *
     * @param int $limit Max sessions to return (1 is sufficient for a connectivity check).
     * @return array<string, mixed> Parsed list response.
     * @throws RuntimeException On network error or non-2xx response.
     */
    public function list_checkout_sessions(int $limit = 1): array {
        $headers = [
            'Authorization' => 'Bearer ' . $this->api_key,
            'Accept'        => 'application/json',
        ];

        $url = add_query_arg(['limit' => $limit], $this->base_url . '/api/v1/checkout/sessions');

        $response = $this->get($url, [
            'headers'   => $headers,
            'timeout'   => self::TIMEOUT_SECONDS,
            'sslverify' => true,
        ]);

        return $this->parse_response($response);
    }

    /**
     * Retrieve a single PineTree checkout session by ID.
     *
     * Used by the manual sync action to fetch current session state.
     *
     * @param string $session_id PineTree session ID (e.g., cs_...).
     * @return array<string, mixed> Parsed CheckoutSession object.
     * @throws RuntimeException On network error or non-2xx API response.
     */
    public function get_checkout_session(string $session_id): array {
        $headers = [
            'Authorization' => 'Bearer ' . $this->api_key,
            'Accept'        => 'application/json',
        ];

        $url = $this->base_url . '/api/v1/checkout/sessions/' . rawurlencode($session_id);

        $response = $this->get($url, [
            'headers'   => $headers,
            'timeout'   => self::TIMEOUT_SECONDS,
            'sslverify' => true,
        ]);

        return $this->parse_response($response);
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    /** @return array<string, mixed>|WP_Error */
    private function post(string $url, array $args) {
        if ($this->http_post_client !== null) {
            return ($this->http_post_client)($url, $args);
        }
        return wp_remote_post($url, $args);
    }

    /** @return array<string, mixed>|WP_Error */
    private function get(string $url, array $args) {
        if ($this->http_get_client !== null) {
            return ($this->http_get_client)($url, $args);
        }
        return wp_remote_get($url, $args);
    }

    /**
     * Parse a wp_remote_* response into a decoded array.
     *
     * @param array<string, mixed>|WP_Error $response
     * @return array<string, mixed>
     * @throws RuntimeException
     */
    private function parse_response($response): array {
        if (is_wp_error($response)) {
            throw new RuntimeException(
                'PineTree API connection error: ' . $response->get_error_message()
            );
        }

        $status_code = (int) wp_remote_retrieve_response_code($response);
        $body        = wp_remote_retrieve_body($response);
        $decoded     = json_decode($body, true);

        if (!is_array($decoded)) {
            throw new RuntimeException(
                sprintf('PineTree API returned a non-JSON response (HTTP %d).', $status_code)
            );
        }

        if ($status_code < 200 || $status_code >= 300) {
            $error   = $decoded['error'] ?? [];
            $message = $error['message'] ?? 'Unknown API error';
            $code    = $error['code']    ?? 'api_error';
            throw new RuntimeException(
                sprintf('PineTree API error [%s]: %s (HTTP %d)', $code, $message, $status_code)
            );
        }

        return $decoded;
    }
}
