/**
 * Shift4 Payment Platform REST API - server-only configuration.
 *
 * SCOPE: this directory implements the Shift4 Payment Platform REST API
 * (`/api/rest/v1`, AccessToken header auth, invoice-based transactions,
 * i4Go tokenization, Commerce Engine for Cloud). It is a DIFFERENT upstream
 * product from the pre-existing `providers/shift4/client.ts`, which talks to
 * the Shift4 e-commerce API at api.shift4.com using HTTP Basic auth with a
 * secret key and `/checkout-sessions`. Both are retained deliberately; they
 * are not duplicate clients for the same API. New Shift4 work belongs here.
 *
 * Documented environment URLs (Quick Start -> URLs):
 *   Test:       https://api.shift4test.com/api/rest/v1
 *   Production: https://api.shift4api.net/api/rest/v1
 * Host Direct and Commerce Engine For Cloud share these URLs.
 *
 * SECURITY: server-only. Nothing here may be read through NEXT_PUBLIC_*, and
 * no credential value is ever hardcoded, defaulted, or logged.
 */

export const SHIFT4_REST_TEST_BASE_URL = "https://api.shift4test.com/api/rest/v1"
export const SHIFT4_REST_PRODUCTION_BASE_URL = "https://api.shift4api.net/api/rest/v1"

export type Shift4RestEnvironment = "test" | "production"

/**
 * Which Shift4 integration method a request is routed through. Both supported
 * values resolve to the same documented host; the distinction is recorded so
 * Commerce Engine For Cloud request bodies and device-entry timeouts can be
 * selected correctly in later phases.
 */
export type Shift4IntegrationMethod = "host_direct" | "commerce_engine_cloud"

/**
 * Static identity Shift4 requires on every request. Values are supplied by
 * Shift4 and injected through the deployment environment - never committed.
 *
 * Per the Access Token Exchange schema these are request HEADERS, not body
 * fields, and each has a documented maximum length:
 *   InterfaceVersion max 11, InterfaceName max 25, CompanyName max 26.
 */
export type Shift4InterfaceIdentity = {
  interfaceName: string
  interfaceVersion: string
  companyName: string
}

export type Shift4RestConfig = {
  environment: Shift4RestEnvironment
  baseUrl: string
  integrationMethod: Shift4IntegrationMethod
  identity: Shift4InterfaceIdentity
}

/**
 * Documented per-field maximum lengths from the official request schemas.
 * Exported so validation and tests share one source of truth.
 */
export const SHIFT4_FIELD_LIMITS = {
  interfaceVersion: 11,
  interfaceName: 25,
  companyName: 26,
  clientGuid: 51,
  authToken: 51,
  accessToken: 52,
  invoice: 10,
} as const

/**
 * Characters the documentation explicitly disallows in InterfaceVersion,
 * InterfaceName, and CompanyName. The InterfaceName/CompanyName descriptions
 * additionally list a backtick; it is included for all three because sending
 * one is never required and rejecting it cannot break a valid value.
 *
 * Disallowed: $ % : ^ - ~ ` < > , ? " " ' ' { } [ ] \ + =
 */
const DISALLOWED_IDENTITY_CHARACTERS = [
  "$", "%", ":", "^", "-", "~", "`", "<", ">", ",", "?",
  "\"", "“", "”", "'", "‘", "’",
  "{", "}", "[", "]", "\\", "+", "=",
]

export class Shift4ConfigError extends Error {
  readonly missing: string[]

  constructor(message: string, missing: string[] = []) {
    super(message)
    this.name = "Shift4ConfigError"
    this.missing = missing
  }
}

function readEnv(name: string): string {
  return String(process.env[name] || "").trim()
}

