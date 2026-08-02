import { shift4RestRequest, type Shift4RequestContext } from "../client"
import type { Shift4RestConfig } from "../config"

export type Shift4MerchantInformation = {
  voiceCenterAccountNumber: string | null
  voiceCenterPhoneNumber: string | null
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
  return {
    voiceCenterAccountNumber: result.voiceCenterAccountNumber,
    voiceCenterPhoneNumber: result.voiceCenterPhoneNumber,
  }
}
