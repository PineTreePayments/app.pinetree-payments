export type Shift4CommerceEngineOperation =
  | "sale"
  | "authorization"
  | "capture"
  | "void"
  | "refund"
  | "invoice_lookup"
  | "cancel"
  | "status_lookup"

export type Shift4CommerceEngineRequest = Readonly<{
  operation: Shift4CommerceEngineOperation
  invoice: string
  amountMinor: number
  currency: "USD" | "CAD"
  terminalId: string
  correlationId: string
}>

export type Shift4CommerceEngineResult = Readonly<{
  outcome: "approved" | "declined" | "partial_approval" | "referral" | "unknown"
  responseCode: string | null
  authorizationCode: string | null
  retrievalReference: string | null
  approvedAmountMinor: number | null
  signatureRequired: boolean
  lookupRequired: boolean
}>

export interface Shift4CommerceEngineClient {
  execute(request: Shift4CommerceEngineRequest): Promise<Shift4CommerceEngineResult>
}
