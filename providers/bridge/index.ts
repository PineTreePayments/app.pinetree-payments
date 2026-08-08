/**
 * Bridge (by Stripe) provider - public surface.
 *
 * Importing this module registers the Bridge adapter with the provider
 * registry. Everything exported here is server-only: no browser bundle may
 * import from this directory.
 */

import "./adapter"

export { bridgeAdapter, BridgeAdapter } from "./adapter"
export type {
  BridgeConnectMerchantInput,
  BridgeConnectMerchantResult,
  BridgeUpdateMerchantInput,
} from "./adapter"

export {
  BRIDGE_PRODUCTION_BASE_URL,
  BRIDGE_SANDBOX_BASE_URL,
  BridgeConfigError,
  bridgeBaseUrlForEnvironment,
  describeBridgeConfiguration,
  getBridgeConfig,
  getBridgeWebhookPublicKey,
  isBridgeConfigured,
  isBridgeSandbox,
  resolveBridgeEnvironment,
  validateBridgeBaseUrl,
} from "./config"
export type { BridgeConfig, BridgeEnvironment } from "./config"

export {
  assertUsableIdempotencyKey,
  bridgeListItems,
  bridgeRequest,
  buildBridgeHeaders,
  createCustomer,
  createExternalAccount,
  createKycLink,
  createLiquidationAddress,
  createTosLink,
  createWebhook,
  deactivateExternalAccount,
  fetchWebhookDetails,
  getCustomer,
  getHostedKycLinkForCustomer,
  getKycLink,
  getMerchantStatus,
  listExternalAccounts,
  listLiquidationAddressDrains,
  listLiquidationAddresses,
  simulateKycApproval,
  syncCustomerStatus,
  updateCustomer,
} from "./client"
export type {
  BridgeRequestContext,
  BridgeRequestResult,
  CreateBridgeLiquidationAddressInput,
  CreateBridgeUsExternalAccountInput,
} from "./client"

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
  bridgeCustomerIdempotencyKey,
  bridgeCustomerUpdateIdempotencyKey,
  bridgeExternalAccountIdempotencyKey,
  bridgeLiquidationAddressIdempotencyKey,
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
  BRIDGE_CONNECTION_EVENT_CATEGORIES,
  SUPPORTED_BRIDGE_EVENT_CATEGORIES,
  extractBridgeEventObject,
  isBridgeDrainEventCategory,
  translateBridgeEvent,
} from "./translateEvent"
export type { BridgeEventCategory, NormalizedBridgeConnectionEvent } from "./translateEvent"

export {
  bridgeChainForRail,
  depositTxHashMatches,
  findMatchingLiquidationAddress,
  isReturnAddressValidForChain,
  normalizeBridgeDrain,
  normalizeBridgeDrainState,
  normalizeBridgeExternalAccount,
  normalizeBridgeLiquidationAddress,
  railForBridgeChain,
} from "./normalizeMoneyMovement"
export type {
  NormalizedBridgeDrain,
  NormalizedBridgeExternalAccount,
  NormalizedBridgeLiquidationAddress,
  PineTreeLiquidationRail,
} from "./normalizeMoneyMovement"

export type {
  BridgeAccountPurpose,
  BridgeAddress,
  BridgeAssociatedPerson,
  BridgeBusinessCustomerPayload,
  BridgeBusinessType,
  BridgeConnectionState,
  BridgeCustomer,
  BridgeCustomerStatus,
  BridgeCustomerType,
  BridgeDrain,
  BridgeDrainState,
  BridgeEndorsement,
  BridgeEstimatedAnnualRevenue,
  BridgeExternalAccount,
  BridgeHighRiskActivity,
  BridgeIdentifyingInformation,
  BridgeKycLink,
  BridgeKycStatus,
  BridgeLiquidationAddress,
  BridgeLiquidationChain,
  BridgeSourceOfFunds,
  BridgeTosStatus,
  BridgeWebhookEndpoint,
  BridgeWebhookEvent,
  NormalizedBridgeConnection,
  NormalizedBridgeEndorsement,
  PineTreeProviderState,
} from "./types"
export {
  BRIDGE_ACCOUNT_PURPOSES,
  BRIDGE_BUSINESS_TYPES,
  BRIDGE_DRAIN_STATES,
  BRIDGE_ESTIMATED_ANNUAL_REVENUE,
  BRIDGE_HIGH_RISK_ACTIVITIES,
  BRIDGE_LIQUIDATION_CHAINS,
  BRIDGE_SOURCE_OF_FUNDS,
  PINETREE_PROVIDER_STATE_LABELS,
  pineTreeProviderStateLabel,
} from "./types"

export {
  BRIDGE_SIGNATURE_HEADER,
  BRIDGE_WEBHOOK_TOLERANCE_MS,
  isBridgeTimestampFresh,
  parseBridgeSignatureHeader,
  verifyBridgeWebhookSignature,
} from "./verifyWebhook"
export type { BridgeWebhookRejectionReason, BridgeWebhookVerificationResult } from "./verifyWebhook"
