export const FLUIDPAY_PROVIDER_ID = "fluidpay" as const
export const FLUIDPAY_DISPLAY_NAME = "Fluid Pay"
export const FLUIDPAY_UNVERIFIED_DOCS_ERROR = "Fluid Pay API docs not configured/verified"

// This is a code-owned contract gate, not an environment toggle. It must only
// become true in the same reviewed change that implements and tests the
// authoritative FluidPay API and webhook contracts.
export const FLUIDPAY_API_CONTRACT_VERIFIED = false as boolean
