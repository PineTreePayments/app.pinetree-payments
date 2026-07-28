import { describe, expect, it } from "vitest"
import {
  evaluateWithdrawalPreflight,
  unavailableWithdrawalPreflight,
  type WithdrawalCapacity,
} from "@/engine/withdrawals/withdrawalPreflight"
import {
  classifyLegacyWithdrawalErrorMessage,
  presentWithdrawalError,
} from "@/engine/withdrawals/withdrawalErrorPresentation"

function capacity(overrides: Partial<WithdrawalCapacity> = {}): WithdrawalCapacity {
  return {
    rail: "solana",
    asset: "SOL",
    network: "Solana",
    availableBaseUnits: BigInt(1_500_000),
    pendingBaseUnits: BigInt(0),
    spendableBaseUnits: BigInt(1_400_000),
    feeBaseUnits: BigInt(5_000),
    reserveBaseUnits: BigInt(95_000),
    feeAsset: "SOL",
    nativeAvailableBaseUnits: BigInt(1_500_000),
    nativePendingBaseUnits: BigInt(0),
    verifiedAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  }
}

function check(overrides: Partial<WithdrawalCapacity>, requested: bigint, minimum?: bigint) {
  return evaluateWithdrawalPreflight({ capacity: capacity(overrides), requestedBaseUnits: requested, minimumBaseUnits: minimum })
}

