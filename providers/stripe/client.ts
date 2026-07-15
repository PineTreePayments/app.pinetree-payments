import {
  STRIPE_API_BASE_URL,
  STRIPE_PAYMENT_INTENTS_PATH,
  STRIPE_ACCOUNTS_PATH,
  STRIPE_ACCOUNT_LINKS_PATH
} from "./constants"
import type {
  StripePaymentIntent,
  StripePaymentIntentRequest
} from "./types"

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

  if (typeof value === "object" && !Array.isArray(value)) {
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

  async retrievePaymentIntent(providerReference: string): Promise<StripePaymentIntent> {
    const response = await this.fetchImpl(
      `${STRIPE_API_BASE_URL}${STRIPE_PAYMENT_INTENTS_PATH}/${encodeURIComponent(providerReference)}`,
      {
        method: "GET",
        headers: this.headers()
      }
    )

    return parseStripeResponse(response)
  }

  async createConnectedAccount(params?: { type?: string }): Promise<{ id: string; details_submitted: boolean; charges_enabled: boolean; payouts_enabled: boolean }> {
    const response = await this.fetchImpl(`${STRIPE_API_BASE_URL}${STRIPE_ACCOUNTS_PATH}`, {
      method: "POST",
      headers: this.headers(),
      body: encodeStripeFormBody({ type: params?.type ?? "express" })
    })
    const data = await parseStripeJsonResponse<{ id?: string; details_submitted?: boolean; charges_enabled?: boolean; payouts_enabled?: boolean }>(response)
    if (!data.id) throw new Error("Stripe account response missing id")
    return {
      id: data.id,
      details_submitted: Boolean(data.details_submitted),
      charges_enabled: Boolean(data.charges_enabled),
      payouts_enabled: Boolean(data.payouts_enabled)
    }
  }

  async retrieveConnectedAccount(accountId: string): Promise<{ id: string; details_submitted: boolean; charges_enabled: boolean; payouts_enabled: boolean }> {
    const response = await this.fetchImpl(
      `${STRIPE_API_BASE_URL}${STRIPE_ACCOUNTS_PATH}/${encodeURIComponent(accountId)}`,
      { method: "GET", headers: this.headers() }
    )
    const data = await parseStripeJsonResponse<{ id?: string; details_submitted?: boolean; charges_enabled?: boolean; payouts_enabled?: boolean }>(response)
    if (!data.id) throw new Error("Stripe account response missing id")
    return {
      id: data.id,
      details_submitted: Boolean(data.details_submitted),
      charges_enabled: Boolean(data.charges_enabled),
      payouts_enabled: Boolean(data.payouts_enabled)
    }
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

async function parseStripeJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.text()
  const parsed = (body ? JSON.parse(body) : {}) as T & { error?: { message?: string } }
  if (!response.ok) {
    const err = (parsed as { error?: { message?: string } }).error
    throw new Error(err?.message || `Stripe API request failed with status ${response.status}`)
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
