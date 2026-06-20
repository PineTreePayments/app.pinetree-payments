import { assertFluidPayDocsVerified } from "./client"
import type { FluidPayCreatePaymentInput } from "./types"

export async function createPayment(_input: FluidPayCreatePaymentInput): Promise<never> {
  // TODO(Fluid Pay docs): verify exact payment/session creation endpoint.
  // TODO(Fluid Pay docs): verify required request body fields and amount unit rules.
  // TODO(Fluid Pay docs): verify response id/reference and hosted URL/client token fields.
  // TODO(Fluid Pay docs): verify auth scheme/header format before making production calls.
  return assertFluidPayDocsVerified()
}