describe("canonical withdrawal spendable-balance preflight", () => {
  it("1. rejects SOL above gross balance", () => {
    expect(check({}, BigInt(1_500_001)).code).toBe("INSUFFICIENT_BALANCE")
  })

  it("2. rejects SOL equal to gross balance when fees and reserve remain", () => {
    expect(check({}, BigInt(1_500_000)).spendableBalance).toBe("0.0014")
    expect(check({}, BigInt(1_500_000)).allowed).toBe(false)
  })

  it("3. allows SOL at spendable balance", () => {
    expect(check({}, BigInt(1_400_000)).allowed).toBe(true)
  })

  it("4. maps Solana rent simulation text to safe insufficient-funds copy", () => {
    const raw = "Simulation failed. Transaction results in an account with insufficient funds for rent. Logs: call getLogs()"
    expect(classifyLegacyWithdrawalErrorMessage(raw)).toMatch(/^INSUFFICIENT_/)
    expect(presentWithdrawalError({ rawMessage: raw }).message).not.toMatch(/simulation|logs|getLogs/i)
  })

  it("5. produces a blocking result before authorization", () => {
    expect(check({}, BigInt(1_400_001))).toMatchObject({ allowed: false, title: "Insufficient balance" })
  })

  it("6. never includes authorization material in the preflight result", () => {
    expect(check({}, BigInt(1_400_001))).not.toHaveProperty("payload")
  })

  it("7. rejects USDC above its token balance", () => {
    expect(check({ asset: "USDC", availableBaseUnits: BigInt(10_000_000), spendableBaseUnits: BigInt(10_000_000) }, BigInt(10_000_001)).code)
      .toBe("INSUFFICIENT_BALANCE")
  })

  it("8. distinguishes sufficient USDC with insufficient SOL fees", () => {
    expect(check({
      asset: "USDC",
      availableBaseUnits: BigInt(10_000_000),
      spendableBaseUnits: BigInt(10_000_000),
      nativeAvailableBaseUnits: BigInt(99_999),
    }, BigInt(1_000_000))).toMatchObject({ code: "INSUFFICIENT_NETWORK_FEE_BALANCE", feeAsset: "SOL" })
  })

  it("9. counts destination token-account rent in the fee requirement", () => {
    const result = check({
      asset: "USDC",
      availableBaseUnits: BigInt(10_000_000),
      spendableBaseUnits: BigInt(10_000_000),
      feeBaseUnits: BigInt(2_044_280),
      reserveBaseUnits: BigInt(2_000_000),
      nativeAvailableBaseUnits: BigInt(4_000_000),
    }, BigInt(1_000_000))
    expect(result.code).toBe("INSUFFICIENT_NETWORK_FEE_BALANCE")
    expect(result.requiredFeeReserve).toBe("0.00404428")
  })

  it("10. allows USDC when both token and SOL reserves are valid", () => {
    expect(check({
      asset: "USDC",
      availableBaseUnits: BigInt(10_000_000),
      spendableBaseUnits: BigInt(10_000_000),
      nativeAvailableBaseUnits: BigInt(5_000_000),
    }, BigInt(10_000_000)).allowed).toBe(true)
  })

  it("11. rejects ETH above balance", () => {
    expect(check({ rail: "base", network: "Base", asset: "ETH", feeAsset: "ETH" }, BigInt(1_500_001)).allowed).toBe(false)
  })

  it("12. rejects ETH equal to gross balance because gas is reserved", () => {
    expect(check({ rail: "base", network: "Base", asset: "ETH", feeAsset: "ETH" }, BigInt(1_500_000)).allowed).toBe(false)
  })

  it("13. allows ETH at its calculated spendable amount", () => {
    expect(check({ rail: "base", network: "Base", asset: "ETH", feeAsset: "ETH" }, BigInt(1_400_000)).allowed).toBe(true)
  })

  it("14. rejects Base USDC above its balance", () => {
    expect(check({ rail: "base", network: "Base", asset: "USDC", feeAsset: "ETH", spendableBaseUnits: BigInt(5_000_000) }, BigInt(5_000_001)).code)
      .toBe("INSUFFICIENT_BALANCE")
  })

  it("15. distinguishes Base USDC with insufficient ETH gas", () => {
    expect(check({
      rail: "base", network: "Base", asset: "USDC", feeAsset: "ETH",
      spendableBaseUnits: BigInt(5_000_000), nativeAvailableBaseUnits: BigInt(99_999),
    }, BigInt(1_000_000)).code).toBe("INSUFFICIENT_NETWORK_FEE_BALANCE")
  })

  it("16. allows Base USDC with sufficient token and ETH balances", () => {
    expect(check({
      rail: "base", network: "Base", asset: "USDC", feeAsset: "ETH",
      spendableBaseUnits: BigInt(5_000_000), nativeAvailableBaseUnits: BigInt(1_000_000),
    }, BigInt(5_000_000)).allowed).toBe(true)
  })

  it("17. rejects Bitcoin above provider spendable balance", () => {
    expect(check({
      rail: "bitcoin", network: "Bitcoin / Lightning", asset: "BTC", feeAsset: "BTC",
      availableBaseUnits: BigInt(100_000), spendableBaseUnits: BigInt(99_500), feeBaseUnits: BigInt(500), reserveBaseUnits: BigInt(0),
    }, BigInt(99_501)).allowed).toBe(false)
  })

  it("18. rejects a Bitcoin amount below provider minimum", () => {
    expect(check({ rail: "bitcoin", network: "Bitcoin / Lightning", asset: "BTC", feeAsset: "BTC" }, BigInt(999), BigInt(1000)).code)
      .toBe("MINIMUM_AMOUNT")
  })

  it("19. rejects Bitcoin when the fee makes requested amount unspendable", () => {
    expect(check({
      rail: "bitcoin", network: "Bitcoin / Lightning", asset: "BTC", feeAsset: "BTC",
      availableBaseUnits: BigInt(3_000), spendableBaseUnits: BigInt(2_500), feeBaseUnits: BigInt(500), reserveBaseUnits: BigInt(0),
    }, BigInt(2_501)).allowed).toBe(false)
  })

  it("20. allows a valid Bitcoin withdrawal", () => {
    expect(check({
      rail: "bitcoin", network: "Bitcoin / Lightning", asset: "BTC", feeAsset: "BTC",
      availableBaseUnits: BigInt(3_000), spendableBaseUnits: BigInt(2_500), feeBaseUnits: BigInt(500), reserveBaseUnits: BigInt(0),
    }, BigInt(2_500)).allowed).toBe(true)
  })

  it("21. exposes spendable rather than gross balance as Max", () => {
    expect(check({}, BigInt(1)).spendableBalance).toBe("0.0014")
    expect(check({}, BigInt(1)).availableBalance).toBe("0.0015")
  })

  it("22. rejects exactly one base unit above spendable", () => {
    expect(check({}, BigInt(1_400_001)).allowed).toBe(false)
    expect(check({}, BigInt(1_400_000)).allowed).toBe(true)
  })

  it("23. returns a safe ambiguous result when live balance is unavailable", () => {
    expect(unavailableWithdrawalPreflight({ rail: "base", asset: "ETH", requestedAmount: "1" }))
      .toMatchObject({ code: "BALANCE_VERIFICATION_UNAVAILABLE", allowed: false })
  })

  it("24. strips raw RPC and SDK guidance from merchant errors", () => {
    const result = presentWithdrawalError({ rawMessage: "SendTransactionError: simulation failed; call getLogs()" })
    expect(result.message).not.toMatch(/SendTransactionError|simulation|getLogs/i)
  })

  it("25-30. returns only normalized, editable preflight metadata", () => {
    const result = check({}, BigInt(1_400_001))
    expect(result).toMatchObject({ code: "INSUFFICIENT_BALANCE", allowed: false, requestedAmount: "0.001400001" })
    expect(result).not.toHaveProperty("txHash")
    expect(result).not.toHaveProperty("providerReference")
    expect(result).not.toHaveProperty("ledgerEntry")
    expect(result).not.toHaveProperty("reconciliation")
    expect(result).not.toHaveProperty("rawError")
  })
})
