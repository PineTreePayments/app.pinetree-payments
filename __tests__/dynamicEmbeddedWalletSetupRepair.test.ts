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
      provider.indexOf("})\n  }, [dynamicAuthConfig.emailFallbackEnabled")
    )
    expect(logBlock).not.toContain("environmentId,")
  })

  it("DB profile exists but runtime wallets are zero or signerless keeps repair state for signer restoration", () => {
    expect(page).toContain("const dbOnlyWalletProfile =")
    expect(page).toContain("dynamicWalletRuntimeCount === 0")
    expect(page).toContain("!dynamicEmbeddedSignersReady")
    expect(page).toContain("const walletSetupIncomplete = hasWallet && dbOnlyWalletProfile && !walletProvisioningInProgress")
    expect(page).toContain('if (repairOrSetupIncomplete) return "reconnect_needed"')
    expect(page).toContain('if (dynamicProfileReady || hasReadyBaseAndSolanaProfile) return "ready"')
  })

  it("Connected appears when DB profile is ready; runtime signers are separately required for approvals", () => {
    expect(page).toContain('const dynamicProfileReady = profile?.status === "ready" && baseReady && solanaReady && baseSignerReady && solanaSignerReady')
    expect(page).toContain('if (dynamicProfileReady || hasReadyBaseAndSolanaProfile) return "ready"')
    expect(page).toContain('walletSetupPrimaryState === "ready" ? "Connected"')
  })

  it("Review withdrawal is blocked when the runtime signer is missing", () => {
    expect(page).toContain("const reviewSigner =")
    expect(page).toContain("findDynamicApprovalWalletForSource(wallets as unknown[], primaryWallet, withdrawalRail, reviewSourceAddress)")
    expect(page).toContain("dynamicWalletRuntimeCount === 0 || !reviewSigner")
    expect(page).toContain("Reconnect PineTree Wallet to restore secure signing access.")
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
    expect(page).toContain('findDynamicApprovalWalletForSourceAsync(dynamicWalletSearchList as unknown[], primaryWallet, "base", baseAddress)')
    expect(page).toContain('findDynamicApprovalWalletForSourceAsync(dynamicWalletSearchList as unknown[], primaryWallet, "solana", solanaAddress)')
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

  it("repair clears broken DB-only profile addresses and linkage without deleting withdrawal history", () => {
    expect(page).toContain("function handleRepairWalletSetup()")
    expect(page).toContain('action: "reset_dynamic_wallet_profile"')
    expect(profileRoute).toContain('body.action === "reset_dynamic_wallet_profile"')
    expect(profileRoute).toContain("dynamicUserId: null")
    expect(profileRoute).toContain("baseAddress: null")
    expect(profileRoute).toContain("solanaAddress: null")
    expect(profileRoute).not.toContain("wallet_withdrawal_requests")
    expect(profileRoute).not.toContain('"processing"')
    expect(profileRoute).not.toContain('"confirmed"')
    expect(withdrawalRequestsDb).not.toContain("delete()")
  })

  it("repair forces Dynamic session reset and opens auth before provisioning fresh wallets", () => {
    expect(page).toContain("setRepairPendingAfterLogout(true)")
    expect(page).toContain("void handleLogOut()")
    expect(page).toContain("repair_dynamic_session_reset_auth_opened")
    expect(page).toContain('openDynamicEmailFallbackAuth("repair_reopening_after_logout")')
    expect(page).toContain("setPendingSync(true)")
    expect(page).toContain('repairInProgress ? "repair_provision_embedded_wallets" : "create_provision_embedded_wallets"')
    expect(page).toContain("refreshDynamicWalletRuntime(")
  })

  it("repair logs every reset and recreate checkpoint", () => {
    for (const event of [
      "repair_before_reset",
      "repair_profile_cleared",
      "repair_dynamic_session_reset_start",
      "repair_dynamic_session_reset_auth_opened",
      "repair_dynamic_wallets_after_provisioning",
      "repair_signer_verification_failed",
      "repair_profile_saved_with_new_addresses",
    ]) {
      expect(page).toContain(event)
    }
    expect(page).toContain("baseSignerFound")
    expect(page).toContain("solanaSignerFound")
  })

  it("setup stays incomplete when Dynamic returns zero wallets during repair", () => {
    expect(page).toContain("repairFailedIncomplete")
    expect(page).toContain("repair_dynamic_wallets_missing_after_provisioning")
    expect(page).toContain("setRepairFailedIncomplete(true)")
    expect(page).toContain("const repairOrSetupIncomplete = (repairFailedIncomplete || walletSetupIncomplete) && !walletProvisioningInProgress")
  })

  it("missing signer recovery shows Reconnect PineTree Wallet instead of repair", () => {
    expect(page).toContain("Reconnect your PineTree Wallet to restore secure browser access.")
    expect(page).toContain("Reconnect PineTree Wallet")
    const ctaChain = page.slice(
      page.indexOf('walletSetupPrimaryState === "reconnect_needed" ? ('),
      page.indexOf(') : walletSetupPrimaryState === "failed"')
    )
    expect(ctaChain).not.toContain("Repair PineTree Wallet setup")
  })
})
