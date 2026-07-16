import {
  STRIPE_API_BASE_URL,
  STRIPE_PAYMENT_INTENTS_PATH,
  STRIPE_ACCOUNTS_PATH,
  STRIPE_ACCOUNT_LINKS_PATH,
  STRIPE_ACCOUNT_SESSIONS_PATH,
  STRIPE_TERMINAL_LOCATIONS_PATH,
  STRIPE_TERMINAL_READERS_PATH,
  STRIPE_TERMINAL_CONNECTION_TOKENS_PATH,
  STRIPE_TEST_HELPERS_TERMINAL_READERS_PATH
} from "./constants"
import type {
  StripePaymentIntent,
  StripePaymentIntentRequest
} from "./types"

/**
 * Raw Stripe Account response fields consumed by PineTree. Field names are
 * validated against the installed `stripe` SDK types (stripe@22,
 * resources/Accounts.d.ts) — do not invent fields that are not in the SDK.
 */
export type StripeRawAccount = {
  id?: string
  details_submitted?: boolean
  charges_enabled?: boolean
  payouts_enabled?: boolean
  requirements?: {
    currently_due?: string[] | null
    eventually_due?: string[] | null
    past_due?: string[] | null
    pending_verification?: string[] | null
    disabled_reason?: string | null
  } | null
  capabilities?: Record<string, string> | null
  metadata?: Record<string, string> | null
}

/**
 * Connected-account creation body. Mirrors the installed Stripe SDK's
 * AccountCreateParams controller model (stripe@22): the platform controls
 * the account, the merchant has no Stripe-hosted dashboard, and Stripe
 * collects onboarding requirements (embedded onboarding).
 */
export type StripeAccountCreateBody = {
  controller?: {
    fees?: { payer: "account" | "application" }
    losses?: { payments: "application" | "stripe" }
    requirement_collection?: "application" | "stripe"
    stripe_dashboard?: { type: "express" | "full" | "none" }
  }
  capabilities?: Record<string, { requested: boolean }>
  country?: string
  metadata?: Record<string, string>
}

type StripeClientOptions = {
  secretKey?: string
  apiVersion?: string
  fetchImpl?: typeof fetch
}

function getConfiguredSecretKey(explicitSecretKey?: string): string {
  const secretKey = String(explicitSecretKey || process.env.STRIPE_SECRET_KEY || "").trim()
  if (!secretKey) {
    throw new Error("Stripe secret key not configured")
  }
  return secretKey
}

function encodeFormValue(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return

  if (Array.isArray(value)) {
    value.forEach((item, index) => encodeFormValue(params, `${key}[${index}]`, item))
    return
  }

  if (typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      encodeFormValue(params, `${key}[${childKey}]`, childValue)
    }
    return
  }

  params.set(key, String(value))
}

export function encodeStripeFormBody(input: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) {
    encodeFormValue(params, key, value)
  }
  return params
}

export class StripeClient {
  private readonly secretKey: string
  private readonly apiVersion?: string
  private readonly fetchImpl: typeof fetch

  constructor(options: StripeClientOptions = {}) {
    this.secretKey = getConfiguredSecretKey(options.secretKey)
    this.apiVersion = String(options.apiVersion || process.env.STRIPE_API_VERSION || "").trim() || undefined
    this.fetchImpl = options.fetchImpl || fetch
  }

  private headers(idempotencyKey?: string, connectedAccountId?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    }

    if (this.apiVersion) headers["Stripe-Version"] = this.apiVersion
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey
    if (connectedAccountId) headers["Stripe-Account"] = connectedAccountId

