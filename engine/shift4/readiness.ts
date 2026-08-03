/** Central, server-derived Shift4 capability and feature-gate model. */
import { getShift4RestConnectionStatus, type Shift4RestConnectionStatusView } from "@/database/merchantShift4RestConnections"
import { listMerchantTerminalReaders, type MerchantTerminalReader } from "@/database/merchantTerminalReaders"
import { getLatestShift4OnboardingSession, type Shift4OnboardingSessionRow } from "@/database/shift4OnboardingSessions"
import { projectShift4OnboardingReadiness } from "./onboarding/readiness"
import { getShift4I4GoBrowserConfig } from "@/providers/shift4/i4go"
import type { Shift4Channel, Shift4EngineOperation } from "./types"

export type Shift4Capability =
  | "rest_api"
  | "merchant_authentication"
  | "merchant_onboarding"
  | "ecommerce"
  | "retail"
  | "tokenization"
  | "hosted_checkout"
  | "manual_authorization"
  | "partial_approval"
  | "split_tender"
  | "apple_pay"
  | "google_pay"
  | "terminal"
  | "certification"
  | "production_processing"

export type Shift4CapabilityState =
  | "not_configured"
  | "configured"
  | "authenticated"
  | "capable"
  | "certification_required"
  | "certified"
  | "enabled"
  | "disabled"
  | "blocked"

export type Shift4FeatureFlags = Readonly<{
  restApi: boolean
  ecommerce: boolean
  retail: boolean
  certificationMode: boolean
  manualAuthorization: boolean
  partialApproval: boolean
  splitTender: boolean
  applePay: boolean
  googlePay: boolean
  production: boolean
  onboardingRequired: boolean
  commerceEngineConfigured: boolean
}>

export type Shift4CapabilityView = Readonly<{
  state: Shift4CapabilityState
  ready: boolean
  reason: string
}>

export type Shift4Readiness = Readonly<{
  connectionId: string | null
  environment: "test" | "production" | null
  authenticated: boolean
  processingEnabled: boolean
  capabilities: Readonly<Record<Shift4Capability, Shift4CapabilityView>>
  flags: Shift4FeatureFlags
}>

const enabled = (value: string | undefined) => value?.trim().toLowerCase() === "true"

/** All gates default closed and are intentionally server-only (no NEXT_PUBLIC names). */
export function readShift4FeatureFlags(env: Readonly<Record<string, string | undefined>> = process.env): Shift4FeatureFlags {
  return Object.freeze({
    restApi: enabled(env.SHIFT4_REST_ENABLED),
    ecommerce: enabled(env.SHIFT4_ECOMMERCE_ENABLED),
    retail: enabled(env.SHIFT4_RETAIL_ENABLED),
    certificationMode: enabled(env.SHIFT4_CERTIFICATION_MODE),
    manualAuthorization: enabled(env.SHIFT4_MANUAL_AUTH_ENABLED),
    partialApproval: enabled(env.SHIFT4_PARTIAL_APPROVAL_ENABLED),
    splitTender: enabled(env.SHIFT4_SPLIT_TENDER_ENABLED),
    applePay: enabled(env.SHIFT4_APPLE_PAY_ENABLED),
    googlePay: enabled(env.SHIFT4_GOOGLE_PAY_ENABLED),
    production: enabled(env.SHIFT4_PRODUCTION_ENABLED),
    onboardingRequired: enabled(env.SHIFT4_ONBOARDING_REQUIRED),
    commerceEngineConfigured: enabled(env.SHIFT4_COMMERCE_ENGINE_CONFIGURED),
  })
}

const view = (state: Shift4CapabilityState, ready: boolean, reason: string): Shift4CapabilityView =>
  Object.freeze({ state, ready, reason })

