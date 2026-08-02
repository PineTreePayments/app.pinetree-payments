export class Shift4I4GoValidationError extends Error {
  readonly status = 400
  readonly code = "invalid_i4go_callback"
}

export function assertOpaqueI4GoToken(value: unknown): string {
  const token = typeof value === "string" ? value.trim() : ""
  if (token.length < 8 || token.length > 4096 || /\s/.test(token)) {
    throw new Shift4I4GoValidationError("The i4Go callback did not contain a valid opaque token")
  }
  // Defense in depth: reject values shaped like raw card numbers.
  if (/^\d{12,19}$/.test(token.replace(/[ -]/g, ""))) {
    throw new Shift4I4GoValidationError("Raw card numbers are never accepted")
  }
  return token
}

export function assertTrustedI4GoOrigin(origin: string | null, expectedOrigin: string | null): void {
  if (!expectedOrigin || origin !== expectedOrigin) {
    throw new Shift4I4GoValidationError("Untrusted i4Go callback origin")
  }
}
