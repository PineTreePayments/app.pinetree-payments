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
  /**
   * Per-channel authentication. Shift4 scopes an access token to one merchant
   * account and interface, so the aggregate `authenticated` flag alone cannot
   * say whether THIS channel can authenticate. Exposed so a surface never has
   * to infer a channel's credential state from the aggregate.
   */
  authenticatedChannels: Readonly<Record<Shift4Channel, boolean>>
  /** True when a credential row exists at all, in any shape or channel. */
  credentialPresent: boolean
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
  /**
   * Authentication is decided by whether a USABLE encrypted credential is
   * stored, which is exactly what the Engine needs to call Shift4.
   *
   * It deliberately does not also require `connection.connected`. Clearing a
   * credential strips the ciphertext, so `accessTokenPresent` is already false
   * for a disconnected or revoked row; adding the status check on top only
   * created a failure mode where a perfectly good stored credential could
   * project as unauthenticated because of row-status drift.
   */
  const credentialPresent = Boolean(connection?.accessTokenPresent)
  const authenticated = credentialPresent
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

  /**
   * Project one capability.
   *
   * Order matters and is deliberate: the REST gate, then AUTHENTICATION for the
   * specific channel, then the feature gate, then remaining prerequisites, then
   * certification, then production permission. Each step has its own state and
   * reason so a surface never has to guess which one is blocking.
   *
   * `channel` scopes the authentication check. Without it the aggregate is used,
   * which is correct only for capabilities that are not channel-specific.
   */
  const gated = (
    flag: boolean,
    label: string,
    extra = true,
    channel?: Shift4Channel
  ): Shift4CapabilityView => {
    if (!flags.restApi) return view("disabled", false, "SHIFT4_REST_ENABLED is off")

    const channelAuth = channel ? channelAuthenticated(channel) : authenticated
    if (!channelAuth) {
      // "not_configured" is reserved for a merchant with NO stored credential.
      // Once a credential exists the state is "configured", even when this
      // particular channel is the one still missing.
      return view(
        connection ? "configured" : "not_configured",
        false,
        channel
          ? `No ${label} credential is connected for this merchant`
          : "Merchant authentication is required"
      )
    }

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
    // Channel-specific capabilities pass their channel so a missing credential
    // is reported as such instead of being flattened into "prerequisites are
    // incomplete" alongside terminal and configuration gates.
    ecommerce: gated(flags.ecommerce, "E-commerce", !onboardingReadiness.blocksProduction, "ecommerce"),
    retail: gated(flags.retail, "Retail", activeTerminal && flags.commerceEngineConfigured && !onboardingReadiness.blocksProduction, "retail"),
    tokenization: gated(flags.ecommerce, "i4Go tokenization", i4goConfigured && !onboardingReadiness.blocksProduction, "ecommerce"),
    hosted_checkout: gated(flags.ecommerce, "Hosted checkout", i4goConfigured && !onboardingReadiness.blocksProduction, "ecommerce"),
    manual_authorization: gated(flags.manualAuthorization && flags.certificationMode, "Manual authorization"),
    partial_approval: gated(flags.partialApproval && flags.retail, "Partial approval"),
    split_tender: gated(flags.splitTender, "Split tender"),
    apple_pay: gated(flags.applePay && flags.ecommerce, "Apple Pay", true, "ecommerce"),
    google_pay: gated(flags.googlePay && flags.ecommerce, "Google Pay", true, "ecommerce"),
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
    authenticatedChannels: Object.freeze({
      retail: channelAuthenticated("retail"),
      ecommerce: channelAuthenticated("ecommerce"),
    }),
    credentialPresent,
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
