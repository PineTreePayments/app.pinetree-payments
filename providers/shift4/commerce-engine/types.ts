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
  /**
   * PineTree's stored Shift4 terminal ID. It is the Shift4-side merchant and
   * terminal binding, and PineTree's own evidence key — but it is NOT how a
   * Commerce Engine For Cloud request reaches the device. The published `device`
   * object addresses the device by manufacturer and serial number; see
   * `./cloud/contract.ts`.
   */
  terminalId: string
  /** How a Commerce Engine For Cloud request actually addresses the device. */
  device?: Readonly<{
    cloud: true
    manufacturer: string
    serialNumber: string
  }>
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
