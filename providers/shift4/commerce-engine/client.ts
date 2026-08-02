import { Shift4CommerceEngineError } from "./errors"
import type { Shift4CommerceEngineClient, Shift4CommerceEngineRequest, Shift4CommerceEngineResult } from "./types"

/**
 * Real-client placeholder. Official Commerce Engine transport documentation and
 * test credentials are required before a wire request can be implemented.
 */
export class DocumentBlockedShift4CommerceEngineClient implements Shift4CommerceEngineClient {
  async execute(_request: Shift4CommerceEngineRequest): Promise<Shift4CommerceEngineResult> {
    void _request
    throw new Shift4CommerceEngineError(
      "Commerce Engine live transport is blocked until official endpoint, authentication, and payload documentation is supplied",
      "documentation_required"
    )
  }
}
