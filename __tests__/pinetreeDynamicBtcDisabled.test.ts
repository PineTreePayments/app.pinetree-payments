import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { dynamicBrowserWithdrawalSigner } from "@/providers/wallets/withdrawalSigner"
import { isDynamicBtcLegacyEnabled } from "@/lib/pinetreeDynamicBtcLegacy"

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8")

describe("Dynamic BTC legacy guard", () => {
  it("does not introduce a parallel PineTree wallet overview engine", () => {
    expect(fs.existsSync(path.join(root, "engine/pineTreeWalletOverview.ts"))).toBe(false)
  })

  it("defaults the server-only Dynamic BTC legacy flag to disabled", () => {
    delete process.env.PINETREE_ENABLE_DYNAMIC_BTC_LEGACY

    expect(isDynamicBtcLegacyEnabled()).toBe(false)
  })

  it("keeps Base and Solana Dynamic signing available while Bitcoin is disabled", async () => {
    process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID = "env_test"
    delete process.env.PINETREE_ENABLE_DYNAMIC_BTC_LEGACY

    const signer = dynamicBrowserWithdrawalSigner()

    await expect(signer.canSignWithdrawal({
      merchantId: "merchant_1",
      walletProfileId: "profile_1",
      rail: "base",
      asset: "USDC",
      destinationAddress: "0x1234567890abcdef1234567890abcdef12345678",
      amountDecimal: "1",
    })).resolves.toBe(true)
    await expect(signer.canSignWithdrawal({
      merchantId: "merchant_1",
      walletProfileId: "profile_1",
      rail: "solana",
      asset: "USDC",
      destinationAddress: "11111111111111111111111111111111",
      amountDecimal: "1",
    })).resolves.toBe(true)
    await expect(signer.canSignWithdrawal({
      merchantId: "merchant_1",
      walletProfileId: "profile_1",
      rail: "bitcoin",
      asset: "BTC",
      destinationAddress: "bc1qexample",
      amountDecimal: "0.001",
    })).resolves.toBe(false)
  })

  it("gates normal Dynamic BTC profile persistence and PSBT approval paths", () => {
    const profileRoute = read("app/api/wallets/pinetree-profile/route.ts")
    const withdrawals = read("engine/withdrawals/walletWithdrawals.ts")

    expect(profileRoute).toContain("isDynamicBtcLegacyEnabled")
    expect(profileRoute).toContain("dynamic_btc_profile_input_ignored")
    expect(withdrawals).toContain("isDynamicBtcLegacyEnabled")
    expect(withdrawals).toContain("Bitcoin wallet approval is not available yet.")
  })
})
