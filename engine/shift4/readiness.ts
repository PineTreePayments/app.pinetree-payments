/** Central, server-derived Shift4 capability and feature-gate model. */
import { getShift4RestConnectionStatus, type Shift4RestConnectionStatusView } from "@/database/merchantShift4RestConnections"
import { listMerchantTerminalReaders, type MerchantTerminalReader } from "@/database/merchantTerminalReaders"
import { getLatestShift4OnboardingSession, type Shift4OnboardingSessionRow } from "@/database/shift4OnboardingSessions"
import { projectShift4OnboardingReadiness } from "./onboarding/readiness"
import {
  isShift4TerminalOnline,
  projectShift4TerminalReadiness,
  resolveShift4TerminalConnectivity,
  SHIFT4_TERMINAL_CONNECTIVITY_UNVERIFIED,
  type Shift4TerminalConnectivityEvidence,
} from "./terminalReadiness"
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
  /**
   * Terminal-only. Both require evidence from a documented provider status
   * operation; neither may be inferred from PineTree's own stored configuration.
   */
  | "online"
  | "offline"

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
    /**
     * Live terminal connectivity evidence. Defaults to the honest resolver,
     * which returns "unverified" and contacts nothing, because no documented
     * Shift4 terminal-status operation exists. Injectable so the projector's
     * online/offline branches stay directly testable.
     */
    getTerminalConnectivity?: (merchantId: string) => Promise<Shift4TerminalConnectivityEvidence>
  } = {}
): Promise<Shift4Readiness> {
  const flags = deps.flags ?? readShift4FeatureFlags()
  const getConnection = deps.getConnection ?? getShift4RestConnectionStatus
  const listReaders = deps.listReaders ?? listMerchantTerminalReaders
  const connection = await getConnection(merchantId)
  const onboarding = await (deps.getOnboarding ?? getLatestShift4OnboardingSession)(merchantId).catch(() => null)
  const onboardingReadiness = projectShift4OnboardingReadiness(onboarding, flags.onboardingRequired)
  const i4goConfigured = deps.i4goConfigured ?? getShift4I4GoBrowserConfig().configured

  /**
   * Terminal rows are read UNCONDITIONALLY.
   *
   * They used to be read only when the Retail gate was on, which made a
   * configured terminal indistinguishable from no terminal at all: both
   * projected "not configured" while the gate was off, so an operator could
   * never see that their configuration had been saved. Reading always lets
   * "disabled" (configured, gate off) and "not_configured" (nothing stored)
   * be told apart.
   *
   * A read failure is captured rather than thrown: readiness is consumed by
   * operator surfaces that must still render, and an unreadable table is
   * reported as its own state instead of being flattened into "not configured".
   */
  let readers: MerchantTerminalReader[] = []
  let terminalConfigurationAvailable = true
  try {
    readers = await listReaders(merchantId, "shift4")
  } catch {
    terminalConfigurationAvailable = false
  }
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

  /**
   * Terminal connectivity comes from EVIDENCE, never from the row.
   *
   * The previous implementation read `merchant_terminal_readers.status` and
   * treated "online"/"active"/"connected"/"ready" as proof the device was live.
   * That column is written by PineTree itself — the PAX adapter stores "ready"
   * for a simulated device — so a locally created record could report a Shift4
   * terminal as online without Shift4 ever being contacted.
   */
  const terminalConnectivity = terminalConfigurationAvailable && readers.length > 0
    ? await (deps.getTerminalConnectivity ?? resolveShift4TerminalConnectivity)(merchantId)
    : SHIFT4_TERMINAL_CONNECTIVITY_UNVERIFIED
  const terminalOnline = isShift4TerminalOnline(terminalConnectivity)

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

  /** A channel is named by its channel, never by the capability riding on it. */
  const CHANNEL_LABELS: Record<Shift4Channel, string> = {
    retail: "Retail",
    ecommerce: "E-commerce",
  }

  /**
   * Project one capability.
   *
   * Order matters and is deliberate:
   *
   *   1. the REST gate
   *   2. AUTHENTICATION for this capability's channel
   *   3. CONFIGURATION completeness   <- deployment configuration this
   *                                      capability cannot work without
   *   4. the feature gate
   *   5. remaining runtime prerequisites
   *   6. certification
   *   7. production permission
   *
   * Each step has its own state and reason, so a surface never has to guess
   * which one is blocking.
   *
   * Steps 2 and 3 both report `not_configured`, and both sit ABOVE the feature
   * gate. That ordering is the fix for the misleading labels: a capability whose
   * credential or configuration is absent must say "Not configured", never
   * "Configured" and never "Disabled" — "Disabled" claims everything is in place
   * except the switch.
   *
   * The distinction between step 3 (configuration) and step 5 (prerequisite) is
   * deliberate: configuration is deployment state that must exist before the
   * capability can honestly be called configured at all, while a prerequisite is
   * a runtime condition — a device, an onboarding approval — that a fully
   * configured capability can still be waiting on.
   */
  const gated = (
    flag: boolean,
    label: string,
    options: {
      /**
       * Scopes the authentication check. Omitted for capabilities that are not
       * channel-specific, which then use the aggregate.
       */
      channel?: Shift4Channel
      configuration?: { complete: boolean; reason: string }
      prerequisite?: { met: boolean; reason?: string }
    } = {}
  ): Shift4CapabilityView => {
    if (!flags.restApi) return view("disabled", false, "SHIFT4_REST_ENABLED is off")

    const { channel, configuration, prerequisite } = options
    const channelAuth = channel ? channelAuthenticated(channel) : authenticated
    if (!channelAuth) {
      if (channel) {
        /**
         * A per-channel credential is missing, so THIS capability is not
         * configured — whatever exists for the other channel.
         *
         * This previously reported "configured" whenever ANY credential row
         * existed, which is what made E-commerce, Apple Pay and Google Pay read
         * "Configured" on an account holding only a Retail credential, directly
         * contradicting their own descriptions. A row is not a credential for a
         * channel: Shift4 scopes an access token to one interface.
         */
        return view(
          "not_configured",
          false,
          `No ${CHANNEL_LABELS[channel]} credential is connected for this merchant`
        )
      }
      // Aggregate capabilities keep the row-level distinction: a cleared row
      // still represents a configured, currently unusable connection.
      return view(
        connection ? "configured" : "not_configured",
        false,
        "Merchant authentication is required"
      )
    }

    if (configuration && !configuration.complete) {
      return view("not_configured", false, configuration.reason)
    }

    if (!flag) return view("disabled", false, `${label} feature gate is off`)
    if (prerequisite && !prerequisite.met) {
      return view("blocked", false, prerequisite.reason ?? `${label} prerequisites are incomplete`)
    }
    if (!certified) return view("certification_required", false, "Shift4 certification is not verified")
    if (!productionAllowed) return view("blocked", false, "Production processing is not explicitly enabled")
    return view("enabled", true, `${label} is enabled`)
  }

  /**
   * i4Go is CONFIGURATION, not a runtime prerequisite: PineTree never handles a
   * card number, so every E-commerce capability — the channel itself, hosted
   * checkout, tokenization, and both wallets — is structurally impossible
   * without it. Shared by all of them so the requirement is stated once.
   */
  const i4goConfiguration = (label: string) => ({
    complete: i4goConfigured,
    reason: `${label} requires the Shift4 i4Go tokenization configuration`,
  })

  /** Onboarding is a runtime approval, so it blocks rather than un-configures. */
  const onboardingPrerequisite = {
    met: !onboardingReadiness.blocksProduction,
    reason: onboardingReadiness.reason,
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
    ecommerce: gated(flags.ecommerce, "E-commerce", {
      channel: "ecommerce",
      configuration: i4goConfiguration("E-commerce"),
      prerequisite: onboardingPrerequisite,
    }),
    retail: gated(flags.retail, "Retail", {
      channel: "retail",
      prerequisite: {
        met: terminalOnline && flags.commerceEngineConfigured && !onboardingReadiness.blocksProduction,
        // Names the terminal explicitly, because with no documented status
        // operation this is the prerequisite that cannot currently be met.
        reason: !terminalOnline
          ? "Retail requires a Shift4 terminal with verified provider connectivity"
          : !flags.commerceEngineConfigured
            ? "Retail requires Commerce Engine configuration"
            : onboardingReadiness.reason,
      },
    }),
    tokenization: gated(flags.ecommerce, "i4Go tokenization", {
      channel: "ecommerce",
      configuration: i4goConfiguration("i4Go tokenization"),
      prerequisite: onboardingPrerequisite,
    }),
    hosted_checkout: gated(flags.ecommerce, "Hosted checkout", {
      channel: "ecommerce",
      configuration: i4goConfiguration("Hosted checkout"),
      prerequisite: onboardingPrerequisite,
    }),
    manual_authorization: gated(flags.manualAuthorization && flags.certificationMode, "Manual authorization"),
    partial_approval: gated(flags.partialApproval && flags.retail, "Partial approval"),
    split_tender: gated(flags.splitTender, "Split tender"),
    // Both wallets ride on the E-commerce channel through i4Go; that credential
    // plus that configuration IS their required configuration. Neither may
    // report "Configured" merely because its own flag happens to be off.
    apple_pay: gated(flags.applePay && flags.ecommerce, "Apple Pay", {
      channel: "ecommerce",
      configuration: i4goConfiguration("Apple Pay"),
    }),
    google_pay: gated(flags.googlePay && flags.ecommerce, "Google Pay", {
      channel: "ecommerce",
      configuration: i4goConfiguration("Google Pay"),
    }),
    terminal: projectShift4TerminalReadiness({
      configuredCount: readers.length,
      configurationAvailable: terminalConfigurationAvailable,
      restApiEnabled: flags.restApi,
      retailEnabled: flags.retail,
      connectivity: terminalConnectivity,
      certified,
      productionAllowed: productionAllowed && !onboardingReadiness.blocksProduction,
    }),
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
