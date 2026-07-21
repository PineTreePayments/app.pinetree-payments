import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createSweepRule: vi.fn(),
  updateSweepRule: vi.fn(),
  getSweepRule: vi.fn(),
  getEnabledSweepRuleForAsset: vi.fn(),
  listSweepRulesForMerchant: vi.fn(),
  getWithdrawalDestination: vi.fn(),
  insertMerchantAuditEvent: vi.fn(),
  sendWalletSecurityNotification: vi.fn(),
}))

vi.mock("@/database/walletSweepRules", () => ({
  createSweepRule: mocks.createSweepRule,
  updateSweepRule: mocks.updateSweepRule,
  getSweepRule: mocks.getSweepRule,
  getEnabledSweepRuleForAsset: mocks.getEnabledSweepRuleForAsset,
  listSweepRulesForMerchant: mocks.listSweepRulesForMerchant,
}))

vi.mock("@/database/merchantWithdrawalDestinations", () => ({
  getWithdrawalDestination: mocks.getWithdrawalDestination,
}))

vi.mock("@/database/merchantAuditEvents", () => ({
  insertMerchantAuditEvent: mocks.insertMerchantAuditEvent,
}))

vi.mock("@/lib/email/sendWalletSecurityNotification", () => ({
  sendWalletSecurityNotification: mocks.sendWalletSecurityNotification,
}))

import {
  createMerchantSweepRule,
  updateMerchantSweepRule,
  SWEEP_RULE_ACKNOWLEDGMENT_PHRASE,
} from "@/engine/withdrawals/walletSweepRules"

const CONFIRMED_DESTINATION = {
  id: "dest_1",
  rail: "base",
  asset: "USDC",
  is_enabled: true,
  confirmation_status: "confirmed",
  archived_at: null,
}

describe("automatic sweep rule enable/create - server-side acknowledgment enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getWithdrawalDestination.mockResolvedValue(CONFIRMED_DESTINATION)
    mocks.getEnabledSweepRuleForAsset.mockResolvedValue(null)
    mocks.createSweepRule.mockImplementation(async (input) => ({ id: "rule_1", ...input, is_enabled: Boolean(input.isEnabled) }))
  })

  it("creating a disabled rule requires no acknowledgment text", async () => {
    const rule = await createMerchantSweepRule("merchant_1", {
      rail: "base",
      asset: "USDC",
      destinationId: "dest_1",
      mode: "manual",
      isEnabled: false,
      acknowledgmentText: "",
    })

    expect(rule.is_enabled).toBe(false)
    expect(mocks.createSweepRule).toHaveBeenCalled()
  })

  it("rejects creating an ENABLED rule without the exact acknowledgment phrase", async () => {
    await expect(
      createMerchantSweepRule("merchant_1", {
        rail: "base",
        asset: "USDC",
        destinationId: "dest_1",
        mode: "manual",
        isEnabled: true,
        acknowledgmentText: "sure whatever",
      })
    ).rejects.toThrow(`Type "${SWEEP_RULE_ACKNOWLEDGMENT_PHRASE}" exactly to enable automatic sweeps.`)
    expect(mocks.createSweepRule).not.toHaveBeenCalled()
  })

  it("accepts creating an enabled rule with the exact acknowledgment phrase", async () => {
    const rule = await createMerchantSweepRule("merchant_1", {
      rail: "base",
      asset: "USDC",
      destinationId: "dest_1",
      mode: "manual",
      isEnabled: true,
      acknowledgmentText: SWEEP_RULE_ACKNOWLEDGMENT_PHRASE,
    })

    expect(rule.is_enabled).toBe(true)
  })

  it("rejects enabling a rule whose destination is not confirmed", async () => {
    mocks.getWithdrawalDestination.mockResolvedValue({ ...CONFIRMED_DESTINATION, confirmation_status: "unconfirmed" })

    await expect(
      createMerchantSweepRule("merchant_1", {
        rail: "base",
        asset: "USDC",
        destinationId: "dest_1",
        mode: "manual",
        isEnabled: true,
        acknowledgmentText: SWEEP_RULE_ACKNOWLEDGMENT_PHRASE,
      })
    ).rejects.toThrow("This destination must be confirmed before it can back an automatic sweep rule.")
  })

  it("threshold mode requires a threshold amount", async () => {
    await expect(
      createMerchantSweepRule("merchant_1", {
        rail: "base",
        asset: "USDC",
        destinationId: "dest_1",
        mode: "threshold",
        isEnabled: false,
        acknowledgmentText: "",
      })
    ).rejects.toThrow("A threshold amount is required for threshold mode.")
  })

  it("rejects enabling a second rule for the same asset/network/mode while one is already enabled", async () => {
    mocks.getEnabledSweepRuleForAsset.mockResolvedValue({ id: "existing_rule" })

    await expect(
      createMerchantSweepRule("merchant_1", {
        rail: "base",
        asset: "USDC",
        destinationId: "dest_1",
        mode: "manual",
        isEnabled: true,
        acknowledgmentText: SWEEP_RULE_ACKNOWLEDGMENT_PHRASE,
      })
    ).rejects.toThrow("An enabled automatic sweep rule already exists for this asset and network.")
  })

  it("re-requires acknowledgment only when transitioning a disabled rule to enabled, not on unrelated edits", async () => {
    mocks.getSweepRule.mockResolvedValue({
      id: "rule_1",
      merchant_id: "merchant_1",
      rail: "base",
      asset: "USDC",
      destination_id: "dest_1",
      is_enabled: true,
      mode: "manual",
      threshold_amount_decimal: null,
      scheduled_time_utc: null,
    })
    mocks.updateSweepRule.mockImplementation(async (_m, _id, input) => ({ id: "rule_1", ...input }))

    await updateMerchantSweepRule("merchant_1", "rule_1", { minRemainingReserveDecimal: "5" })

    expect(mocks.updateSweepRule).toHaveBeenCalledWith(
      "merchant_1",
      "rule_1",
      expect.objectContaining({ acknowledgmentText: undefined, acknowledgedAt: undefined })
    )
  })
})
