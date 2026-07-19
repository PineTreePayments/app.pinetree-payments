import { describe, expect, it } from "vitest"
import { readFileSync } from "fs"
import path from "path"

function read(file: string) {
  return readFileSync(path.join(process.cwd(), file), "utf8")
}

describe("PineTree rail readiness consumers", () => {
  it("POS crypto availability is sourced from checkout payment networks", () => {
    const src = read("engine/posMethodReadiness.ts")

    expect(src).toContain("getMerchantAvailableNetworks")
    expect(src).toContain("availableCryptoRails")
    expect(src).not.toContain("withdrawalReady")
  })

  it("checkout network availability uses PineTree paymentReady flags", () => {
    const src = read("engine/paymentIntents.ts")

    expect(src).toContain("buildPineTreeRailReadiness")
    expect(src).toContain("railReadiness.solana.paymentReady")
    expect(src).toContain("railReadiness.base.paymentReady")
    expect(src).toContain("railReadiness.bitcoin_lightning.paymentReady")
    expect(src).not.toContain("railReadiness.solana.withdrawalReady")
    expect(src).not.toContain("railReadiness.base.withdrawalReady")
  })

  it("Solana/Base payment creation routes to PineTree Wallet profile addresses", () => {
    const src = read("engine/createPayment.ts")

    expect(src).toContain("getPineTreeWalletProfile")
    expect(src).toContain("pineTreeProfile?.solana_address")
    expect(src).toContain("pineTreeProfile?.base_address")
    expect(src).toContain("pineTreeSettlementAddress")
  })

  it("withdrawal API blocks disabled or unprovisioned rails before signer approval", () => {
    const src = read("engine/withdrawals/walletWithdrawals.ts")

    expect(src).toContain("buildPineTreeRailReadiness")
    expect(src).toContain("!readiness.enabled")
    expect(src).toContain("!readiness.walletProvisioned")
    expect(src).toContain('validated.rail === "bitcoin" && !readiness.withdrawalReady')
  })

  it("Providers page setup/status pill is decoupled from the enabled toggle", () => {
    const src = read("app/dashboard/providers/page.tsx")

    // Status pill reflects wallet/account setup readiness only.
    expect(src).toContain("readiness.walletProvisioned")
    expect(src).toContain('const statusLabel = connected ? "Connected" : readiness ? "Setup needed" : "Not connected"')
    // Toggle reflects the raw merchant enabled/disabled preference, never a
    // readiness-derived value, so it can always be flipped back on once set up.
    expect(src).toContain("function canEnableManagedRail")
    expect(src).toContain("const toggleOn = merchantPreferenceEnabled")
    expect(src).toContain("checked={toggleOn}")
    expect(src).toContain("const toggleDisabled = !merchantPreferenceEnabled && !canEnable")
    expect(src).toContain("isMerchantPreferenceEnabled")
    expect(src).not.toContain('"Available"')
  })

  it("Wallet page connected pills and Bitcoin withdrawal visibility use walletProvisioned", () => {
    const src = read("app/dashboard/wallet-setup/page.tsx")

    expect(src).toContain("railReadiness?.base.walletProvisioned")
    expect(src).toContain("railReadiness?.solana.walletProvisioned")
    expect(src).toContain("railReadiness?.bitcoin_lightning.walletProvisioned")
    expect(src).toContain("configured: baseReady && enabledRails.base")
    expect(src).toContain("configured: solanaReady && enabledRails.solana")
    expect(src).toContain("configured: bitcoinReady && enabledRails.bitcoin")
  })
})