export function resolveShift4Environment(raw?: string): Shift4RestEnvironment {
  const value = String(raw ?? readEnv("SHIFT4_REST_ENVIRONMENT")).trim().toLowerCase()
  // Only the two documented environments are accepted. There is deliberately
  // no silent production default: an unset or unrecognized value must fail
  // closed rather than aim live traffic at either host by accident.
  if (value === "test" || value === "certification") return "test"
  if (value === "production" || value === "live") return "production"
  throw new Shift4ConfigError(
    "SHIFT4_REST_ENVIRONMENT must be exactly \"test\" or \"production\".",
    ["SHIFT4_REST_ENVIRONMENT"]
  )
}

export function shift4BaseUrlForEnvironment(environment: Shift4RestEnvironment): string {
  return environment === "production"
    ? SHIFT4_REST_PRODUCTION_BASE_URL
    : SHIFT4_REST_TEST_BASE_URL
}

function resolveIntegrationMethod(raw?: string): Shift4IntegrationMethod {
  const value = String(raw ?? readEnv("SHIFT4_REST_INTEGRATION_METHOD")).trim().toLowerCase()
  if (!value || value === "host_direct") return "host_direct"
  if (value === "commerce_engine_cloud") return "commerce_engine_cloud"
  throw new Shift4ConfigError(
    "SHIFT4_REST_INTEGRATION_METHOD must be \"host_direct\" or \"commerce_engine_cloud\".",
    ["SHIFT4_REST_INTEGRATION_METHOD"]
  )
}

function validateIdentityField(
  label: string,
  value: string,
  maxLength: number,
  missing: string[],
  envName: string
): void {
  if (!value) {
    missing.push(envName)
    return
  }
  if (value.length > maxLength) {
    throw new Shift4ConfigError(
      `${envName} exceeds the Shift4 maximum length for ${label} (${maxLength} characters).`
    )
  }
  const offending = DISALLOWED_IDENTITY_CHARACTERS.filter((character) => value.includes(character))
  if (offending.length > 0) {
    // The rejected characters are echoed, never the configured value itself.
    throw new Shift4ConfigError(
      `${envName} contains characters Shift4 does not allow in ${label}: ${offending.join(" ")}`
    )
  }
}

/**
 * Resolve and validate the Shift4 REST configuration.
 *
 * Throws Shift4ConfigError when the deployment is not configured, so a
 * misconfigured environment fails closed instead of sending a request that
 * Shift4 would reject.
 */
export function getShift4RestConfig(overrides: Partial<Shift4RestConfig> = {}): Shift4RestConfig {
  if (overrides.baseUrl && !overrides.environment) {
    throw new Shift4ConfigError(
      "A Shift4 baseUrl override requires an explicit environment so test and production cannot be confused."
    )
  }

  const environment = overrides.environment ?? resolveShift4Environment()
  const integrationMethod = overrides.integrationMethod ?? resolveIntegrationMethod()

  const missing: string[] = []
  const identity: Shift4InterfaceIdentity = overrides.identity ?? {
    interfaceName: readEnv("SHIFT4_INTERFACE_NAME"),
    interfaceVersion: readEnv("SHIFT4_INTERFACE_VERSION"),
    companyName: readEnv("SHIFT4_COMPANY_NAME"),
  }

  validateIdentityField(
    "InterfaceName", identity.interfaceName, SHIFT4_FIELD_LIMITS.interfaceName,
    missing, "SHIFT4_INTERFACE_NAME"
  )
  validateIdentityField(
    "InterfaceVersion", identity.interfaceVersion, SHIFT4_FIELD_LIMITS.interfaceVersion,
    missing, "SHIFT4_INTERFACE_VERSION"
  )
  validateIdentityField(
    "CompanyName", identity.companyName, SHIFT4_FIELD_LIMITS.companyName,
    missing, "SHIFT4_COMPANY_NAME"
  )

  if (missing.length > 0) {
    throw new Shift4ConfigError(
      `Shift4 REST interface identity is not configured. Missing: ${missing.join(", ")}.`,
      missing
    )
  }

  return {
    environment,
    baseUrl: overrides.baseUrl ?? shift4BaseUrlForEnvironment(environment),
    integrationMethod,
    identity,
  }
}

