import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  balances: vi.fn(),
  transactions: vi.fn(),
  withdrawal: vi.fn(),
  status: vi.fn(),
}))

vi.mock("@/database/merchantLightningProfiles", () => ({
  getMerchantLightningProfile: vi.fn().mockResolvedValue({ status: "ready", speed_account_id: "acct_1" }),
}))
vi.mock("@/providers/lightning/speedWalletCapabilities", () => ({
  getSpeedWalletCapabilities: () => ({
    capabilities: { balances: true, transactions: true, withdrawals: true, payouts: false, payoutStatus: true, manualSwap: false, automaticPayouts: false, automaticSwap: false },
  }),
}))
vi.mock("@/providers/lightning/speedWalletManagement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/providers/lightning/speedWalletManagement")>()
  return {
    ...actual,
    getConnectedAccountBalances: mocks.balances,
    listConnectedAccountTransactions: mocks.transactions,
    createConnectedAccountWithdrawal: mocks.withdrawal,
    getConnectedAccountSendStatus: mocks.status,
  }
})

describe("Speed wallet adapter normalization", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
  })

  it("preserves SATS and stablecoin precision as integer PineTree base units", async () => {
    mocks.balances.mockResolvedValue({
      object: "balance",
      available: [
        { amount: 2217713, target_currency: "SATS" },
        { amount: "3.125001", target_currency: "USDC" },
      ],
    })
    const { speedWalletAdapter } = await import("@/providers/lightning/speedWalletAdapter")
    const balances = await speedWalletAdapter.getBalances!({ merchantId: "m1", providerAccountId: "acct_1" })
    expect(balances).toEqual([
      expect.objectContaining({ asset: "BTC", availableBaseUnits: BigInt(2217713), network: "bitcoin_lightning" }),
      expect.objectContaining({ asset: "USDC", availableBaseUnits: BigInt(3125001), network: null }),
    ])
  })

  it("normalizes incoming, outgoing, and unknown provider transaction categories", async () => {
    mocks.transactions.mockResolvedValue({
      object: "list", has_more: false, data: [
        { id: "txn_pay", object: "balance_transaction", amount: 100, fee: 1, net: 99, target_currency: "SATS", type: "Payment", transaction_type: "credit", source: "pi_1", created: 1655442814345 },
        { id: "txn_send", object: "balance_transaction", amount: 50, fee: 2, net: 48, target_currency: "SATS", type: "Withdraw", transaction_type: "debit", source: "wi_1", created: 1655442814344 },
        { id: "txn_other", object: "balance_transaction", amount: 7, fee: 0, net: 7, target_currency: "SATS", type: "Provider Mystery", transaction_type: "credit", source: null, created: 1655442814343 },
      ],
    })
    const { speedWalletAdapter } = await import("@/providers/lightning/speedWalletAdapter")
    const page = await speedWalletAdapter.listActivity!({ merchantId: "m1", providerAccountId: "acct_1" }, {})
    expect(page.activity.map((row) => [row.operationType, row.direction, row.status])).toEqual([
      ["PAYMENT", "credit", "COMPLETED"],
      ["WITHDRAWAL", "debit", "COMPLETED"],
      ["ADJUSTMENT", "credit", "COMPLETED"],
    ])
  })

  it("maps only Speed paid to completed and retains withdraw_id for reconciliation", async () => {
    mocks.withdrawal.mockResolvedValue({
      id: "is_1", status: "unpaid", withdraw_id: "wi_1", amount: 1000, currency: "SATS",
      target_amount: 1000, target_currency: "SATS", fees: 3, withdraw_method: "lightning",
      withdraw_type: "lightning_invoice", created: 1, modified: 1,
    })
    const { speedWalletAdapter } = await import("@/providers/lightning/speedWalletAdapter")
    const result = await speedWalletAdapter.createWithdrawal!(
      { merchantId: "m1", providerAccountId: "acct_1" },
      { asset: "SATS", amountBaseUnits: BigInt(1000), destination: "lnbc1invoice", idempotencyKey: "key" }
    )
    expect(result).toMatchObject({
      providerReference: "is_1",
      providerSecondaryReference: "wi_1",
      status: "PENDING",
      feeBaseUnits: BigInt(3),
    })
  })

  it("rejects non-Lightning assets and malformed destinations before provider submission", async () => {
    const { speedWalletAdapter } = await import("@/providers/lightning/speedWalletAdapter")
    expect(() => speedWalletAdapter.validateWithdrawal!({ asset: "USDC", amountBaseUnits: BigInt(1), destination: "lnbc1validinvoice000000000", idempotencyKey: "k" }))
      .toThrow(expect.objectContaining({ code: "WALLET_VALIDATION_ERROR" }))
    expect(() => speedWalletAdapter.validateWithdrawal!({ asset: "SATS", amountBaseUnits: BigInt(1), destination: "not-a-lightning-destination", idempotencyKey: "k" }))
      .toThrow(expect.objectContaining({ code: "WALLET_VALIDATION_ERROR" }))
  })
})
