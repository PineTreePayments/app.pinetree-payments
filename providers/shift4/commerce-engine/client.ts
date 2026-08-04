import { Shift4CommerceEngineError } from "./errors"
import type { Shift4CommerceEngineClient, Shift4CommerceEngineRequest, Shift4CommerceEngineResult } from "./types"

/**
 * The Commerce Engine dispatch seam, gated on hardware rather than on docs.
 *
 * This class previously threw `documentation_required` because no official
 * endpoint, authentication, or payload schema was available. That reason is no
 * longer true. Shift4's published OpenAPI (v1.7.58) documents the Commerce
 * Engine For Cloud request body for authorization, sale, refund and
 * `POST /devices/getstatus`, and PineTree implements those contracts in
 * `./cloud`. Transport is the shared Shift4 REST client — there is deliberately
 * no second HTTP stack here.
 *
 * What remains blocked is physical: no PAX or Verifone terminal has been
 * delivered, no Shift4 TMS terminal assignment exists, Commerce Engine
 * provisioning is not complete, and the Retail and certification gates are off.
 * Dispatching would fail at Shift4 rather than at PineTree, and would do so
 * having already committed a transaction intent.
 *
 * So it fails closed with an honest reason. The day a terminal is registered
 * and the gates open, dispatch is wired here against `./cloud`; the request
 * contract itself no longer needs discovering.
 */
export class HardwareGatedShift4CommerceEngineClient implements Shift4CommerceEngineClient {
  async execute(_request: Shift4CommerceEngineRequest): Promise<Shift4CommerceEngineResult> {
    void _request
    throw new Shift4CommerceEngineError(
      "Commerce Engine dispatch is blocked until a Shift4-assigned terminal is registered, Commerce Engine provisioning is complete, and the Retail gate is enabled",
      "device_unavailable"
    )
  }
}