/**
 * The certified PineTree Client GUID.
 *
 * Shift4 documents that the Client GUID "must be hard coded into your
 * application ... and must not be a configurable field" because it permanently
 * identifies the interface. PineTree's own security standard forbids committing
 * any supplied credential value to source. Those two rules are reconciled here
 * by reading a server-only deployment variable that no UI, API response, or
 * merchant-facing setting can influence - so the value is not merchant- or
 * user-configurable in the sense Shift4 is guarding against, while still never
 * appearing in the repository. This reconciliation is flagged for Shift4
 * confirmation and is intentionally the only place the GUID is read.
 */
export function getShift4ClientGuid(): string {
  const value = readEnv("SHIFT4_CLIENT_GUID")
  if (!value) {
    throw new Shift4ConfigError(
      "SHIFT4_CLIENT_GUID is not configured. Shift4 supplies the certified Client GUID for the PineTree interface.",
      ["SHIFT4_CLIENT_GUID"]
    )
  }
  assertOpaqueCredential(value, SHIFT4_FIELD_LIMITS.clientGuid, "SHIFT4_CLIENT_GUID")
  return value
}

/**
 * Shape check for the opaque credential strings (Client GUID, Auth Token,
 * Access Token). Shift4's examples are not RFC-4122 UUIDs - the documented
 * Auth Token example is 8-4-4-16 hex - so no UUID pattern is enforced. Only
 * the documented maximum length plus the absence of whitespace and control
 * characters is checked, and the value is never included in the error.
 */
export function assertOpaqueCredential(value: string, maxLength: number, label: string): void {
  if (!value) {
    throw new Shift4ConfigError(`${label} is empty.`)
  }
  if (value.length > maxLength) {
    throw new Shift4ConfigError(`${label} exceeds the documented maximum length of ${maxLength} characters.`)
  }
  // Whitespace and control characters would corrupt an HTTP header value.
  // Hyphens stay allowed - every documented credential example contains them.
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 0x20 || codePoint === 0x7f) {
      throw new Shift4ConfigError(`${label} contains whitespace or control characters.`)
    }
  }
}

/**
 * Non-secret configuration summary safe for diagnostics and admin surfaces.
 * Reports only whether credentials are present, never any value or length.
 */
export function describeShift4RestConfiguration(): {
  configured: boolean
  environment: Shift4RestEnvironment | null
  baseUrl: string | null
  integrationMethod: Shift4IntegrationMethod | null
  clientGuidConfigured: boolean
  interfaceIdentityConfigured: boolean
  credentialEncryptionKeyConfigured: boolean
  missing: string[]
} {
  const missing: string[] = []
  let environment: Shift4RestEnvironment | null = null
  let baseUrl: string | null = null
  let integrationMethod: Shift4IntegrationMethod | null = null
  let interfaceIdentityConfigured = false

  try {
    const config = getShift4RestConfig()
    environment = config.environment
    baseUrl = config.baseUrl
    integrationMethod = config.integrationMethod
    interfaceIdentityConfigured = true
  } catch (error) {
    if (error instanceof Shift4ConfigError && error.missing.length > 0) {
      missing.push(...error.missing)
    } else if (error instanceof Shift4ConfigError) {
      missing.push("SHIFT4_REST_CONFIGURATION_INVALID")
    } else {
      throw error
    }
  }

  let clientGuidConfigured = false
  try {
    getShift4ClientGuid()
    clientGuidConfigured = true
  } catch {
    missing.push("SHIFT4_CLIENT_GUID")
  }

  const credentialEncryptionKeyConfigured = readEnv("SHIFT4_CREDENTIAL_ENCRYPTION_KEY").length === 64
  if (!credentialEncryptionKeyConfigured) missing.push("SHIFT4_CREDENTIAL_ENCRYPTION_KEY")

  return {
    configured: missing.length === 0,
    environment,
    baseUrl,
    integrationMethod,
    clientGuidConfigured,
    interfaceIdentityConfigured,
    credentialEncryptionKeyConfigured,
    missing: Array.from(new Set(missing)),
  }
}