    return headers
  }

  async createPaymentIntent(
    request: StripePaymentIntentRequest,
    idempotencyKey?: string,
    connectedAccountId?: string
  ): Promise<StripePaymentIntent> {
    const response = await this.fetchImpl(`${STRIPE_API_BASE_URL}${STRIPE_PAYMENT_INTENTS_PATH}`, {
      method: "POST",
      headers: this.headers(idempotencyKey, connectedAccountId),
      body: encodeStripeFormBody(request as unknown as Record<string, unknown>)
    })

    return parseStripeResponse(response)
  }

  async retrievePaymentIntent(providerReference: string, connectedAccountId?: string): Promise<StripePaymentIntent> {
    const response = await this.fetchImpl(
      `${STRIPE_API_BASE_URL}${STRIPE_PAYMENT_INTENTS_PATH}/${encodeURIComponent(providerReference)}`,
      {
        method: "GET",
        headers: this.headers(undefined, connectedAccountId)
      }
    )

    return parseStripeResponse(response)
  }

  /**
   * Creates a PaymentIntent from an explicit body (used for card_present
   * Terminal payments and manual card entry, where the request shape differs
   * from the automatic-payment-methods online flow above).
   */
  async createPaymentIntentFromBody(
    body: Record<string, unknown>,
    idempotencyKey?: string,
    connectedAccountId?: string
  ): Promise<StripePaymentIntent> {
    const response = await this.fetchImpl(`${STRIPE_API_BASE_URL}${STRIPE_PAYMENT_INTENTS_PATH}`, {
      method: "POST",
      headers: this.headers(idempotencyKey, connectedAccountId),
      body: encodeStripeFormBody(body)
    })

    return parseStripeResponse(response)
  }

  async cancelPaymentIntent(providerReference: string, connectedAccountId?: string): Promise<StripePaymentIntent> {
    const response = await this.fetchImpl(
      `${STRIPE_API_BASE_URL}${STRIPE_PAYMENT_INTENTS_PATH}/${encodeURIComponent(providerReference)}/cancel`,
      {
        method: "POST",
        headers: this.headers(undefined, connectedAccountId)
      }
    )

    return parseStripeResponse(response)
  }

  // ── Stripe Terminal (server-driven) ───────────────────────────────────────

  async createTerminalLocation(
    body: Record<string, unknown>,
    connectedAccountId?: string
  ): Promise<Record<string, unknown> & { id: string }> {
    const response = await this.fetchImpl(`${STRIPE_API_BASE_URL}${STRIPE_TERMINAL_LOCATIONS_PATH}`, {
      method: "POST",
      headers: this.headers(undefined, connectedAccountId),
      body: encodeStripeFormBody(body)
    })
    const data = await parseStripeJsonResponse<Record<string, unknown> & { id?: string }>(response)
    if (!data.id) throw new Error("Stripe terminal location response missing id")
    return data as Record<string, unknown> & { id: string }
  }

  async listTerminalLocations(
    connectedAccountId?: string
  ): Promise<{ data: Array<Record<string, unknown>> }> {
    const response = await this.fetchImpl(`${STRIPE_API_BASE_URL}${STRIPE_TERMINAL_LOCATIONS_PATH}?limit=100`, {
      method: "GET",
      headers: this.headers(undefined, connectedAccountId)
    })
    return parseStripeJsonResponse(response)
  }

  async createTerminalReader(
    body: Record<string, unknown>,
    connectedAccountId?: string
  ): Promise<Record<string, unknown> & { id: string }> {
    const response = await this.fetchImpl(`${STRIPE_API_BASE_URL}${STRIPE_TERMINAL_READERS_PATH}`, {
      method: "POST",
      headers: this.headers(undefined, connectedAccountId),
      body: encodeStripeFormBody(body)
    })
    const data = await parseStripeJsonResponse<Record<string, unknown> & { id?: string }>(response)
    if (!data.id) throw new Error("Stripe terminal reader response missing id")
    return data as Record<string, unknown> & { id: string }
  }

  async retrieveTerminalReader(
    readerId: string,
    connectedAccountId?: string
  ): Promise<Record<string, unknown> & { id: string }> {
    const response = await this.fetchImpl(
      `${STRIPE_API_BASE_URL}${STRIPE_TERMINAL_READERS_PATH}/${encodeURIComponent(readerId)}`,
      { method: "GET", headers: this.headers(undefined, connectedAccountId) }
    )
    const data = await parseStripeJsonResponse<Record<string, unknown> & { id?: string }>(response)
    if (!data.id) throw new Error("Stripe terminal reader response missing id")
    return data as Record<string, unknown> & { id: string }
  }

  async listTerminalReaders(
    connectedAccountId?: string
  ): Promise<{ data: Array<Record<string, unknown>> }> {
    const response = await this.fetchImpl(`${STRIPE_API_BASE_URL}${STRIPE_TERMINAL_READERS_PATH}?limit=100`, {
      method: "GET",
      headers: this.headers(undefined, connectedAccountId)
    })
    return parseStripeJsonResponse(response)
  }

  async processPaymentIntentOnReader(
    readerId: string,
    body: Record<string, unknown>,
    connectedAccountId?: string,
    idempotencyKey?: string
  ): Promise<Record<string, unknown> & { id: string }> {
    const response = await this.fetchImpl(
      `${STRIPE_API_BASE_URL}${STRIPE_TERMINAL_READERS_PATH}/${encodeURIComponent(readerId)}/process_payment_intent`,
      {
        method: "POST",
        headers: this.headers(idempotencyKey, connectedAccountId),
        body: encodeStripeFormBody(body)
      }
    )
    const data = await parseStripeJsonResponse<Record<string, unknown> & { id?: string }>(response)
    if (!data.id) throw new Error("Stripe reader action response missing id")
    return data as Record<string, unknown> & { id: string }
  }

  async cancelTerminalReaderAction(
    readerId: string,
    connectedAccountId?: string
  ): Promise<Record<string, unknown> & { id: string }> {
    const response = await this.fetchImpl(
      `${STRIPE_API_BASE_URL}${STRIPE_TERMINAL_READERS_PATH}/${encodeURIComponent(readerId)}/cancel_action`,
      { method: "POST", headers: this.headers(undefined, connectedAccountId) }
    )
    const data = await parseStripeJsonResponse<Record<string, unknown> & { id?: string }>(response)
    if (!data.id) throw new Error("Stripe reader action response missing id")
    return data as Record<string, unknown> & { id: string }
  }

  /**
   * Short-lived Terminal connection token for native SDK clients. The
   * returned secret must never be persisted or logged.
   */
  async createTerminalConnectionToken(
    body: Record<string, unknown>,
    connectedAccountId?: string
  ): Promise<{ secret: string }> {
    const response = await this.fetchImpl(`${STRIPE_API_BASE_URL}${STRIPE_TERMINAL_CONNECTION_TOKENS_PATH}`, {
      method: "POST",
      headers: this.headers(undefined, connectedAccountId),
      body: encodeStripeFormBody(body)
    })
    const data = await parseStripeJsonResponse<{ secret?: string }>(response)
    if (!data.secret) throw new Error("Stripe connection token response missing secret")
    return { secret: data.secret }
  }

  /** Test-mode helper: simulate a card presentation on a simulated reader. */
  async presentTerminalPaymentMethod(
    readerId: string,
    connectedAccountId?: string
  ): Promise<Record<string, unknown> & { id: string }> {
    const response = await this.fetchImpl(
      `${STRIPE_API_BASE_URL}${STRIPE_TEST_HELPERS_TERMINAL_READERS_PATH}/${encodeURIComponent(readerId)}/present_payment_method`,
      { method: "POST", headers: this.headers(undefined, connectedAccountId) }
    )
    const data = await parseStripeJsonResponse<Record<string, unknown> & { id?: string }>(response)
    if (!data.id) throw new Error("Stripe reader test helper response missing id")
    return data as Record<string, unknown> & { id: string }
  }

  async createConnectedAccount(body?: StripeAccountCreateBody): Promise<StripeRawAccount & { id: string }> {
    const response = await this.fetchImpl(`${STRIPE_API_BASE_URL}${STRIPE_ACCOUNTS_PATH}`, {
      method: "POST",
      headers: this.headers(),
      body: encodeStripeFormBody((body ?? {}) as Record<string, unknown>)
    })
    const data = await parseStripeJsonResponse<StripeRawAccount>(response)
    if (!data.id) throw new Error("Stripe account response missing id")
    return data as StripeRawAccount & { id: string }
  }

  async retrieveConnectedAccount(accountId: string): Promise<StripeRawAccount & { id: string }> {
    const response = await this.fetchImpl(
      `${STRIPE_API_BASE_URL}${STRIPE_ACCOUNTS_PATH}/${encodeURIComponent(accountId)}`,
      { method: "GET", headers: this.headers() }
    )
    const data = await parseStripeJsonResponse<StripeRawAccount>(response)
    if (!data.id) throw new Error("Stripe account response missing id")
    return data as StripeRawAccount & { id: string }
  }

  /**
   * Creates an embedded-components Account Session for a connected account.
   * The returned client secret is short-lived and must never be persisted
   * or logged.
   */
  async createAccountSession(params: {
    account: string
    components: Record<string, { enabled: boolean }>
  }): Promise<{ client_secret: string }> {
    const response = await this.fetchImpl(`${STRIPE_API_BASE_URL}${STRIPE_ACCOUNT_SESSIONS_PATH}`, {
      method: "POST",
      headers: this.headers(),
      body: encodeStripeFormBody(params as unknown as Record<string, unknown>)
    })
    const data = await parseStripeJsonResponse<{ client_secret?: string }>(response)
    if (!data.client_secret) throw new Error("Stripe account session response missing client secret")
    return { client_secret: data.client_secret }
  }

  async createAccountLink(params: {
    account: string
    return_url: string
    refresh_url: string
    type: string
  }): Promise<{ url: string }> {
    const response = await this.fetchImpl(`${STRIPE_API_BASE_URL}${STRIPE_ACCOUNT_LINKS_PATH}`, {
      method: "POST",
      headers: this.headers(),
      body: encodeStripeFormBody(params as Record<string, unknown>)
    })
    const data = await parseStripeJsonResponse<{ url?: string }>(response)
    if (!data.url) throw new Error("Stripe account link response missing url")
    return { url: data.url }
  }
}

/** Error thrown for non-2xx Stripe responses; carries the Stripe error code. */
export type StripeApiError = Error & { stripeCode?: string; stripeStatus?: number }

async function parseStripeJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.text()
  const parsed = (body ? JSON.parse(body) : {}) as T & { error?: { message?: string; code?: string } }
  if (!response.ok) {
    const err = (parsed as { error?: { message?: string; code?: string } }).error
    const apiError: StripeApiError = new Error(
      err?.message || `Stripe API request failed with status ${response.status}`
    )
    apiError.stripeCode = err?.code
    apiError.stripeStatus = response.status
    throw apiError
  }
  return parsed
}

async function parseStripeResponse(response: Response): Promise<StripePaymentIntent> {
  const body = await response.text()
  const parsed: Partial<StripePaymentIntent> & { error?: { message?: string } } = body
    ? JSON.parse(body) as StripePaymentIntent & { error?: { message?: string } }
    : {}

  if (!response.ok) {
    throw new Error(parsed.error?.message || `Stripe API request failed with status ${response.status}`)
  }

  if (!parsed.id) {
    throw new Error("Stripe PaymentIntent response missing id")
  }

  return parsed as StripePaymentIntent
}
