/**
 * Temporary structured latency instrumentation for the Base POS checkout
 * flow (WalletConnect session setup + wallet hand-off latency only — this
 * has no bearing on payment confirmation).
 *
 * Correlation key: paymentId (falling back to intentId before a payment
 * exists yet) rather than a newly-minted trace ID. The POS terminal and the
 * customer's phone are two separate browser sessions on two separate
 * devices with no shared JS context — paymentId/intentId is the only
 * identifier already flowing through both sides (and through every existing
 * log line in this flow), so reusing it avoids inventing a second ID that
 * would need to be threaded across a device boundary for no added benefit.
 *
 * Timestamps use Date.now() (wall-clock epoch ms), not performance.now().
 * performance.now() is relative to each page's own navigation start and is
 * NOT comparable across two different browser tabs on two different
 * devices — several of the milestones this module records intentionally
 * span the POS terminal and the customer's phone (e.g. display_uri_emitted
 * happens on the terminal; customer_pairing_uri_received happens on the
 * phone). Date.now() gives wall-clock timestamps comparable across devices
 * (assuming normal OS clock sync), which is what cross-device duration
 * math actually needs; the sub-millisecond precision performance.now()
 * would add is not meaningful at the multi-second scale being measured
 * here, and would be actively misleading if diffed across devices.
 */

export type BaseLatencyMilestone =
  | "base_option_tapped"
  | "select_network_request_started"
  | "select_network_response_received"
  | "pos_detected_base_selection"
  | "run_pos_base_flow_started"
  | "walletconnect_provider_requested"
  | "walletconnect_provider_ready"
  | "connect_called"
  | "display_uri_emitted"
  | "pairing_uri_session_write_started"
  | "pairing_uri_session_write_completed"
  | "customer_pairing_uri_received"
  | "wallet_list_request_started"
  | "wallet_list_request_completed"
  | "wallet_list_rendered"
  | "wallet_selected"
  | "wallet_deeplink_constructed"
  | "wallet_deeplink_launched"
  | "browser_visibility_hidden"
  | "browser_visibility_restored"
  | "wallet_connected"
  | "transaction_request_started"

export function markBaseCheckoutLatency(
  milestone: BaseLatencyMilestone,
  context: { paymentId?: string; intentId?: string; [key: string]: unknown } = {}
): void {
  console.log(`[BaseLatency] ${milestone}`, { t: Date.now(), ...context })
}
