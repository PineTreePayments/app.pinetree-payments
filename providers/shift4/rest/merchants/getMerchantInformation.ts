import { shift4RestRequest, type Shift4RequestContext } from "../client"
import type { Shift4RestConfig } from "../config"
import type { Shift4Outcome } from "../normalizeResponse"

/**
 * The safe projection of GET /merchants/merchant.
 *
 * Two groups of fields, both non-secret:
 *
 *  - `voiceCenter*` — merchant contact details for the referral flow. They are
 *    MERCHANT account references, never cardholder data, and are deliberately
 *    excluded from general provider logs.
 *
 *  - transport evidence produced by `normalizeShift4Response` — the outcome
 *    classification plus correlation, server name and provider timestamp. These
 *    let a caller prove the call actually reached Shift4 and was answered,
 *    which a `voiceCenter` block alone cannot: Shift4 returns that block only
 *    alongside a referral, so its absence is normal and says nothing about
 *    whether authentication worked.
 *
 * No property name here is invented — each is transcribed from the documented
 * envelope (`server.name`, `dateTime`) or produced by PineTree itself
 * (`correlationId`). The access token, request headers, request body and raw
 * response body are structurally unreachable from this type.
 */
export type Shift4MerchantInformation = {
  voiceCenterAccountNumber: string | null
  voiceCenterPhoneNumber: string | null
  /**
   * Evidence classification. For this read-only operation "approved" means
   * Shift4 answered with the documented envelope and no error object — it is
   * NOT an approval of anything, and no money moved.
   */
  outcome: Shift4Outcome
  correlationId: string
  /** Documented `server.name`. Null when Shift4 omitted it. */
  serverName: string | null
  /** Documented `dateTime` from the response. Null when absent. */
  providerDateTime: string | null
  httpStatus: number | null
}

/** Backend-only GET /merchants/merchant used by the certified referral flow. */
export async function getMerchantInformation(input: {
  accessToken: string
  certificationScopeConfirmed: true
  context?: Shift4RequestContext
  config?: Shift4RestConfig
  fetchImpl?: typeof fetch
}): Promise<Shift4MerchantInformation> {
  if (input.certificationScopeConfirmed !== true) {
    throw new Error("Shift4 Merchant Information requires confirmed certification scope.")
  }
  const { result } = await shift4RestRequest({
    operation: "merchant_information",
    accessToken: input.accessToken,
    context: input.context,
    config: input.config,
    fetchImpl: input.fetchImpl,
  })
  // Built field by field so a future normalizer addition cannot widen what this
  // adapter hands back to the Engine.
  return {
    voiceCenterAccountNumber: result.voiceCenterAccountNumber,
    voiceCenterPhoneNumber: result.voiceCenterPhoneNumber,
    outcome: result.outcome,
    correlationId: result.correlationId,
    serverName: result.serverName,
    providerDateTime: result.providerDateTime,
    httpStatus: result.httpStatus,
  }
}
