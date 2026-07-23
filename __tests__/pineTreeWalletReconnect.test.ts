import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

const page = fs.readFileSync(
  path.join(process.cwd(), "app/dashboard/wallet-setup/page.tsx"),
  "utf8"
)

describe("PineTree Wallet reconnect flow", () => {
  it("Open PineTree Wallet suppresses provider auth when the PineTree Wallet is already ready", () => {
    expect(page).toContain("async function handleWithdrawalReconnect()")
    expect(page).toContain('await refreshDynamicWalletRuntime("withdrawal_reconnect_before_lookup",')
    expect(page).toContain("if (providerSheetGateStateRef.current.walletReady) {")
    expect(page).toContain('openDynamicEmailFallbackAuth("withdrawal_reconnect", {')
    expect(page).toContain("signatureRequired: false")
    expect(page).toContain("wallet_provider_sheet_open_suppressed")
  })

  it("reconnect refreshes Dynamic wallet/profile state before returning to review", () => {
    expect(page).toContain("useRefreshUser")
    expect(page).toContain("const refreshDynamicUser = useRefreshUser()")
    expect(page).toContain("await refreshDynamicUser()")
    expect(page).toContain("await syncProfileFromDynamic()")
    expect(page).toContain('setWithdrawalScreen(withdrawalReview ? "review" : "form")')
    expect(page).toContain("setWithdrawalReconnectPending(true)")
  })

  it("logs safe provider sheet diagnostics and only allows Base/Solana final authorization to require signing", () => {
    expect(page).toContain("type ProviderSheetGateOptions")
    expect(page).toContain("wallet_provider_sheet_open_requested")
    expect(page).toContain("selectedRail")
    expect(page).toContain("explicitUserAction")
    expect(page).toContain("walletReady")
    expect(page).toContain("profileReady")
    expect(page).toContain("baseReady")
    expect(page).toContain("solanaReady")
    expect(page).toContain("bitcoinReady")
    expect(page).toContain("signatureRequired")
    expect(page).toContain("runtimeUserPresent")
    expect(page).toContain("runtimeWalletCount")
    expect(page).toContain('openDynamicEmailFallbackAuth("withdrawal_reconnect", {')
    expect(page).toContain("explicitUserAction: true")
    expect(page).toContain("signatureRequired: false")
    expect(page).toContain('if (!isAmbiguousOutcome && withdrawalReview?.review.approvalMethod === "dynamic_browser" && (withdrawalRail === "base" || withdrawalRail === "solana"))')
  })

  it("keeps Bitcoin out of Dynamic authorization recovery", () => {
    expect(page).toContain('if (!isAmbiguousOutcome && withdrawalReview?.review.approvalMethod === "dynamic_browser" && (withdrawalRail === "base" || withdrawalRail === "solana"))')
    expect(page).toContain("setWithdrawalAuthorizationRecoveryOpen(true)")
    expect(page).toContain("const usesDynamicSigner = dynamicSignerWithdrawalRails.includes(withdrawalRail)")
    expect(page).not.toContain('selectedRail: "bitcoin"')
  })

  it("shows PineTree-branded withdrawal authorization recovery without changing ready state", () => {
    expect(page).toContain("Withdrawal needs your authorization")
    expect(page).toContain("Confirm this withdrawal in PineTree Wallet to continue.")
    expect(page).toContain("Authorize withdrawal")
    expect(page).toContain("Authorizing...")
    expect(page).toContain("Cancel")
    expect(page).not.toContain("setWalletSetupPrimaryState")
  })

  it("retryable authorization recovery enables Authorize withdrawal whenever a review exists", () => {
    const modal = page.slice(
      page.indexOf("{withdrawalAuthorizationRecoveryOpen ? ("),
      page.indexOf("{showWalletWorkspace ? (")
    )
    expect(modal).toContain("{withdrawalReview ? (")
    expect(modal).toContain("Confirm this withdrawal in PineTree Wallet to continue.")
    expect(modal).toContain("Review the withdrawal details again before authorizing.")
    expect(modal).toContain("void handleSubmitWithdrawal({ irreversibleAckChecked: true })")
    expect(modal).toContain("disabled={submittingWithdrawal}")
    expect(modal).not.toContain("disabled={submittingWithdrawal || !withdrawalReview}")
    expect(modal).toContain('{submittingWithdrawal ? "Authorizing..." : "Authorize withdrawal"}')
  })

  it("reconnect and signing lookup use all Dynamic wallets plus primary wallet", () => {
    expect(page).toContain("getDynamicWalletSearchList")
    expect(page).toContain("findDynamicApprovalWalletForSource")
    expect(page).toContain("findDynamicWalletForSource(wallets, primaryWallet, prepared.sourceAddress, prepared.rail)")
  })

  it("approve withdrawal prepares before signer lookup/signing", () => {
    expect(page).toContain("wallet_withdrawal_prepare_requested")
    // Signs with the freshly hydrated runtime snapshot, not a closed-over
    // wallets/primaryWallet render value.
    expect(page).toContain("const dynamicRuntime = await ensureDynamicWalletRuntimeReady(")
    expect(page).toContain("sendDynamicPreparedWithdrawal(prepared as WithdrawalPrepareResponse, dynamicRuntime.wallets, dynamicRuntime.primaryWallet, {")
  })

  it("blocks selected signer and asset rail mismatches before Dynamic approval opens", () => {
    expect(page).toContain('const withdrawalSignerRailMismatchMessage = "Selected wallet network does not match this withdrawal asset."')
    expect(page).toContain("assertPreparedWithdrawalSignerMatchesRail(prepared, wallet)")
    expect(page).toContain('console.warn("[pinetree-withdrawals] signer_rail_mismatch"')
    expect(page).toContain("throw new Error(withdrawalSignerRailMismatchMessage)")
  })

  it("saved profiles with empty Dynamic runtime wallets trigger hydration", () => {
    expect(page).toContain('refreshDynamicWalletRuntime("profile_loaded_runtime_wallets_empty")')
    expect(page).toContain("if (dynamicWalletRuntimeCount > 0) return")
    expect(page).toContain("if (!profile.base_address && !profile.solana_address) return")
  })

  it("logs ABOUT_TO_OPEN_DYNAMIC_MODAL with every required field before any signing call", () => {
    const preflightFn = page.slice(
      page.indexOf("function buildDynamicModalDebugPayload("),
      page.indexOf("async function sendDynamicPreparedWithdrawal(")
    )
    expect(preflightFn).toContain('console.error("[pinetree-withdrawals] ABOUT_TO_OPEN_DYNAMIC_MODAL"')
    for (const field of [
      "selectedAsset",
      "selectedRail",
      "preparedRail",
      "preparedAsset",
      "preparedPayloadKind",
      "preparedPayloadNetwork",
      "preparedSourceAddress",
      "pineTreeProfileSolanaAddress",
      "dynamicPrimaryWalletChain",
      "dynamicPrimaryWalletAddress",
      "selectedDynamicWalletChain",
      "selectedDynamicWalletAddress",
      "selectedDynamicWalletConnectorKey",
      "selectedDynamicWalletConnectorName",
      "selectedDynamicWalletNetwork",
      "selectedDynamicWalletId",
      "inferredSignerRail",
      "expectedSignerRail",
    ]) {
      expect(preflightFn).toContain(field)
    }
  })

  it("hard-fails on expectedRail/inferredSignerRail mismatch immediately before the signing branches, not just at prepare/review", () => {
    const sendFn = page.slice(
      page.indexOf("async function sendDynamicPreparedWithdrawal("),
      page.indexOf("function base64ToBytes(")
    )
    const preflightIndex = sendFn.indexOf("logDynamicSigningPreflight(prepared, wallet, context, inferredSignerRail, willOpenDynamicModal)")
    const hardFailIndex = sendFn.indexOf("if (expectedRail !== inferredSignerRail) {")
    const solanaHardBlockIndex = sendFn.indexOf("await assertSolanaWithdrawalModalPreflight(prepared, wallet, context)")
    const evmBranchIndex = sendFn.indexOf('if (prepared.payload.kind === "evm_transaction") {')
    const btcBranchIndex = sendFn.indexOf('if (prepared.payload.kind === "bitcoin_psbt") {')
    expect(preflightIndex).toBeGreaterThan(-1)
    expect(hardFailIndex).toBeGreaterThan(preflightIndex)
    expect(solanaHardBlockIndex).toBeGreaterThan(hardFailIndex)
    expect(evmBranchIndex).toBeGreaterThan(solanaHardBlockIndex)
    expect(btcBranchIndex).toBeGreaterThan(solanaHardBlockIndex)
    expect(sendFn).toContain("throw new Error(withdrawalSignerRailMismatchMessage)")
  })

  it("runtime-asserts chainId 8453 for evm_transaction payloads, not just the declared TypeScript literal type", () => {
    expect(page).toContain('if (prepared.payload.kind === "evm_transaction" && prepared.payload.chainId !== 8453) {')
    expect(page).toContain("prepared_payload_chain_id_mismatch")
  })

  it("Solana withdrawals never fall back to a non-Solana primaryWallet, and get a Solana-specific reconnect message", () => {
    const sendFn = page.slice(
      page.indexOf("async function sendDynamicPreparedWithdrawal("),
      page.indexOf("function base64ToBytes(")
    )
    // getDynamicWalletSearchList filters primaryWallet by expected chain before any
    // address match is attempted, so a Bitcoin primaryWallet is excluded outright for
    // a Solana rail - findDynamicWalletForSource can never resolve it as a signer.
    expect(sendFn).toContain("getDynamicWalletSearchList(wallets as unknown[], primaryWallet, prepared.rail)")
    expect(sendFn).toContain('const missingWalletMessage = prepared.rail === "solana"')
    expect(sendFn).toContain('"No Dynamic Solana wallet matched the prepared source address."')
    expect(sendFn).toContain('throw makeDynamicPostPrepareError(missingWalletMessage, "WALLET_NOT_CONNECTED")')
    expect(page).toContain("solanaWithdrawalReconnectMessage")
  })

  it("sendDynamicPreparedWithdrawal receives the merchant's currently-selected rail/asset for preflight comparison against the reviewed payload", () => {
    expect(page).toContain("context: DynamicSigningPreflightContext")
    expect(page).toContain("selectedRail: withdrawalRail,")
    expect(page).toContain("selectedAsset: withdrawalAsset,")
    expect(page).toContain("pineTreeProfileSolanaAddress: profile?.solana_address ?? null")
    expect(page).toContain("switchDynamicWallet,")
  })

  it("SOL withdrawal with Bitcoin primaryWallet activates the selected Solana wallet before signing", () => {
    expect(page).toContain("useSwitchWallet")
    expect(page).toContain("const switchDynamicWallet = useSwitchWallet()")
    expect(page).toContain('const primaryWalletIsBitcoin = Boolean(primaryWalletLike && classifyDynamicWalletChain(primaryWalletLike) === "bitcoin")')
    expect(page).toContain("await switchDynamicWallet(selectedWalletId)")
    expect(page).toContain("bitcoin_primary_selected_for_solana")
  })

  it("Solana modal preflight blocks Bitcoin-classified wallets before Dynamic opens", () => {
    expect(page).toContain("async function assertSolanaWithdrawalModalPreflight")
    expect(page).toContain('if (prepared.rail !== "solana" && context.selectedRail !== "solana") return')
    expect(page).toContain('if (classifyDynamicWalletChain(wallet) !== "solana") fail("selected_wallet_not_solana")')
    expect(page).toContain('if (primaryWalletIsBitcoin && wallet === primaryWalletLike) fail("bitcoin_primary_selected_for_solana")')
    expect(page).toContain("throw new Error(solanaWithdrawalReconnectMessage)")
  })

  it("preflight log exists immediately before every Dynamic modal/sign call", () => {
    const sendFn = page.slice(
      page.indexOf("async function sendDynamicPreparedWithdrawal("),
      page.indexOf("function base64ToBytes(")
    )
    const evmLogIndex = sendFn.indexOf("logAboutToOpenDynamicModal(prepared, wallet, context, inferredSignerRail)")
    const evmCallIndex = sendFn.indexOf("client.sendTransaction({")
    const btcLogIndex = sendFn.indexOf("logAboutToOpenDynamicModal(prepared, wallet, context, inferredSignerRail)", evmLogIndex + 1)
    const btcCallIndex = sendFn.indexOf("wallet.signPsbt?.(psbtRequest) ?? wallet.connector?.signPsbt?.(psbtRequest)")
    const solanaCallbackIndex = sendFn.indexOf("logAboutToOpenDynamicModal(prepared, wallet, context, inferredSignerRail)", btcLogIndex + 1)
    const solanaCallIndex = sendFn.indexOf("const result = await signDynamicSolanaTransactionWithActiveAccount(")
    expect(page).toContain('console.error("[pinetree-withdrawals] ABOUT_TO_OPEN_DYNAMIC_MODAL"')
    expect(evmLogIndex).toBeGreaterThan(-1)
    expect(evmCallIndex).toBeGreaterThan(evmLogIndex)
    expect(btcLogIndex).toBeGreaterThan(evmCallIndex)
    expect(btcCallIndex).toBeGreaterThan(btcLogIndex)
    expect(solanaCallbackIndex).toBeGreaterThan(solanaCallIndex)
  })

  it("logs the Dynamic Solana sign result after signAndSendTransaction resolves", () => {
    const dynamicSignerLookup = fs.readFileSync(
      path.join(process.cwd(), "lib/wallets/dynamicSignerLookup.ts"),
      "utf8"
    )
    const signFn = dynamicSignerLookup.slice(
      dynamicSignerLookup.indexOf("export async function signDynamicSolanaTransactionWithActiveAccount("),
      dynamicSignerLookup.length
    )
    const callIndex = signFn.indexOf("txResult = await withTimeout(")
    const logIndex = signFn.indexOf('console.info("[pinetree-withdrawals] dynamic_solana_sign_result"')
    expect(callIndex).toBeGreaterThan(-1)
    expect(logIndex).toBeGreaterThan(callIndex)
    expect(signFn).toContain("signaturePresent")
    expect(signFn).toContain("resultType")
  })

  it("Solana signing timeout shows a controlled pending message and exits approving", () => {
    const dynamicSignerLookup = fs.readFileSync(
      path.join(process.cwd(), "lib/wallets/dynamicSignerLookup.ts"),
      "utf8"
    )
    expect(dynamicSignerLookup).toContain("DYNAMIC_SOLANA_SIGN_TIMEOUT_MS = 45_000")
    expect(dynamicSignerLookup).toContain("Withdrawal approval is still pending. Check your wallet activity before trying again.")
    expect(page).toContain('if (raw === "Withdrawal approval is still pending. Check your wallet activity before trying again.") return raw')
    const dynamicCatchStart = page.indexOf("} catch (error) {", page.indexOf("async function handleSubmitWithdrawal"))
    const catchBlock = page.slice(
      dynamicCatchStart,
      page.indexOf("} finally {", dynamicCatchStart)
    )
    expect(catchBlock).toContain("setWithdrawalApprovalError")
    expect(catchBlock).toContain('setWithdrawalScreen("failed")')
    expect(page).toContain("setSubmittingWithdrawal(false)")
  })

  it("successful Solana signing posts normalized tx_hash/provider_reference and refreshes activity", () => {
    const submitFn = page.slice(
      page.indexOf("async function handleSubmitWithdrawal"),
      page.indexOf("// ---------------------------------------------------------------------------\n  // Early returns")
    )
    expect(submitFn).toContain("tx_hash: dynamicSubmission.txHash || \"\"")
    expect(submitFn).toContain("provider_reference: dynamicSubmission.providerReference || dynamicSubmission.txHash || \"\"")
    expect(submitFn).toContain("setWithdrawalSubmitResult(submitted as WithdrawalSubmitResponse)")
    expect(submitFn).toContain('setWithdrawalScreen("submitted")')
    expect(submitFn).toContain("void syncPineTreeWallet()")
    expect(submitFn).toContain("void pollWithdrawalRequest(withdrawalId, submitted as WithdrawalSubmitResponse)")
  })

  it("SOL success state uses the shared result copy (no rail-specific success layout) and does not leave approving visible", () => {
    // The submitted/processing/confirmed result screen must be identical across every
    // rail (Bitcoin, Base, Solana) - no per-asset "success" branch like the old
    // isSolanaSolWithdrawal special case, which showed a different title/copy for SOL.
    expect(page).not.toContain("isSolanaSolWithdrawal")
    expect(page).toContain("Your withdrawal is still being processed. You can safely leave this screen.")
    expect(page).toContain('kind === "authorizing"')
  })

  it("Solana withdrawal path never calls signPsbt or uses Bitcoin primaryWallet as signer", () => {
    const solanaPreflight = page.slice(
      page.indexOf("async function assertSolanaWithdrawalModalPreflight"),
      page.indexOf("async function sendDynamicPreparedWithdrawal(")
    )
    expect(solanaPreflight).not.toContain("signPsbt")
    expect(solanaPreflight).toContain("selected_wallet_not_solana")
    expect(solanaPreflight).toContain("bitcoin_primary_selected_for_solana")
  })

  it("review screen exposes a debug-only signer panel, gated behind ?walletDebug=1, never shown by default", () => {
    expect(page).toContain("Signer diagnostics (?walletDebug=1)")
    expect(page).toContain("debugEnabled?: boolean")
    expect(page).toContain("debugEnabled={walletSyncDebugQueryEnabled}")
    const debugPanel = page.slice(
      page.indexOf("{debugEnabled ? ("),
      page.indexOf("Signer diagnostics (?walletDebug=1)") + 1400
    )
    expect(debugPanel).toContain("{debugEnabled ? (")
    expect(debugPanel).toContain("preparedPayloadKind")
    expect(debugPanel).toContain("preparedPayloadNetwork")
    expect(debugPanel).toContain("preparedSourceAddressLast6")
    expect(debugPanel).toContain("selectedDynamicWalletAddressLast6")
    expect(debugPanel).toContain("selectedDynamicWalletConnector")
    expect(debugPanel).toContain("selectedDynamicWalletChain")
    expect(debugPanel).toContain("dynamicPrimaryWalletChain")
    expect(debugPanel).toContain("inferredSignerRail")
    expect(debugPanel).toContain("willOpenDynamicModal")
  })
})
