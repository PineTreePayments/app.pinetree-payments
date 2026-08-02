import { normalizeCommerceEngineFixture } from "./normalize"
import type { Shift4CommerceEngineClient, Shift4CommerceEngineRequest, Shift4CommerceEngineResult } from "./types"

export type Shift4CommerceEngineScenario =
  | "approve"
  | "decline"
  | "partial"
  | "referral"
  | "timeout"

export class Shift4CommerceEngineSimulator implements Shift4CommerceEngineClient {
  constructor(private readonly scenario: Shift4CommerceEngineScenario = "approve") {}

  async execute(request: Shift4CommerceEngineRequest): Promise<Shift4CommerceEngineResult> {
    const suffix = request.correlationId.replace(/[^a-zA-Z0-9]/g, "").slice(-12) || "SIMULATED"
    const fixtures: Record<Shift4CommerceEngineScenario, Record<string, unknown>> = {
      approve: { outcome: "approved", responseCode: "00", authorizationCode: "SIM001", retrievalReference: suffix, approvedAmountMinor: request.amountMinor },
      decline: { outcome: "declined", responseCode: "05", retrievalReference: suffix, approvedAmountMinor: 0 },
      partial: { outcome: "partial_approval", responseCode: "10", authorizationCode: "SIM010", retrievalReference: suffix, approvedAmountMinor: Math.max(1, Math.floor(request.amountMinor / 2)) },
      referral: { outcome: "referral", responseCode: "01", retrievalReference: suffix, approvedAmountMinor: 0 },
      timeout: { outcome: "unknown", responseCode: null, retrievalReference: null, approvedAmountMinor: null, lookupRequired: true },
    }
    return normalizeCommerceEngineFixture(fixtures[this.scenario])
  }
}
