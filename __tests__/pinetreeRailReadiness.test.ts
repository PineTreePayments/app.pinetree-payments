import { describe, expect, it } from "vitest"
import { buildPineTreeRailReadiness } from "@/lib/pinetreeRailReadiness"

const enabledProviders = [
  { provider: "solana", enabled: true, status: "connected" },
  { provider: "base", enabled: true, status: "connected" },
  { provider: "lightning_speed", enabled: true, status: "connected" },
]

describe("PineTree rail readiness", () => {
  it("provider enabled but missing Solana address is not paymentReady or withdrawalReady", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: enabledProviders,
      walletProfile: { base_address: "0xabc", solana_address: null },
    })

    expect(readiness.solana.paymentReady).toBe(false)
    expect(readiness.solana.withdrawalReady).toBe(false)
    expect(readiness.solana.reasonCodes).toContain("missing_solana_address")
  })

  it("provider enabled plus Solana address is paymentReady", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: enabledProviders,
      walletProfile: { solana_address: "So11111111111111111111111111111111111111112" },
    })

    expect(readiness.solana.paymentReady).toBe(true)
    expect(readiness.solana.withdrawalReady).toBe(false)
    expect(readiness.solana.reasonCodes).toContain("missing_dynamic_signer")
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

  it("provider enabled plus Base address is paymentReady", () => {
    const readiness = buildPineTreeRailReadiness({
      providers: enabledProviders,
      walletProfile: { base_address: "0x1111111111111111111111111111111111111111" },
    })

    expect(readiness.base.paymentReady).toBe(true)
    expect(readiness.base.withdrawalReady).toBe(false)
    expect(readiness.base.reasonCodes).toContain("missing_dynamic_signer")
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
})
