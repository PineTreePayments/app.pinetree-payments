/**
 * Bridge (by Stripe) provider - public surface.
 *
 * Importing this module registers the Bridge adapter with the provider
 * registry. Everything exported here is server-only: no browser bundle may
 * import from this directory.
 */

import "./adapter"

export { bridgeAdapter, BridgeAdapter } from "./adapter"
export type { BridgeConnectMerchantInput, BridgeConnectMerchantResult } from "./adapter"

export {
  BRIDGE_PRODUCTION_BASE_URL,
  BRIDGE_SANDBOX_BASE_URL,
  BridgeConfigError,
  bridgeBaseUrlForEnvironment,
  describeBridgeConfiguration,
  getBridgeConfig,
  getBridgeWebhookPublicKey,
  isBridgeConfigured,
  resolveBridgeEnvironment,
  validateBridgeBaseUrl,
} from "./config"
export type { BridgeConfig, BridgeEnvironment } from "./config"

export {
  assertUsableIdempotencyKey,
  bridgeRequest,
  buildBridgeHeaders,
  createKycLink,
  createWebhook,
  fetchWebhookDetails,
  getCustomer,
  getKycLink,
  getMerchantStatus,
  syncCustomerStatus,
} from "./client"
export type { BridgeRequestContext, BridgeRequestResult } from "./client"

export {
  BridgeApiError,
  BridgeError,
  BridgeInvalidResponseError,
  BridgeTransportError,
  describeBridgeError,
  isBridgeRetryableError,
  isBridgeUnknownOutcomeError,
} from "./errors"

export {
  BRIDGE_ONBOARDING_VERSION,
  bridgeOnboardingIdempotencyKey,
  bridgeWebhookIdempotencyKey,
} from "./idempotency"

export {
  assertBridgeDecimalAmount,
  bridgeDecimalFromMinorUnits,
  bridgeMinorUnitsFromDecimal,
} from "./money"

export {
  BRIDGE_DISPLAY_NAME,
  BRIDGE_PROVIDER_KEY,
  BRIDGE_REQUIRED_ENDORSEMENT,
  buildBridgeConnectionState,
  bridgeActionRequiredDetail,
  emptyBridgeConnection,
  isBridgeApproved,
  isBridgeBlocked,
  isBridgeKybCleared,
  isBridgeTosAccepted,
  isBridgeUnderReview,
  normalizeBridgeConnection,
  normalizeBridgeEndorsement,
  normalizeBridgeEndorsements,
  outstandingBridgeRequirements,
  resolveBridgeProviderState,
} from "./normalize"

export {
  BRIDGE_REDACTED,
  bridgeSafeBodySummary,
  containsBridgeSecret,
  redactBridgeHeaders,
  redactBridgePayload,
} from "./redact"

export {
  SUPPORTED_BRIDGE_EVENT_CATEGORIES,
  extractBridgeEventObject,
  translateBridgeEvent,
} from "./translateEvent"
export type { BridgeEventCategory, NormalizedBridgeConnectionEvent } from "./translateEvent"

export type {
  BridgeConnectionState,
  BridgeCustomer,
  BridgeCustomerStatus,
  BridgeCustomerType,
  BridgeEndorsement,
  BridgeKycLink,
  BridgeKycStatus,
  BridgeTosStatus,
  BridgeWebhookEndpoint,
  BridgeWebhookEvent,
  NormalizedBridgeConnection,
  NormalizedBridgeEndorsement,
  PineTreeProviderState,
} from "./types"
export { PINETREE_PROVIDER_STATE_LABELS, pineTreeProviderStateLabel } from "./types"

export {
  BRIDGE_SIGNATURE_HEADER,
  BRIDGE_WEBHOOK_TOLERANCE_MS,
  isBridgeTimestampFresh,
  parseBridgeSignatureHeader,
  verifyBridgeWebhookSignature,
} from "./verifyWebhook"
export type { BridgeWebhookRejectionReason, BridgeWebhookVerificationResult } from "./verifyWebhook"
