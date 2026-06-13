import { CheckoutInitializationError, CheckoutSessionError } from "./errors"
import type { PineTreeJSOptions } from "./types"

const DEFAULT_BASE_URL = "https://app.pinetree-payments.com"

type ApiErrorBody = {
  error?: { type?: string; code?: string; message?: string }
}

/**
 * Internal browser client. Holds the resolved public key and base URL.
 * Not exported — consumers interact through the PineTree class.
 */
export class PineTreeBrowserClient {
  readonly publicKey: string
  readonly baseUrl: string

  constructor(publicKeyOrOptions: string | PineTreeJSOptions) {
    const options =
      typeof publicKeyOrOptions === "string"
        ? { publicKey: publicKeyOrOptions }
        : publicKeyOrOptions

    if (!options?.publicKey?.trim()) {
      throw new CheckoutInitializationError("A PineTree public key is required.")
    }

    this.publicKey = options.publicKey.trim()
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
  }

  async request<T>(path: string, options: { method: string; body?: unknown }): Promise<T> {
    const url = `${this.baseUrl}${path}`
    let response: Response
    try {
      response = await fetch(url, {
        method: options.method,
        headers: {
          "Content-Type": "application/json",
          "X-PineTree-Public-Key": this.publicKey,
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      })
    } catch (cause) {
      throw new CheckoutSessionError("Network request failed.", {
        code: "network_error",
        type: "network_error",
        cause,
      })
    }

    if (!response.ok) {
      let errorBody: ApiErrorBody = {}
      try {
        errorBody = (await response.json()) as ApiErrorBody
      } catch {
        // ignore JSON parse failures
      }
      const apiError = errorBody.error ?? {}
      const message = apiError.message ?? `Request failed with status ${response.status}`
      const code = apiError.code ?? "api_error"
      const type = apiError.type ?? "api_error"

      if (response.status === 401) {
        throw new CheckoutInitializationError(message, { code, type })
      }
      throw new CheckoutSessionError(message, { code, type })
    }

    return response.json() as Promise<T>
  }
}
