// Consumer validation for @pinetreepayments/node
// Typechecked against dist/types — verifies all documented exports compile.
import PineTree, {
  PineTree as NamedPineTree,
  PineTreeError,
  AuthenticationError,
  PermissionError,
  InvalidRequestError,
  APIConnectionError,
  IdempotencyConflictError,
  WebhookVerificationError,
  PineTreeWebhookHeaders,
  PineTreeWebhookVersion,
} from "@pinetreepayments/node"
import type {
  CheckoutSession,
  CheckoutSessionCreateParams,
  CheckoutSessionCreateOptions,
  CheckoutSessionListParams,
  CheckoutSessionList,
  CheckoutSessionStatus,
  Payment,
  WebhookDelivery,
  WebhookDeliveryList,
  WebhookDeliveryStatus,
  Event,
  PineTreeOptions,
  PineTreeWebhookHeaderObject,
} from "@pinetreepayments/node"

const _namedSameAsDefault: typeof PineTree = NamedPineTree

const _options: PineTreeOptions = { apiKey: "pt_live_test", baseUrl: "http://localhost:3000" }
const client = new PineTree(_options)
const _client2 = new PineTree("pt_live_test")

void (async () => {
  // Checkout sessions — all five operations
  const session: CheckoutSession = await client.checkout.sessions.create(
    {
      amount: 2500,
      currency: "USD",
      reference: "order_123",
      customer: { email: "alice@example.com" },
      metadata: { plan: "pro" },
      rails: ["solana_usdc"],
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    } satisfies CheckoutSessionCreateParams,
    { idempotencyKey: "order_abc123_attempt_1" } satisfies CheckoutSessionCreateOptions
  )
  const _status: CheckoutSessionStatus = session.status

  await client.checkout.sessions.retrieve("cs_...")
  const list: CheckoutSessionList = await client.checkout.sessions.list(
    { status: "open", limit: 20, cursor: "c1", createdAfter: "2026-01-01" } satisfies CheckoutSessionListParams
  )
  void list.hasMore
  void list.nextCursor

  await client.checkout.sessions.cancel("cs_...")
  await client.checkout.sessions.expire("cs_...")

  // Payments
  const payment: Payment = await client.payments.retrieve("pay_...")
  void payment.status

  // Webhook deliveries — list and retry
  const deliveries: WebhookDeliveryList = await client.webhookDeliveries.list({ status: "failed" })
  void deliveries.hasMore

  const retried: WebhookDelivery = await client.webhookDeliveries.retry("wdl_...")
  const _wdStatus: WebhookDeliveryStatus = retried.status
  void retried.id

  // Webhook verification — header-object overload
  const headers: PineTreeWebhookHeaderObject = {
    "PineTree-Signature": "sha256=abc",
    "PineTree-Timestamp": new Date().toISOString(),
    "PineTree-Event-Id": "evt_1",
    "PineTree-Webhook-Version": PineTreeWebhookVersion,
  }
  const event: Event<CheckoutSession> = client.webhooks.constructEvent(
    Buffer.from("{}"),
    headers,
    "whsec_test"
  )
  void event.type
  void PineTreeWebhookHeaders.signature

  // Error class hierarchy
  const _e1 = new PineTreeError("msg")
  const _e2 = new AuthenticationError("msg")
  const _e3 = new PermissionError("msg")
  const _e4 = new InvalidRequestError("msg")
  const _e5 = new APIConnectionError("msg")
  const _e6 = new IdempotencyConflictError("msg")
  const _e7 = new WebhookVerificationError("msg")
})()
