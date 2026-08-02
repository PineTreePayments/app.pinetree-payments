export class Shift4CommerceEngineError extends Error {
  constructor(
    message: string,
    readonly code: "documentation_required" | "timeout_unknown" | "invalid_response" | "device_unavailable"
  ) {
    super(message)
    this.name = "Shift4CommerceEngineError"
  }
}
