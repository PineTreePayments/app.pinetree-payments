import { assertOpaqueI4GoToken } from "./validation"

/** Consumes a one-time session and returns the token only in process memory. */
export function readShift4I4GoCallbackToken(input: {
  cardToken: unknown
}): string {
  return assertOpaqueI4GoToken(input.cardToken)
}
