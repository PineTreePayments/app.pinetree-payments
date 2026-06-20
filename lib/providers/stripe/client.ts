import {
  STRIPE_API_BASE_URL,
  STRIPE_PAYMENT_INTENTS_PATH
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

  private headers(idempotencyKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    }

    if (this.apiVersion) headers["Stripe-Version"] = this.apiVersion
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey

    return headers
  }

  async createPaymentIntent(
    request: StripePaymentIntentRequest,
    idempotencyKey?: string
  ): Promise<StripePaymentIntent> {
    const response = await this.fetchImpl(`${STRIPE_API_BASE_URL}${STRIPE_PAYMENT_INTENTS_PATH}`, {
      method: "POST",
      headers: this.headers(idempotencyKey),
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