export async function resolveShift4Readiness(
  merchantId: string,
  deps: {
    getConnection?: (merchantId: string) => Promise<Shift4RestConnectionStatusView | null>
    listReaders?: (merchantId: string, provider: string) => Promise<MerchantTerminalReader[]>
    flags?: Shift4FeatureFlags
    getOnboarding?: (merchantId: string) => Promise<Shift4OnboardingSessionRow | null>
    i4goConfigured?: boolean
  } = {}
): Promise<Shift4Readiness> {
  const flags = deps.flags ?? readShift4FeatureFlags()
  const getConnection = deps.getConnection ?? getShift4RestConnectionStatus
  const listReaders = deps.listReaders ?? listMerchantTerminalReaders
  const connection = await getConnection(merchantId)
  const onboarding = await (deps.getOnboarding ?? getLatestShift4OnboardingSession)(merchantId).catch(() => null)
  const onboardingReadiness = projectShift4OnboardingReadiness(onboarding, flags.onboardingRequired)
  const i4goConfigured = deps.i4goConfigured ?? getShift4I4GoBrowserConfig().configured
  const readers = flags.retail ? await listReaders(merchantId, "shift4") : []
  const authenticated = Boolean(connection?.connected && connection.accessTokenPresent)
  const certified = Boolean(connection?.cardProcessingVerified)
  const testEnvironment = connection?.environment === "test"
  const productionAllowed = connection?.environment === "production" ? flags.production : testEnvironment
  const base = flags.restApi && authenticated
  const certifiedBase = base && certified && productionAllowed && !onboardingReadiness.blocksProduction
  const activeTerminal = readers.some((reader) =>
    ["online", "active", "connected", "ready"].includes(String(reader.status).toLowerCase())
  )

  /**
   * Whether that channel can actually authenticate.
   *
   * A credential is per-channel, so an E-commerce token must not make Retail
   * look ready. A legacy pre-channel credential still counts: the Engine
   * resolves it through the documented compatibility path.
   */
  const channelAuthenticated = (channel: "retail" | "ecommerce"): boolean =>
    Boolean(
      connection?.channels?.[channel]?.accessTokenPresent ||
      connection?.legacySharedCredentialPresent
    )

  const gated = (flag: boolean, label: string, extra = true): Shift4CapabilityView => {
    if (!flags.restApi) return view("disabled", false, "SHIFT4_REST_ENABLED is off")
    if (!authenticated) return view(connection ? "configured" : "not_configured", false, "Merchant authentication is required")
    if (!flag) return view("disabled", false, `${label} feature gate is off`)
    if (!extra) return view("blocked", false, `${label} prerequisites are incomplete`)
    if (!certified) return view("certification_required", false, "Shift4 certification is not verified")
    if (!productionAllowed) return view("blocked", false, "Production processing is not explicitly enabled")
    return view("enabled", true, `${label} is enabled`)
  }

  const capabilities: Record<Shift4Capability, Shift4CapabilityView> = {
    rest_api: flags.restApi
      ? view(authenticated ? "authenticated" : "configured", authenticated, authenticated ? "REST credential is authenticated" : "REST authentication is incomplete")
      : view("disabled", false, "SHIFT4_REST_ENABLED is off"),
    merchant_authentication: authenticated
      ? view("authenticated", true, "Encrypted merchant credential is present")
      : view(connection ? "configured" : "not_configured", false, "No authenticated merchant credential"),
    merchant_onboarding: onboardingReadiness.blocksProduction
      ? view(onboarding ? "configured" : "not_configured", false, onboardingReadiness.reason)
      : view(onboardingReadiness.approved ? "enabled" : "capable", true, onboardingReadiness.reason),
    ecommerce: gated(flags.ecommerce, "E-commerce", channelAuthenticated("ecommerce") && !onboardingReadiness.blocksProduction),
    retail: gated(flags.retail, "Retail", channelAuthenticated("retail") && activeTerminal && flags.commerceEngineConfigured && !onboardingReadiness.blocksProduction),
    tokenization: gated(flags.ecommerce, "i4Go tokenization", channelAuthenticated("ecommerce") && i4goConfigured && !onboardingReadiness.blocksProduction),
    hosted_checkout: gated(flags.ecommerce, "Hosted checkout", channelAuthenticated("ecommerce") && i4goConfigured && !onboardingReadiness.blocksProduction),
    manual_authorization: gated(flags.manualAuthorization && flags.certificationMode, "Manual authorization"),
    partial_approval: gated(flags.partialApproval && flags.retail, "Partial approval"),
    split_tender: gated(flags.splitTender, "Split tender"),
    apple_pay: gated(flags.applePay && flags.ecommerce, "Apple Pay"),
    google_pay: gated(flags.googlePay && flags.ecommerce, "Google Pay"),
    terminal: activeTerminal
      ? view(certifiedBase && flags.retail ? "enabled" : "capable", certifiedBase && flags.retail, "A Shift4 terminal is registered and online")
      : view(readers.length ? "configured" : "not_configured", false, "No online Shift4 terminal"),
    certification: certified
      ? view("certified", true, "Certification evidence is recorded")
      : view(flags.certificationMode ? "certification_required" : "disabled", false, "Certification has not been verified"),
    production_processing: certifiedBase
      ? view("enabled", true, "Environment and certification gates permit processing")
      : view("blocked", false, "Authentication, certification, and environment gates must all pass"),
  }

  return Object.freeze({
    connectionId: connection?.connectionId ?? null,
    environment: connection?.environment ?? null,
    authenticated,
    processingEnabled: capabilities.production_processing.ready,
    capabilities: Object.freeze(capabilities),
    flags,
  })
}

export class Shift4ReadinessError extends Error {
  readonly status = 503
  readonly code = "shift4_not_ready"
  constructor(readonly capability: Shift4Capability, reason: string) {
    super(`Shift4 capability ${capability} is not ready: ${reason}`)
    this.name = "Shift4ReadinessError"
  }
}

export function capabilityForOperation(operation: Shift4EngineOperation, channel: Shift4Channel): Shift4Capability {
  if (channel === "retail") return "retail"
  if (operation === "authorization") return "ecommerce"
  return "ecommerce"
}

export function assertShift4Capability(readiness: Shift4Readiness, capability: Shift4Capability): void {
  const status = readiness.capabilities[capability]
  if (!status.ready) throw new Shift4ReadinessError(capability, status.reason)
}
