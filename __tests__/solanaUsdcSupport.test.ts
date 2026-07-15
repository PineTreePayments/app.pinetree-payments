import fs from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,test")
  }
}))

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("Solana USDC API support", () => {
  it("keeps checkout session rails network-based and accepts Solana", async () => {
    const { normalizeCheckoutSessionRails } = await import("@/engine/checkoutSessionMetadata")

    expect(normalizeCheckoutSessionRails(["solana", "base", "lightning"])).toEqual([
      "solana",
      "base",
      "bitcoin_lightning",
    ])
  })

  it("creates Solana USDC split metadata with USDC native amounts", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.pinetree-payments.com")
    const { generateSplitPayment } = await import("@/engine/generateSplitPayment")

    const split = await generateSplitPayment({
      merchantWallet: "merchant-solana-wallet",
      merchantAmount: 25,
      pinetreeWallet: "pinetree-solana-wallet",
      pinetreeFee: 0.15,
      network: "solana",
      asset: "sol-usdc",
      paymentId: "pay_solana_usdc",
    })

    expect(split.paymentUrl).toBe(
      "https://app.pinetree-payments.com/api/solana-pay/transaction?paymentId=pay_solana_usdc"
    )
    expect(split.feeCaptureMethod).toBe("atomic_split")
    expect(split.nativeSymbol).toBe("USDC")
    expect(split.nativeAmount).toBe(25.15)
    expect(split.merchantNativeAmountAtomic).toBe("25000000")
    expect(split.feeNativeAmountAtomic).toBe("150000")
  })

  it("documents Solana USDC in SDK contracts and examples", () => {
    const files = [
      "packages/pinetree-node/src/types.ts",
      "packages/pinetree-js/src/types.ts",
      "packages/pinetree-node/README.md",
      "packages/pinetree-js/README.md",
      "packages/pinetree-react/README.md",
      "docs/api/checkout-sessions.md",
      "docs/api/openapi.yaml",
      "app/dashboard/developer/page.tsx",
    ]
    const copy = files.map(read).join("\n")

    expect(copy).toContain("USDC on Solana")
    expect(copy).toContain('"solana"')
    expect(copy).not.toContain("solana_usdc")
    expect(copy).not.toContain("base_usdc")
  })
})

const {
  getPaymentIntentById,
  getPaymentById,
  markPaymentIntentSelected,
  createPayment,
  buildCreatePaymentRequest,
} = vi.hoisted(() => ({
  getPaymentIntentById: vi.fn(),
  getPaymentById: vi.fn(),
  markPaymentIntentSelected: vi.fn(),
  createPayment: vi.fn(),
  buildCreatePaymentRequest: vi.fn(),
}))

vi.mock("@/database", () => ({
  getPaymentIntentById,
  getPaymentById,
  markPaymentIntentSelected,
  createPaymentIntent: vi.fn(),
  expirePaymentIntent: vi.fn(),
  getMerchantWallets: vi.fn(),
  getConnectedHostedCheckoutNetworks: vi.fn(),
}))

vi.mock("@/database/transactions", () => ({
  getTransactionByPaymentId: vi.fn(),
}))

vi.mock("@/database/merchants", () => ({
  getMerchantProviders: vi.fn(),
}))

vi.mock("@/database/pineTreeWalletProfiles", () => ({
  getPineTreeWalletProfile: vi.fn(),
}))

vi.mock("@/database/merchantProviders", () => ({
  getLightningNwcReadiness: vi.fn(),
  SPEED_PROVIDER_NAME: "speed",
}))

vi.mock("@/engine/createPayment", () => ({
  createPayment,
  buildCreatePaymentRequest,
}))

vi.mock("@/engine/paymentStateActions", () => ({
  markPaymentIncomplete: vi.fn(),
  markPaymentIncompleteIfAbandoned: vi.fn(),
}))

vi.mock("@/engine/loadProviders", () => ({
  loadProviders: vi.fn(),
}))

vi.mock("@/providers/registry", () => ({
  getProviderMetadata: vi.fn(),
  isProviderHealthy: vi.fn(),
  providerSupportsFeeAtPaymentTime: vi.fn(),
}))

describe("Solana USDC hosted checkout routing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPaymentIntentById.mockResolvedValue({
      id: "intent-1",
      merchant_id: "merchant-1",
      amount: 25,
      currency: "USD",
      terminal_id: null,
      metadata: { checkoutLinkId: "session-1" },
      available_networks: ["solana"],
      payment_id: null,
      status: "PENDING",
      expires_at: "2099-01-01T00:00:00.000Z",
    })
    buildCreatePaymentRequest.mockResolvedValue({
      createPaymentInput: {
        amount: 25.15,
        currency: "USD",
        merchantId: "merchant-1",
        preferredNetwork: "solana",
        metadata: {
          checkoutLinkId: "session-1",
          paymentIntentId: "intent-1",
          selectedNetwork: "solana",
          selectedAsset: "USDC",
        },
      },
      breakdown: {
        merchantAmount: 25,
        taxAmount: 0,
        pinetreeFee: 0.15,
        grossAmount: 25.15,
      },
    })
    createPayment.mockResolvedValue({
      id: "payment-1",
      provider: "solana",
      paymentUrl: "https://app.pinetree-payments.com/api/solana-pay/transaction?paymentId=payment-1",
      qrCodeUrl: "data:image/png;base64,abc",
      address: "merchant-solana-wallet",
      nativeAmount: 25.15,
      nativeSymbol: "USDC",
      asset: "USDC",
    })
    getPaymentById.mockResolvedValue({
      id: "payment-1",
      provider: "solana",
      payment_url: "https://app.pinetree-payments.com/api/solana-pay/transaction?paymentId=payment-1",
      qr_code_url: "data:image/png;base64,abc",
      network: "solana",
      status: "PENDING",
      metadata: {
        selectedAsset: "USDC",
        split: {
          merchantWallet: "merchant-solana-wallet",
          pinetreeWallet: "pinetree-solana-wallet",
        },
      },
    })
  })

  it("passes asset USDC through network selection to Solana payment creation", async () => {
    const { selectPaymentIntentNetworkEngine } = await import("@/engine/paymentIntents")

    const result = await selectPaymentIntentNetworkEngine({
      intentId: "intent-1",
      network: "solana",
      asset: "USDC",
      idempotencyKey: "intent-1-usdc",
    })

    expect(buildCreatePaymentRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredNetwork: "solana",
        metadata: expect.objectContaining({
          selectedNetwork: "solana",
          selectedAsset: "USDC",
        }),
      })
    )
    expect(createPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredNetwork: "solana",
        asset: "USDC",
      })
    )
    expect(markPaymentIntentSelected).toHaveBeenCalledWith({
      id: "intent-1",
      selected_network: "solana",
      payment_id: "payment-1",
    })
    expect(result).toMatchObject({
      network: "solana",
      asset: "USDC",
      provider: "solana",
      nativeSymbol: "USDC",
    })
  })

  it("rejects unsupported Solana assets before payment creation", async () => {
    const { selectPaymentIntentNetworkEngine } = await import("@/engine/paymentIntents")

    await expect(
      selectPaymentIntentNetworkEngine({
        intentId: "intent-1",
        network: "solana",
        asset: "BTC",
      })
    ).rejects.toThrow("Solana payments support SOL and USDC only")
    expect(createPayment).not.toHaveBeenCalled()
  })
})
