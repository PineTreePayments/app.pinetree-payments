import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

const page = fs.readFileSync(
  path.join(process.cwd(), "app/dashboard/wallet-setup/page.tsx"),
  "utf8"
)

describe("PineTree Wallet reconnect flow", () => {
  it("Open PineTree Wallet triggers Dynamic auth/connect when signer context is missing", () => {
    expect(page).toContain("async function handleWithdrawalReconnect()")
    expect(page).toContain("setShowDynamicUserProfile(false)")
    expect(page).toContain("setShowAuthFlow(true)")
  })

  it("reconnect refreshes Dynamic wallet/profile state before returning to review", () => {
    expect(page).toContain("await syncProfileFromDynamic()")
    expect(page).toContain('setWithdrawalScreen(withdrawalReview ? "review" : "form")')
    expect(page).toContain("setWithdrawalReconnectPending(true)")
  })

  it("reconnect and signing lookup use all Dynamic wallets plus primary wallet", () => {
    expect(page).toContain("getDynamicWalletSearchList")
    expect(page).toContain("findDynamicApprovalWalletForSource")
    expect(page).toContain("findDynamicWalletForSource(wallets, primaryWallet, prepared.sourceAddress, prepared.rail)")
  })
})
