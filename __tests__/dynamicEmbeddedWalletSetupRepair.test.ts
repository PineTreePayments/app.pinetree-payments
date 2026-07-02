import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

const page = read("app/dashboard/wallet-setup/page.tsx")
const provider = read("components/providers/PineTreeDynamicProvider.tsx")
const profileRoute = read("app/api/wallets/pinetree-profile/route.ts")
const withdrawalRequestsDb = read("database/walletWithdrawalRequests.ts")

describe("Dynamic embedded wallet setup repair", () => {
  it("logs Dynamic environment configuration as present or missing only", () => {
    expect(provider).toContain("[pinetree-wallets] dynamic_environment_config")
    expect(provider).toContain('NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID: environmentId ? "present" : "missing"')
    const logBlock = provider.slice(
      provider.indexOf("[pinetree-wallets] dynamic_environment_config"),
      provider.indexOf("}, [environmentId])")
    )
    expect(logBlock).not.toContain("environmentId,")
  })

  it("DB profile exists but runtime wallets are zero or signerless -> Setup incomplete", () => {
    expect(page).toContain("const dbOnlyWalletProfile =")
    expect(page).toContain("dynamicWalletRuntimeCount === 0")
    expect(page).toContain("!dynamicEmbeddedSignersReady")
    expect(page).toContain('walletSetupIncomplete ? "Setup incomplete"')
  })

  it("Connected appears only when DB addresses and Dynamic runtime signers both exist", () => {
    expect(page).toContain("const allPrimaryRailsConnected = baseReady && solanaReady && bitcoinReady && baseSignerReady && solanaSignerReady")
    expect(page).toContain('const walletStatus = allPrimaryRailsConnected ? "Connected"')
  })

  it("Review withdrawal is blocked when the runtime signer is missing", () => {
    expect(page).toContain("const reviewSigner =")
    expect(page).toContain("findDynamicApprovalWalletForSource(wallets as unknown[], primaryWallet, withdrawalRail, reviewSourceAddress)")
    expect(page).toContain("dynamicWalletRuntimeCount === 0 || !reviewSigner")
    expect(page).toContain("Finish PineTree Wallet setup before reviewing withdrawals.")
    const guardIdx = page.indexOf("dynamicWalletRuntimeCount === 0 || !reviewSigner")
    const reviewIdx = page.indexOf("setReviewingWithdrawal(true)")
    expect(guardIdx).toBeGreaterThan(0)
    expect(reviewIdx).toBeGreaterThan(guardIdx)
  })

  it("Finish setup provisions or restores embedded Base and Solana wallets before saving", () => {
    expect(page).toContain('beginWalletSetupRepair("finish_embedded_wallet_setup")')
    expect(page).toContain("refreshDynamicWalletRuntime(reason, { requireApprovalWallet: false })")
    expect(page).toContain("createWalletAccount(needsAutoCreateWalletChains)")
    expect(page).toContain("await createOrRestoreSession()")
    expect(page).toContain("await createEmbeddedWallet()")
    expect(page).toContain("requireBaseAndSolanaSigners: true")
  })

  it("profile is saved only after runtime wallets expose Base and Solana signers", () => {
    expect(page).toContain("const baseSigner = baseAddress")
    expect(page).toContain("const solanaSigner = solanaAddress")
    expect(page).toContain("options?.requireBaseAndSolanaSigners && (!baseAddress || !solanaAddress || !baseSigner || !solanaSigner)")
    const syncFn = page.slice(
      page.indexOf("const syncProfileFromDynamic = useCallback"),
      page.indexOf("// --- Post-reconnect wallet match check ---")
    )
    const signerGuardIdx = syncFn.indexOf("embedded_signers_missing")
    const postIdx = syncFn.indexOf('fetch("/api/wallets/pinetree-profile"')
    expect(signerGuardIdx).toBeGreaterThan(0)
    expect(postIdx).toBeGreaterThan(signerGuardIdx)
  })

  it("broken DB-only profile can be repaired without deleting withdrawal history", () => {
    expect(page).toContain("function handleRepairWalletSetup()")
    expect(page).toContain("dynamic_user_id: null")
    expect(page).toContain("base_address: null")
    expect(page).toContain("solana_address: null")
    expect(page).toContain('beginWalletSetupRepair("repair_embedded_wallet_setup")')
    expect(profileRoute).not.toContain("wallet_withdrawal_requests")
    expect(withdrawalRequestsDb).not.toContain("delete()")
  })

  it("setup incomplete shows Finish PineTree Wallet setup instead of Open PineTree Wallet", () => {
    expect(page).toContain('walletSetupIncomplete ? "Finish PineTree Wallet setup" : "Open PineTree Wallet"')
    expect(page).toContain("Repair PineTree Wallet setup")
  })
})
