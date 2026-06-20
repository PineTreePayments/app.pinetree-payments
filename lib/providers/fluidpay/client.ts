import { FLUIDPAY_UNVERIFIED_DOCS_ERROR } from "./constants"

export function assertFluidPayDocsVerified(): never {
  throw new Error(FLUIDPAY_UNVERIFIED_DOCS_ERROR)
}
