import { assertFluidPayDocsVerified } from "./client"

export async function getPaymentStatus(_providerReference: string): Promise<never> {
  // TODO(Fluid Pay docs): verify status lookup endpoint and canonical payment statuses.
  return assertFluidPayDocsVerified()
}
