import { APIConnectionError, AuthenticationError, createAPIError } from "./errors"
import type { APIErrorPayload, PineTreeOptions } from "./types"

const DEFAULT_BASE_URL = "https://app.pinetree-payments.com"
const DEFAULT_TIMEOUT = 30_000
const USER_AGENT = "@pinetreepayments/node/0.1.0"

export class PineTreeClient {
  readonly apiKey: string
  readonly baseUrl: string
  readonly timeout: number

  constructor(apiKeyOrOptions: string | PineTreeOptions) {
    const options =
      typeof apiKeyOrOptions === "string"
        ? { apiKey: apiKeyOrOptions }
        : apiKeyOrOptions
    if (!options?.apiKey?.trim()) {
      throw new AuthenticationError("A PineTree API key is required.")
    }
    if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout <= 0)) {
      throw new TypeError("timeout must be greater than zero.")
    }

    this.apiKey = options.apiKey.trim()
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "")
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT
  }

  async request<T>(input: {
    method: "GET" | "POST"
    path: string
    query?: Record<string, string | number | undefined>
    body?: unknown
    headers?: Record<string, string>
  }): Promise<T> {
    const url = new URL(`${this.baseUrl}${input.path}`)
    for (const [key, value] of Object.entries(input.query || {})) {
      if (value !== undefined) url.searchParams.set(key, String(value))
    }

    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeout)
    let response: Response
    try {
      response = await fetch(url, {
        method: input.method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
          ...input.headers,
        },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: controller.signal,
      })
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === "AbortError" || controller.signal.aborted)
      throw new APIConnectionError(
        timedOut
          ? `PineTree API request timed out after ${this.timeout}ms.`
          : "Unable to connect to the PineTree API.",
        { cause: error }
      )
    } finally {
      clearTimeout(timeoutHandle)
    }

    let data: unknown = null
    const text = await response.text()
    if (text) {
      try {
        data = JSON.parse(text)
      } catch (error) {
        throw new APIConnectionError("PineTree API returned invalid JSON.", {
          status: response.status,
          cause: error,
        })
      }
    }
    if (!response.ok) {
      throw createAPIError(response.status, (data || {}) as APIErrorPayload)
    }
    return data as T
  }
}
