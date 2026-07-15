import { getShift4ApiBaseUrl, getShift4SecretKey } from "./constants"

export type Shift4ClientOptions = {
  apiBaseUrl?: string
  secretKey?: string
  fetchImpl?: typeof fetch
}

export class Shift4ClientError extends Error {
  status: number
  responseBody: unknown

  constructor(message: string, status: number, responseBody: unknown) {
    super(message)
    this.name = "Shift4ClientError"
    this.status = status
    this.responseBody = responseBody
  }
}

export class Shift4Client {
  private readonly apiBaseUrl: string
  private readonly secretKey: string
  private readonly fetchImpl: typeof fetch

  constructor(options: Shift4ClientOptions = {}) {
    this.apiBaseUrl = String(options.apiBaseUrl || getShift4ApiBaseUrl()).replace(/\/+$/, "")
    this.secretKey = getShift4SecretKey(options.secretKey)
    this.fetchImpl = options.fetchImpl || fetch
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body)
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path)
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    if (!this.secretKey) {
      throw new Error("Shift4 secret key not configured")
    }

    const authToken = Buffer.from(`${this.secretKey}:`).toString("base64")
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        // Shift4 docs: HTTP Basic auth with API Secret Key as username and an
        // empty password. Keep auth centralized here so no UI component can
        // call Shift4 directly or see the secret.
        Authorization: `Basic ${authToken}`
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })

    const text = await response.text()
    const responseBody = parseJson(text)

    if (!response.ok) {
      const message =
        readString(responseBody, ["message"]) ||
        readString(responseBody, ["error", "message"]) ||
        `Shift4 API request failed with status ${response.status}`
      throw new Shift4ClientError(message, response.status, responseBody)
    }

    return responseBody as T
  }
}

function parseJson(text: string): unknown {
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function readString(value: unknown, path: string[]): string {
  let cursor: unknown = value
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return ""
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return String(cursor || "")
}
