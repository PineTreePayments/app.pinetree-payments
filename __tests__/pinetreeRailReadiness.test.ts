import { describe, expect, it } from "vitest"
import { buildPineTreeRailReadiness } from "@/lib/pinetreeRailReadiness"

const enabledProviders = [
  { provider: "solana", enabled: true, status: "connected" },
  { provider: "base", enabled: true, status: "connected" },
  { provider: "lightning_speed", enabled: true, status: "connected" },
]

describe("PineTree rail readiness", () => {
  it("clean not_created wallet profile does not make enabled pending crypto rails payment-ready", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: [
        { provider: "solana", enabled: true, status: "pending" },
        { provider: "base", enabled: true, status: "pending" },
        { provider: "lightning_speed", enabled: true, status: "pending" },
      ],
      walletProfile: {
        solana_address: null,
        base_address: null,
        btc_address: null,
        btc_payout_enabled: false,
      },
      speed: { configured: false, accountReady: false, payoutReady: false, status: "pending" },
    })

    expect(readiness.solana.enabled).toBe(true)
    expect(readiness.base.enabled).toBe(true)
    expect(readiness.bitcoin_lightning.enabled).toBe(true)
    expect(readiness.solana.walletProvisioned).toBe(false)
    expect(readiness.base.walletProvisioned).toBe(false)
    expect(readiness.bitcoin_lightning.walletProvisioned).toBe(false)
    expect(readiness.solana.paymentReady).toBe(false)
    expect(readiness.base.paymentReady).toBe(false)
    expect(readiness.bitcoin_lightning.paymentReady).toBe(false)
  })

  it("enabled=true plus pending provider does not make rails active", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: [
        { provider: "solana", enabled: true, status: "pending" },
        { provider: "base", enabled: true, status: "pending" },
      ],
      walletProfile: {
        solana_address: "So11111111111111111111111111111111111111112",
        base_address: "0x1111111111111111111111111111111111111111",
      },
    })

    expect(readiness.solana.paymentReady).toBe(false)
    expect(readiness.base.paymentReady).toBe(false)
    expect(readiness.solana.reasonCodes).toContain("provider_not_connected")
    expect(readiness.base.reasonCodes).toContain("provider_not_connected")
  })

  it("provider enabled but missing Solana address is not paymentReady or withdrawalReady", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: enabledProviders,
      walletProfile: { base_address: "0xabc", solana_address: null },
    })

    expect(readiness.solana.paymentReady).toBe(false)
    expect(readiness.solana.withdrawalReady).toBe(false)
    expect(readiness.solana.reasonCodes).toContain("missing_solana_address")
  })

  it("Solana paymentReady is true only when Solana address plus connected/active provider exist", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: enabledProviders,
      walletProfile: { solana_address: "So11111111111111111111111111111111111111112" },
    })

    expect(readiness.solana.paymentReady).toBe(true)
    expect(readiness.solana.withdrawalReady).toBe(false)
    expect(readiness.solana.reasonCodes).toContain("missing_dynamic_signer")
  })

  it("Solana address without connected provider is not paymentReady", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: [{ provider: "solana", enabled: true, status: "pending" }],
      walletProfile: { solana_address: "So11111111111111111111111111111111111111112" },
    })

    expect(readiness.solana.paymentReady).toBe(false)
  })

  it("provider enabled plus Solana address plus Dynamic signer is withdrawalReady", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: enabledProviders,
      walletProfile: { solana_address: "So11111111111111111111111111111111111111112" },
      dynamicSigners: { solana: true },
    })

    expect(readiness.solana.paymentReady).toBe(true)
    expect(readiness.solana.withdrawalReady).toBe(true)
    expect(readiness.solana.reasonCodes).toEqual(["ready"])
  })

  it("provider enabled but missing Base address is not paymentReady or withdrawalReady", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: enabledProviders,
      walletProfile: { solana_address: "So11111111111111111111111111111111111111112" },
    })

    expect(readiness.base.paymentReady).toBe(false)
    expect(readiness.base.withdrawalReady).toBe(false)
    expect(readiness.base.reasonCodes).toContain("missing_base_address")
  })

  it("Base paymentReady is true only when Base address plus connected/active provider exist", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: enabledProviders,
      walletProfile: { base_address: "0x1111111111111111111111111111111111111111" },
    })

    expect(readiness.base.paymentReady).toBe(true)
    expect(readiness.base.withdrawalReady).toBe(false)
    expect(readiness.base.reasonCodes).toContain("missing_dynamic_signer")
  })

  it("Base address without connected provider is not paymentReady", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: [{ provider: "base", enabled: true, status: "pending" }],
      walletProfile: { base_address: "0x1111111111111111111111111111111111111111" },
    })

    expect(readiness.base.paymentReady).toBe(false)
  })

  it("provider enabled plus Base address plus Dynamic signer is withdrawalReady", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: enabledProviders,
      walletProfile: { base_address: "0x1111111111111111111111111111111111111111" },
      dynamicSigners: { base: true },
    })

    expect(readiness.base.paymentReady).toBe(true)
    expect(readiness.base.withdrawalReady).toBe(true)
    expect(readiness.base.reasonCodes).toEqual(["ready"])
  })

  it("BTC placeholder address alone is not paymentReady or withdrawalReady", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: enabledProviders,
      walletProfile: {
        btc_address: "bc1pplaceholder",
        btc_payout_enabled: true,
      },
      speed: { configured: true, accountReady: false, payoutReady: false },
    })

    expect(readiness.bitcoin_lightning.walletProvisioned).toBe(false)
    expect(readiness.bitcoin_lightning.paymentReady).toBe(false)
    expect(readiness.bitcoin_lightning.withdrawalReady).toBe(false)
    expect(readiness.bitcoin_lightning.reasonCodes).toContain("btc_placeholder_only")
  })

  it("Speed active makes Lightning paymentReady", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: enabledProviders,
      walletProfile: {},
      speed: { configured: true, accountReady: true, payoutReady: false, status: "ready" },
    })

    expect(readiness.bitcoin_lightning.walletProvisioned).toBe(true)
    expect(readiness.bitcoin_lightning.paymentReady).toBe(true)
    expect(readiness.bitcoin_lightning.withdrawalReady).toBe(false)
  })

  it("Lightning enabled pending is not paymentReady until Speed account is active", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: [{ provider: "lightning_speed", enabled: true, status: "pending" }],
      walletProfile: { btc_address: "bc1placeholder", btc_payout_enabled: true },
      speed: { configured: true, accountReady: false, payoutReady: false, status: "pending" },
    })

    expect(readiness.bitcoin_lightning.paymentReady).toBe(false)
    expect(readiness.bitcoin_lightning.withdrawalReady).toBe(false)
    expect(readiness.bitcoin_lightning.reasonCodes).toContain("missing_speed_account")
  })

  it("Speed active plus payout config makes Lightning withdrawalReady", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: enabledProviders,
      walletProfile: { btc_payout_enabled: true },
      speed: { configured: true, accountReady: true, payoutReady: true, status: "ready" },
    })

    expect(readiness.bitcoin_lightning.paymentReady).toBe(true)
    expect(readiness.bitcoin_lightning.withdrawalReady).toBe(true)
    expect(readiness.bitcoin_lightning.reasonCodes).toEqual(["ready"])
  })

  it("legacy merchant_wallets cannot mark canonical PineTree Wallet rails ready", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: enabledProviders,
      walletProfile: null,
    })

    expect(readiness.solana.paymentReady).toBe(false)
    expect(readiness.base.paymentReady).toBe(false)
    expect(readiness.solana.reasonCodes).toContain("missing_wallet_profile")
    expect(readiness.base.reasonCodes).toContain("missing_wallet_profile")
  })

  it("merchant disabling a fully set-up rail removes it from POS/Checkout paymentReady, but wallet provisioning stays true", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: [
        { provider: "solana", enabled: false, status: "connected" },
        { provider: "base", enabled: false, status: "connected" },
        { provider: "lightning_speed", enabled: false, status: "connected" },
      ],
      walletProfile: {
        solana_address: "So11111111111111111111111111111111111111112",
        base_address: "0x1111111111111111111111111111111111111111",
      },
      speed: { configured: true, accountReady: true, payoutReady: true, status: "ready" },
    })

    // POS/Checkout gates on paymentReady — disabling a rail must remove it from checkout.
    expect(readiness.solana.paymentReady).toBe(false)
    expect(readiness.base.paymentReady).toBe(false)
    expect(readiness.bitcoin_lightning.paymentReady).toBe(false)

    // But the setup/readiness signal used for the Providers page status pill
    // (walletProvisioned) is untouched by the enabled toggle.
    expect(readiness.solana.walletProvisioned).toBe(true)
    expect(readiness.base.walletProvisioned).toBe(true)
    expect(readiness.bitcoin_lightning.walletProvisioned).toBe(true)
  })
})
