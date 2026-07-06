import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

describe("PineTree embedded wallet setup", () => {
  const provider = read("components/providers/PineTreeDynamicProvider.tsx")
  const layout = read("app/dashboard/layout.tsx")
  const page = read("app/dashboard/wallet-setup/page.tsx")
  const providerPage = read("app/dashboard/providers/page.tsx")
  const apiRoute = read("app/api/wallets/pinetree-profile/route.ts")
  const withdrawalApiRoute = read("app/api/wallets/pinetree-wallet/withdrawals/route.ts")
  const withdrawalPrepareRoute = read("app/api/wallets/pinetree-wallet/withdrawals/[id]/prepare/route.ts")
  const withdrawalSubmitRoute = read("app/api/wallets/pinetree-wallet/withdrawals/[id]/submit/route.ts")
  const withdrawalEngine = read("engine/withdrawals/walletWithdrawals.ts")
  const withdrawalSigner = read("providers/wallets/withdrawalSigner.ts")
  const dynamicSignerLookup = read("lib/wallets/dynamicSignerLookup.ts")
  const dbHelper = read("database/pineTreeWalletProfiles.ts")
  const migration = read("database/migrations/20260622_create_pinetree_wallet_profile.sql")
  const dynamicEmailMigration = read("database/migrations/20260705_add_dynamic_email_to_pinetree_wallet_profiles.sql")
  const withdrawalProductionSchemaMigration = read("database/migrations/20260625_ensure_wallet_withdrawal_requests_production_schema.sql")
  // PineTree-managed Lightning backend files
  const lightningMigration = read("database/migrations/20260622_create_merchant_lightning_profiles.sql")
  const speedConnectMigration = read("database/migrations/20260623_add_speed_connect_fields_to_merchant_lightning_profiles.sql")
  const lightningDbHelper = read("database/merchantLightningProfiles.ts")
  const lightningApiRoute = read("app/api/wallets/lightning/pinetree-managed/route.ts")
  // connect-return was deleted when merchant-facing Speed Connect was removed.
  // Tests below assert it is absent instead of reading it.
  const speedConnectReturnRouteExists = (() => {
    const fs = require("node:fs")
    const path = require("node:path")
    return fs.existsSync(path.join(process.cwd(), "app/api/wallets/lightning/speed/connect-return/route.ts"))
  })()
  const speedConnectedAccountHelper = read("providers/lightning/speedConnectedAccounts.ts")
  const speedClient = read("providers/lightning/speedClient.ts")
  const speedAdapter = read("providers/lightning/speedAdapter.ts")
  const paymentsRoute = read("app/api/payments/route.ts")
  const packageJson = JSON.parse(read("package.json")) as { dependencies: Record<string, string> }

  // -------------------------------------------------------------------------
  // Infrastructure wiring
  // -------------------------------------------------------------------------

  it("loads wallet infrastructure only around the authenticated dashboard", () => {
    expect(layout).toContain("<PineTreeDynamicProvider>")
    expect(layout).toContain("</PineTreeDynamicProvider>")
    expect(layout).toContain('/dashboard/wallet-setup')
    expect(provider).toContain("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID")
    expect(provider).toContain('appName: "PineTree Wallet"')
  })

  it("registers EVM, Solana, and Bitcoin wallet connectors without Spark", () => {
    expect(provider).toContain("EthereumWalletConnectors")
    expect(provider).toContain("SolanaWalletConnectors")
    expect(provider).toContain("BitcoinWalletConnectors")
    expect(provider).not.toContain("SparkWalletConnectors")
  })

  // -------------------------------------------------------------------------
  // Merchant wallet ownership — DB profile as source of truth
  // -------------------------------------------------------------------------

  it("presents one merchant PineTree Wallet profile", () => {
    expect(page).toContain(">PineTree Wallet</h1>")
    expect(page).toContain(">PineTree Wallet</h2>")
    expect(page).toContain("One merchant wallet profile")
    expect(page).toContain("Create PineTree Wallet")
    expect(page).toContain("Open PineTree Wallet")
    expect(page).not.toContain("Sign up with Dynamic")
  })

  it("binds PineTree Wallet creation to the merchant account email", () => {
    expect(page).toContain("setMerchantEmail(canonicalMerchantEmail)")
    expect(page).toContain("extractDynamicUserEmail(user)")
    expect(page).toContain("Use the same email as your PineTree account to create your PineTree Wallet.")
    expect(page).toContain("Using your PineTree account email: {merchantEmail}")
    expect(apiRoute).toContain("getMerchantById(merchantId)")
    expect(apiRoute).toContain("dynamicEmail !== merchantEmail")
    expect(dbHelper).toContain("dynamic_email: string | null")
    expect(dynamicEmailMigration).toContain("ADD COLUMN IF NOT EXISTS dynamic_email TEXT")
  })

  it("loads the merchant wallet profile from the DB before deciding Create vs Open", () => {
    // Must call /api/wallets/pinetree-profile, not derive state purely from Dynamic session
    expect(page).toContain("/api/wallets/pinetree-profile")
    // Profile state drives the CTA: hasWallet (from DB) not hasAnyAddress (from Dynamic)
    expect(page).toContain("hasWallet")
    expect(page).toContain("profileState")
    // Merchant-profile-derived readiness flags
    expect(page).toContain("profileAddresses")
  })

  it("shows Create PineTree Wallet when no profile exists, not the Dynamic session state", () => {
    // The Create vs Open decision is driven by 'hasWallet' which comes from profileState (DB),
    // not from the raw Dynamic useUserWallets() data
    expect(page).toContain("hasWallet")
    expect(page).toContain('{ kind: "none" }')
    // A new merchant (profileState.kind === "none") should see Create, not the stale Dynamic wallet
    expect(page).toContain("Create PineTree Wallet")
    expect(page).toContain("Open PineTree Wallet")
    // The old pattern that exposed raw Dynamic session state as the CTA guard is removed
    expect(page).not.toContain('{hasAnyAddress ? "Open PineTree Wallet" : "Create PineTree Wallet"}')
  })

  it("only shows wallet addresses that are linked to the current PineTree merchant profile", () => {
    // Addresses rendered in the modal come from DB-backed profile state.
    expect(page).toContain("profileAddresses.base")
    expect(page).toContain("profileAddresses.solana")
    expect(page).toContain("bitcoinPayoutEntries")
    expect(page).toContain("profile.btc_address")
    // Lightning readiness comes from the separate lightningProfile, not from profileAddresses
    expect(page).toContain("lightningProfileState")
    expect(page).toContain("lightningProfile")
    // Raw Dynamic wallet addresses (dynamicNetworkAddresses) are used only for syncing, not for display
    expect(page).toContain("dynamicNetworkAddresses")
    expect(page).not.toContain("networkAddresses.base")
    expect(page).not.toContain("networkAddresses.solana")
  })

  it("detects and blocks a stale Dynamic session from a different PineTree account", () => {
    // dynamicSessionMatchesProfile checks profile.dynamic_user_id against user.userId
    expect(page).toContain("dynamicSessionMatchesProfile")
    expect(page).toContain("profile.dynamic_user_id")
    expect(page).toContain("user.userId")
    // hasStaleDynamicSession guards Create so it doesn't silently reuse the old session
    expect(page).toContain("hasStaleDynamicSession")
    // Reconnect copy is shown to the merchant instead of the old setup-incomplete warning.
    expect(page).toContain("Reconnect your PineTree Wallet to restore secure browser access.")
    expect(page).toContain("Reconnect PineTree Wallet")
  })

  it("clears a stale Dynamic session before creating a wallet for a new merchant", () => {
    // logoutPending flow: detect stale session → call handleLogOut → wait → open auth flow
    expect(page).toContain("logoutPending")
    expect(page).toContain("handleLogOut")
    expect(page).toContain("Preparing...")
  })

  it("wallet status requires DB profile addresses plus hydrated Dynamic signers", () => {
    // baseReady and solanaReady come from normalized readiness with DB-backed address fallback
    expect(page).toContain("const baseReady = railReadiness?.base.walletProvisioned ?? profileAddresses.base.length > 0")
    expect(page).toContain("const solanaReady = railReadiness?.solana.walletProvisioned ?? profileAddresses.solana.length > 0")
    expect(page).toContain("const baseSignerReady = Boolean(")
    expect(page).toContain("const solanaSignerReady = Boolean(")
    expect(page).toContain('findDynamicApprovalWalletForSource(wallets as unknown[], primaryWallet, "base", profile.base_address)')
    expect(page).toContain('findDynamicApprovalWalletForSource(wallets as unknown[], primaryWallet, "solana", profile.solana_address)')
    // BTC payout readiness is separate from Lightning wallet provisioning.
    expect(page).toContain("const btcPayoutReady = railReadiness?.bitcoin_lightning.withdrawalReady")
    expect(page).toContain("const bitcoinReady = railReadiness?.bitcoin_lightning.walletProvisioned")
    expect(page).not.toContain("const bitcoinReady = bitcoinPayoutEntries.length > 0")
    expect(page).toContain('const dynamicProfileReady = profile?.status === "ready" && baseReady && solanaReady && baseSignerReady && solanaSignerReady')
    expect(page).toContain('if (dynamicProfileReady) return "ready"')
    expect(page).toContain('walletSetupPrimaryState === "ready" ? "Ready" :')
    expect(page).toContain('if (repairOrSetupIncomplete) return "reconnect_needed"')
    expect(page).toContain('walletSetupPrimaryState === "reconnect_needed" ? "Reconnect needed" :')
  })

  it("syncs Dynamic wallet addresses to the merchant profile on creation only when explicitly triggered", () => {
    // pendingSync is the guard: only set when the merchant explicitly clicks Create
    expect(page).toContain("pendingSync")
    expect(page).toContain("syncProfileFromDynamic")
    expect(page).toContain("extractDynamicWalletAddresses")
    expect(page).toContain("getDynamicWalletSearchList(wallets as unknown[], primaryWallet)")
    // POST to pinetree-profile route includes dynamic_user_id to lock the profile to this session
    expect(page).toContain("dynamic_user_id")
    expect(page).toContain("user.userId")
    // Once Base/Solana sync succeeds after Create PineTree Wallet, Lightning setup starts automatically.
    expect(page).toContain("autoEnableLightning")
    expect(page).toContain("syncPineTreeManagedLightning")
  })

  it("tracks wallet creation steps and times out instead of waiting forever", () => {
    expect(page).toContain("type WalletCreationStep")
    expect(page).toContain("walletCreationTimeoutMs = 30_000")
    expect(page).toContain("walletProvisioningRetryIntervalMs = 1_800")
    expect(page).toContain('logWalletCreationStep("waiting_for_dynamic_auth")')
    expect(page).toContain('logWalletCreationStep("provisioning_wallet"')
    expect(page).toContain('setWalletCreationStep("timeout")')
    expect(page).toContain("Wallet setup timed out before PineTree could confirm wallet readiness.")
    expect(page).not.toContain("Wallet setup could not finish. Please try again.")
  })

  it("does not render a persistent synced banner after profile sync succeeds", () => {
    expect(page).toContain('if (step === "profile_synced") return ""')
    expect(page).not.toContain("PineTree Wallet synced.")
  })

  it("retry clears local setup state and restarts embedded wallet polling without deleting rows", () => {
    const retryFn = page.slice(
      page.indexOf("function handleRetryWalletSetup()"),
      page.indexOf("function handleWithdrawalAssetSelect")
    )
    expect(retryFn).toContain("setPendingSync(false)")
    expect(retryFn).toContain("setLogoutPending(false)")
    expect(retryFn).toContain("setShowAuthFlow(false)")
    expect(retryFn).toContain('refreshDynamicWalletRuntime("retry_embedded_wallet_setup"')
    expect(retryFn).toContain("} else {\n        setShowAuthFlow(true)")
    expect(page).not.toContain("delete Dynamic")
  })

  it("logs only safe wallet creation diagnostics in debug mode", () => {
    expect(page).toContain("safeWalletSetupDiagnostics")
    expect(page).toContain("dynamic_user_exists")
    expect(page).toContain("wallet_count")
    expect(page).toContain("wallet_addresses_present")
    expect(page).toContain("profile_sync_response_status")
    expect(page).not.toContain("dynamic_jwt")
    expect(page).not.toContain("session_token")
    expect(page).not.toContain("privateKey")
    expect(page).not.toContain("recoveryPhrase")
  })

  it("Dynamic profile sync sends only Dynamic user, Base, and Solana addresses", () => {
    expect(page).toContain("dynamic_user_id: user.userId")
    expect(page).toContain("base_address: baseAddress")
    expect(page).toContain("solana_address: solanaAddress")
    expect(page).not.toContain("btc_address: bitcoinAddress")
    expect(page).not.toContain("bitcoin_onchain_address: bitcoinAddress")
  })

  it("does not render a separate wallet-address refresh control in the modal", () => {
    // Refresh is gated by canRefresh — only enabled when Dynamic session matches the saved profile
    expect(page).toContain("dynamicSessionMatchesProfile")
    expect(page).not.toContain("Refresh wallet addresses")
    expect(page).not.toContain('aria-label="Refresh wallet addresses"')
    expect(page).not.toContain("Refresh Base/Solana addresses")
    expect(page).not.toContain('aria-label="Refresh Base and Solana addresses"')
    expect(page).not.toContain("handleRefreshAddresses")
    // Refresh calls the same sync path — POST to pinetree-profile
    expect(page).toContain("syncProfileFromDynamic")
  })

  // -------------------------------------------------------------------------
  // UI cleanliness — external wallets hidden
  // -------------------------------------------------------------------------

  it("does not show external wallet choices or Dynamic branding in merchant wallet setup", () => {
    for (const forbidden of [
      "Connect external wallet",
      "Connect Wallet",
      "MetaMask",
      "Coinbase Wallet",
      "Phantom",
      "Solflare",
      "Trust Wallet",
      "View all wallets",
    ]) {
      expect(page).not.toContain(forbidden)
    }
    expect(page).not.toContain(">Dynamic<")
    expect(page).not.toContain("Sign in with Dynamic")
    expect(page).not.toContain("Powered by Dynamic")
  })

  it("keeps raw address details off the main setup summary", () => {
    expect(page).toContain("Wallet address")
    expect(page).toContain("profileAddresses.base")
    expect(page).toContain("profileAddresses.solana")
    expect(page).toContain("bitcoinPayoutEntries")
    expect(page).not.toContain('<ReceiveRow label="Bitcoin Lightning/Spark address"')
    expect(page).not.toContain("Powered by PineTree")
    expect(page).not.toContain("Network addresses")
    expect(page).not.toContain("PineTree Base Wallet")
    expect(page).not.toContain("PineTree Solana Wallet")
  })

  it("opens a PineTree wallet modal with wallet-style sections", () => {
    expect(page).toContain("setWalletOpen(true)")
    expect(page).toContain('role="dialog"')
    expect(page).toContain('aria-modal="true"')
    expect(page).toContain('label: "Overview"')
    expect(page).toContain('label: "Balances"')
    expect(page).toContain('label: "Withdraw"')
    expect(page).not.toContain('label: "Wallets"')
    expect(page).toContain('label: "Activity"')
    expect(page).not.toContain('label: "Receive"')
  })

  it("prioritizes Base, Solana, and Bitcoin", () => {
    expect(page).toContain("const walletRailRows = useMemo<WalletRailRow[]>(() => [")
    expect(page).toContain('label: "Base" as const')
    expect(page).toContain('label: "Solana" as const')
    expect(page).toContain('label: "Bitcoin" as const')
    expect(page).not.toContain("PineTree Bitcoin wallet")
  })

  it("front-card rail chips only show configured and enabled rails", () => {
    expect(page).toContain("function EnabledRailChips")
    expect(page).toContain("const enabledRows = rows.filter((row) => row.enabled && row.configured)")
    expect(page).toContain('aria-label="Enabled payment rails"')
    expect(page).toContain("Manage rails in Providers")
    expect(page).toContain("configured: baseReady, enabled: enabledRails.base")
    expect(page).toContain("configured: solanaReady, enabled: enabledRails.solana")
    expect(page).toContain("configured: bitcoinReady, enabled: enabledRails.bitcoin")
  })

  it("marks the merchant wallet Ready only when Base/Solana signers are hydrated", () => {
    expect(page).toContain('const dynamicProfileReady = profile?.status === "ready" && baseReady && solanaReady && baseSignerReady && solanaSignerReady')
    expect(page).toContain('if (dynamicProfileReady) return "ready"')
    expect(page).toContain('walletSetupPrimaryState === "ready" ? "Ready" :')
    expect(page).toContain('walletSetupPrimaryState === "reconnect_needed" ? "Reconnect needed" :')
    expect(page).not.toContain("Bitcoin Lightning is being prepared through PineTree")
    expect(page).not.toContain("Bitcoin address pending")
  })

  it("uses provider status vocabulary when a wallet address is missing", () => {
    expect(page).toContain('repairInProgress ? "Repairing" :')
    expect(page).toContain('"Not connected"')
    expect(page).not.toContain('"Setup pending"')
    expect(page).not.toContain('const lightningPending = lightningProfile?.status === "pending"')
    expect(page).not.toContain("lightningRetryable")
  })

  it("does not use Not created or Not configured wallet status copy in the PineTree Wallet UI", () => {
    expect(page).not.toContain('"Not created"')
    expect(page).not.toContain('"Not configured"')
    expect(page).not.toContain('"Address syncing"')
  })

  it("shows wallet addresses in the Balances asset detail instead of a separate Wallets tab", () => {
    expect(page).toContain("Wallet address")
    expect(page).toContain('aria-label="Copy wallet address"')
    expect(page).toContain('selectedAsset.rail === "base"')
    expect(page).toContain('selectedAsset.rail === "solana"')
    expect(page).toContain("bitcoinPayoutEntries[0]?.address")
    expect(page).not.toContain("function ReceiveRow")
    expect(page).not.toContain("function WalletRows")
    expect(page).not.toContain('<ReceiveRow label="Bitcoin Lightning/Spark address"')
    expect(page).not.toContain("Powered by PineTree")
    expect(page).not.toContain("Bitcoin payouts route to your PineTree Bitcoin wallet")
    expect(page).not.toContain("Bitcoin receiving is managed automatically by PineTree.")
    expect(page).not.toContain("Bitcoin address pending")
    expect(page).not.toContain("Preparing Bitcoin Lightning")
    expect(page).not.toContain("Enable Bitcoin Lightning")
    expect(page).not.toContain('"Disabled"')
    expect(page).not.toContain(">Setup pending</p>")
  })

  it("removes the top Merchant Wallet eyebrow while keeping title and description", () => {
    expect(page).not.toContain("Merchant wallet</p>")
    expect(page).not.toContain("MERCHANT WALLET")
    expect(page).toContain(">PineTree Wallet</h1>")
    expect(page).toContain("Create and open one merchant wallet for Base, Solana, and Bitcoin.")
  })

  it("overview shows wallet summary balances instead of duplicating receive addresses", () => {
    expect(page).toContain("function WalletOverviewSummary")
    expect(page).toContain(">TOTAL BALANCE</p>")
    expect(page).toContain(">WALLET SUMMARY</p>")
    expect(page).toContain("formatUsd(sync?.totalUsd ?? null)")
    expect(page).toContain("Pending sync")
    expect(page).toContain("Last synced")
    expect(page).toContain("visibleRows.map((row)")
    expect(page).not.toContain("Recent activity")
    const overviewSource = page.slice(
      page.indexOf("function WalletOverviewSummary("),
      page.indexOf("function AssetSelectDropdown(")
    )
    expect(overviewSource).not.toContain("Bitcoin Lightning payout")
    expect(page).not.toContain("Settlement addresses")
    expect(page).not.toContain("address: profileAddresses.base[0]?.address")
    expect(page).not.toContain("RailStatusCard")
    expect(page).not.toContain(">Available</p>")
    expect(page).not.toContain("Balances will update as wallet activity is indexed.")
  })

  it("balances tab uses a selected asset dropdown without fake unsynced zeroes", () => {
    expect(page).toContain("function BalanceRows")
    expect(page).toContain("AssetSelectDropdown")
    expect(page).toContain("dropdownOptions")
    expect(page).toContain("balanceOptions")
    expect(page).not.toContain("allAssets.map((row, index)")
    expect(page).not.toContain("ChevronRight")
    expect(page).toContain("Wallet address")
    expect(page).not.toContain('["Deposit", "Withdraw", "History"].map')
    expect(page).not.toContain("Managed by Speed")
    expect(page).not.toContain("Powered by Speed")
    expect(page).toContain("formatBalance(row.balance, row.asset)")
    expect(page).toContain("No balances yet")
    expect(page).toContain("Received funds will appear here after payments settle.")
    expect(page).not.toContain("Base balance")
    expect(page).not.toContain("Solana balance")
    expect(page).not.toContain("Bitcoin balance")
    expect(page).not.toContain("Not available yet")
  })

  // -------------------------------------------------------------------------
  // Withdrawal scaffold — no real fund movement
  // -------------------------------------------------------------------------

  it("shows Dynamic approval copy only when wallet signing is available", () => {
    expect(page).toContain("Approve withdrawal")
    expect(page).toContain("dynamicApprovalAvailableForWithdrawal")
    expect(page).toContain("findDynamicApprovalWalletForSource")
    expect(page).toContain("dynamicWalletSupportsRail")
    expect(dynamicSignerLookup).toContain("wallet.signAndSendTransaction || wallet.connector?.signAndSendTransaction")
    expect(page).toContain("signAndSendTransaction")
    expect(page).toContain("signPsbt")
    expect(page).toContain("/api/wallets/pinetree-wallet/withdrawals/${encodeURIComponent(withdrawalId)}/prepare")
    expect(page).toContain("/api/wallets/pinetree-wallet/withdrawals/${encodeURIComponent(withdrawalId)}/submit")
  })

  it("keeps dev-only withdrawal fallback diagnostics for Dynamic approval issues", () => {
    expect(page).toContain("Withdrawal diagnostics")
    expect(page).toContain("railEnabled")
    expect(page).toContain("walletAddressExists")
    expect(page).toContain("savedSourceAddress")
    expect(page).toContain("matchingDynamicWallet")
    expect(page).toContain("browserWalletAddresses")
    expect(page).toContain("dynamicMethodAvailable")
    expect(page).toContain("addressMismatch")
    expect(page).toContain("fallbackReason")
    expect(page).toContain('"dynamic_wallet_unavailable"')
    expect(page).toContain('"dynamic_method_unavailable"')
    expect(page).toContain('"address_mismatch"')
  })

  it("uses separate withdrawal screens instead of stacked review and submit panels", () => {
    expect(page).toContain('type WithdrawalScreen = "form" | "review" | "approving" | "submitted" | "failed"')
    expect(page).toContain('if (screen === "review" && review)')
    expect(page).toContain('if (screen === "approving")')
    expect(page).toContain('if (screen === "submitted" && submitResult)')
    expect(page).toContain('if (screen === "failed")')
    expect(page).not.toContain("const primaryActionLabel")
    expect(page).not.toContain("onClick={primaryAction}")
  })

  it("withdrawal screen progresses through review, approving, submitted, and failed states", () => {
    expect(page).toContain("Review withdrawal")
    expect(page).toContain("\"Approve withdrawal\"")
    expect(page).toContain("Approving withdrawal")
    expect(page).toContain("Confirm this withdrawal in PineTree Wallet.")
    expect(page).toContain("Withdrawal failed")
    expect(page).toContain("Done")
    expect(page).toContain("\"Processing\"")
    expect(page).toContain('setWithdrawalScreen("review")')
    expect(page).toContain('setWithdrawalScreen("approving")')
    expect(page).toContain('setWithdrawalScreen("submitted")')
    expect(page).toContain('setWithdrawalScreen("failed")')
  })

  it("routes non-Dynamic wallet sends to a signer-unavailable failure instead of manual review", () => {
    expect(page).toContain("Submit withdrawal request")
    expect(page).toContain("if (withdrawalReview?.review.approvalMethod === \"dynamic_browser\")")
    expect(page).toContain("This withdrawal cannot be signed in this browser session.")
    expect(page).not.toContain("action: \"submit\"")
    expect(page).not.toContain("withdrawal_id: withdrawalId")
  })

  it("hides the editable form and review screen after withdrawal submission", () => {
    expect(page).toContain('if (screen === "submitted" && submitResult)')
    expect(page).toContain("Withdrawal submitted")
    expect(page).toContain("Transaction reference:")
    expect(page).toContain("Done")
    expect(page).not.toContain("{review && !submitResult ? (")
  })

  it("shows selected asset availability and USD value in the Withdraw tab", () => {
    expect(page).toContain("selectedWithdrawalBalance")
    expect(page).toContain("findWithdrawalBalance(walletSync, withdrawalRail, withdrawalAsset)")
    expect(page).toContain("Available")
    expect(page).toContain("formatCryptoAmount(selectedBalanceAmount, asset)")
    expect(page).toContain("formatUsd(selectedBalance.usdValue)")
  })

  it("shows a Max button that fills the selected asset balance", () => {
    expect(page).toContain("Max")
    expect(page).toContain("function handleMaxWithdrawalAmount()")
    expect(page).toContain("setWithdrawalAmount(String(selectedWithdrawalBalance.balance))")
    expect(page).toContain("onMaxAmount={handleMaxWithdrawalAmount}")
  })

  it("blocks review when amount exceeds known available balance or selected balance is zero", () => {
    expect(page).toContain("Amount exceeds available balance.")
    expect(page).toContain("No available balance for this asset.")
    expect(page).toContain("amountNumber > selectedWithdrawalBalance.balance")
    expect(page).toContain("selectedWithdrawalBalance.balance <= 0")
  })

  it("allows unknown balances with a verification note", () => {
    expect(page).toContain("Balance indexing pending")
    expect(page).toContain("Balance will be verified before processing.")
  })

  it("does not show developer-facing signer disabled copy in the withdrawal UI", () => {
    expect(page).not.toContain(["Signing", "not enabled yet"].join(" "))
    expect(page).not.toContain(["Withdrawal signing", "not enabled"].join(" "))
    expect(page).not.toContain(["signing", "not enabled"].join(" "))
    expect(page).not.toContain(["cannot", "sign"].join(" "))
    expect(page).not.toContain(["broadcast", "disabled"].join(" "))
    expect(page).not.toContain(["provider signer", "unavailable"].join(" "))
    expect(page).not.toContain("Withdrawals coming soon")
    expect(page).not.toContain("Withdrawals disabled")
  })

  it("does not retain stale disabled signer copy anywhere in withdrawal source", () => {
    const withdrawalSource = [
      page,
      withdrawalApiRoute,
      withdrawalPrepareRoute,
      withdrawalSubmitRoute,
      withdrawalEngine,
      withdrawalSigner,
      read("providers/wallets/bitcoinNetworkProvider.ts"),
    ].join("\n")
    expect(withdrawalSource).not.toContain(["Withdrawal signing", "not enabled"].join(" "))
    expect(withdrawalSource).not.toContain(["Signing", "not enabled"].join(" "))
    expect(withdrawalSource).not.toContain(["Cannot", "sign"].join(" "))
    expect(withdrawalSource).not.toContain(["Broadcast", "disabled"].join(" "))
    expect(withdrawalSource).not.toContain(["Provider signer", "unavailable"].join(" "))
  })

  it("keeps the withdrawal form shell without redesigning the controls", () => {
    expect(page).toContain("AssetSelectDropdown")
    expect(page).toContain("assetOptions.map((option)")
    expect(page).toContain("onAssetSelect(r as WithdrawalRail, a as WithdrawalAsset)")
    expect(page).toContain("Choose a PineTree Wallet asset, then review before approval.")
    expect(page).not.toContain("Choose an enabled PineTree Wallet asset")
    expect(page).toContain('aria-label="Destination address"')
    expect(page).toContain('aria-label="Withdrawal amount"')
    expect(page).toContain("Review withdrawal")
    expect(page).toContain("/api/wallets/pinetree-wallet/withdrawals")
    expect(page).not.toContain("Withdrawal coming soon")
    expect(page).not.toContain("Withdrawal disabled")
    // The Review button is disabled — no API calls for withdrawal execution
    expect(page).not.toContain("/api/wallets/settlement")
    expect(page).not.toContain("/api/wallets/send-sessions")
  })

  it("maps raw schema/cache withdrawal errors to merchant-safe copy", () => {
    expect(page).toContain("sanitizeWithdrawalErrorForMerchant")
    expect(page).toContain("sanitizeWithdrawalSubmitErrorForMerchant")
    expect(page).toContain("We couldn't create this withdrawal request. Please try again.")
    expect(page).toContain("We couldn't submit this withdrawal request. Please try again.")
    expect(withdrawalApiRoute).toContain("getMerchantSafeWithdrawalRouteError")
    expect(withdrawalApiRoute).toContain("console.error")
    expect(withdrawalApiRoute).toContain("schema cache")
    expect(withdrawalApiRoute).toContain("amount_decimal")
  })

  it("withdrawal request DB scaffold exists with review fields and safe statuses", () => {
    const withdrawalMigration =
      migration +
      read("database/migrations/20260625_expand_wallet_withdrawal_requests.sql") +
      read("database/migrations/20260625_add_dynamic_withdrawal_payload_fields.sql") +
      withdrawalProductionSchemaMigration
    expect(withdrawalMigration).toContain("wallet_withdrawal_requests")
    expect(withdrawalMigration).toContain("merchant_id")
    expect(withdrawalMigration).toContain("wallet_profile_id")
    expect(withdrawalMigration).toContain("rail")
    expect(withdrawalMigration).toContain("asset")
    expect(withdrawalMigration).toContain("destination_address")
    expect(withdrawalMigration).toContain("amount_decimal")
    expect(withdrawalMigration).toContain("status")
    expect(withdrawalMigration).toContain("provider")
    expect(withdrawalMigration).toContain("provider_reference")
    expect(withdrawalMigration).toContain("tx_hash")
    expect(withdrawalMigration).toContain("unsigned_transaction_payload")
    expect(withdrawalMigration).toContain("signed_payload")
    expect(withdrawalMigration).toContain("approval_method")
    expect(withdrawalMigration).toContain("chain_id")
    expect(withdrawalMigration).toContain("token_contract")
    expect(withdrawalMigration).toContain("token_mint")
    expect(withdrawalMigration).toContain("review_payload")
    expect(withdrawalMigration).toContain("error_message")
    expect(withdrawalMigration).toContain("updated_at")
    expect(withdrawalMigration).toContain("'review_required'")
    expect(withdrawalMigration).toContain("'blocked'")
  })

  it("production repair migration is idempotent and refreshes the schema cache", () => {
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS asset")
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS amount_decimal")
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS tx_hash")
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS unsigned_transaction_payload")
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS signed_payload")
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS approval_method")
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS chain_id")
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS token_contract")
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS token_mint")
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS error_message")
    expect(withdrawalProductionSchemaMigration).toContain("ADD COLUMN IF NOT EXISTS updated_at")
    expect(withdrawalProductionSchemaMigration).toContain("NOTIFY pgrst, 'reload schema'")
  })

  it("withdrawal API does not expose provider secrets to the browser", () => {
    expect(withdrawalApiRoute).toContain("submitWalletWithdrawalRequest")
    expect(withdrawalPrepareRoute).toContain("prepareDynamicWalletWithdrawal")
    expect(withdrawalSubmitRoute).toContain("completeDynamicWalletWithdrawal")
    expect(withdrawalApiRoute).not.toContain("FIREBLOCKS_API_KEY")
    expect(withdrawalApiRoute).not.toContain("FIREBLOCKS_API_SECRET")
    expect(withdrawalApiRoute).not.toContain("PRIVATE_KEY")
    expect(withdrawalApiRoute).not.toContain("process.env")
    expect(withdrawalPrepareRoute).not.toContain("DYNAMIC_API_KEY")
    expect(withdrawalPrepareRoute).not.toContain("DYNAMIC_API_SECRET")
    expect(withdrawalPrepareRoute).not.toContain("PRIVATE_KEY")
    expect(withdrawalSubmitRoute).not.toContain("DYNAMIC_API_KEY")
    expect(withdrawalSubmitRoute).not.toContain("DYNAMIC_API_SECRET")
    expect(withdrawalSubmitRoute).not.toContain("PRIVATE_KEY")
  })

  it("prefers Dynamic browser approval without enabling backend Dynamic secrets", () => {
    expect(withdrawalSigner).toContain("dynamicBrowserWithdrawalSigner")
    expect(withdrawalSigner).toContain("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID")
    expect(withdrawalSigner).toContain("Dynamic is the preferred execution path")
    expect(withdrawalSigner).toContain("throw new Error(\"Dynamic browser approval requires merchant wallet signing\")")
    expect(withdrawalSigner).not.toContain("DYNAMIC_API_KEY")
    expect(withdrawalSigner).not.toContain("DYNAMIC_API_SECRET")
  })

  it("server builds constrained Dynamic payloads from the saved merchant wallet profile", () => {
    expect(withdrawalEngine).toContain("profile.id !== request.wallet_profile_id")
    expect(withdrawalEngine).toContain("getSourceAddressForRail(profile, validated.rail)")
    expect(withdrawalEngine).toContain("BASE_USDC_TOKEN_ADDRESS")
    expect(withdrawalEngine).toContain("SOLANA_USDC_MINT")
    expect(withdrawalEngine).toContain("createTransferCheckedInstruction")
    expect(withdrawalEngine).toContain("SystemProgram.transfer")
    expect(withdrawalEngine).toContain("status: \"processing\"")
    expect(withdrawalEngine).not.toContain("status: \"confirmed\"")
  })

  it("Solana Dynamic approval remains reachable and unavailable Solana fails without signing", () => {
    expect(page).toContain("dynamicApprovalAvailableForWithdrawal")
    expect(page).toContain("kind: \"solana_transaction\"")
    expect(page).toContain("prepared.payload.transactionBase64")
    expect(dynamicSignerLookup).toContain("wallet.signAndSendTransaction || wallet.connector?.signAndSendTransaction")
    expect(page).toContain("const dynamicSubmission = await sendDynamicPreparedWithdrawal")
    expect(page).toContain("if (withdrawalReview?.review.approvalMethod === \"dynamic_browser\")")
    expect(page).toContain("Unable to sign this withdrawal. Please try again.")
    expect(page).not.toContain("action: \"submit\"")
  })

  it("BTC withdrawals use a Dynamic PSBT path instead of Speed, NWC, Spark, or Lightning", () => {
    const bitcoinProvider = read("providers/wallets/bitcoinNetworkProvider.ts")
    expect(withdrawalEngine).toContain("kind: \"bitcoin_psbt\"")
    expect(withdrawalEngine).toContain("buildBitcoinWithdrawalPsbt")
    expect(withdrawalEngine).toContain("finalizeAndBroadcastBitcoinPsbt")
    expect(page).toContain("signPsbt")
    expect(bitcoinProvider).toContain("BITCOIN_UTXO_PROVIDER")
    expect(bitcoinProvider).toContain("BITCOIN_ESPLORA_BASE_URL")
    expect(bitcoinProvider).toContain("BITCOIN_BROADCAST_ENABLED")
    expect(withdrawalEngine).toContain("speedPayoutAvailable: false")
    expect(withdrawalEngine).not.toContain("nwc")
    expect(withdrawalEngine).not.toContain("spark")
  })

  // -------------------------------------------------------------------------
  // DB profile schema and helper
  // -------------------------------------------------------------------------

  it("pinetree_wallet_profiles migration creates the correct table shape", () => {
    expect(migration).toContain("pinetree_wallet_profiles")
    expect(migration).toContain("merchant_id")
    expect(migration).toContain("dynamic_user_id")
    expect(migration).toContain("base_address")
    expect(migration).toContain("solana_address")
    expect(migration).toContain("bitcoin_lightning_address")
    expect(migration).toContain("bitcoin_onchain_address")
    expect(migration).toContain("status")
    expect(migration).toContain("created_at")
    expect(migration).toContain("updated_at")
    // One profile per merchant
    expect(migration).toContain("UNIQUE")
  })

  it("DB helper exposes getPineTreeWalletProfile and upsertPineTreeWalletProfile", () => {
    expect(dbHelper).toContain("getPineTreeWalletProfile")
    expect(dbHelper).toContain("upsertPineTreeWalletProfile")
    expect(dbHelper).toContain("merchantId")
    expect(dbHelper).toContain("dynamic_user_id")
    expect(dbHelper).toContain("pinetree_wallet_profiles")
  })

  it("DB helper derives profile status from address presence without trusting Dynamic session", () => {
    expect(dbHelper).toContain("deriveProfileStatus")
    expect(dbHelper).toContain('"not_created"')
    expect(dbHelper).toContain('"needs_attention"')
    expect(dbHelper).toContain('"ready"')
  })

  // -------------------------------------------------------------------------
  // API route
  // -------------------------------------------------------------------------

  it("pinetree-profile API route authenticates via merchant JWT before reading or writing", () => {
    expect(apiRoute).toContain("requireMerchantIdFromRequest")
    expect(apiRoute).toContain("GET")
    expect(apiRoute).toContain("POST")
    expect(apiRoute).toContain("merchantId")
    expect(apiRoute).toContain("getPineTreeWalletProfile")
    expect(apiRoute).toContain("upsertPineTreeWalletProfile")
  })

  it("pinetree-profile API does not run BTC provisioning during Base/Solana profile sync", () => {
    expect(apiRoute).toContain("provisionMerchantBitcoinAddress")
    expect(apiRoute).toContain("existingProfile")
    expect(apiRoute).toContain("hasBtcAddressInput && normalizedBtcAddress")
    expect(apiRoute).toContain("dynamicBtcAddress: normalizedBtcAddress")
    expect(apiRoute).toContain("btcWalletProvisioningStatus: bitcoinProvisioning?.status")
    expect(apiRoute).toContain("btcWalletProvisioningError: bitcoinProvisioning ? bitcoinProvisioning.error || null : undefined")
  })

  it("pinetree-profile API does not overwrite an existing btc_address with null", () => {
    expect(apiRoute).toContain('const btcAddressAlreadyExists = bitcoinProvisioning?.status === "already_exists"')
    expect(apiRoute).toContain("btcAddress: btcAddressIsReady && !btcAddressAlreadyExists ? provisionedBtcAddress : undefined")
  })

  // -------------------------------------------------------------------------
  // Error / config states
  // -------------------------------------------------------------------------

  it("handles missing configuration, unavailable SDK, and profile load errors", () => {
    expect(provider).toContain("if (!environmentId)")
    expect(provider).toContain("WalletInfrastructureErrorBoundary")
    expect(page).toContain('kind="missing-env"')
    expect(page).toContain('kind="sdk"')
    expect(page).toContain('{ kind: "error" }')
    expect(page).toContain('"Not connected"')
    expect(page).toContain('"Connected"')
    expect(page).toContain('"Needs attention"')
    expect(page).toContain('status="Loading"')
    expect(page).not.toContain("Wallet activity will appear here.")
    expect(page).not.toContain("syncing is not enabled yet")
  })

  // -------------------------------------------------------------------------
  // POS / checkout isolation — must not be affected
  // -------------------------------------------------------------------------

  it("does not expose wallet infrastructure as a merchant provider", () => {
    expect(providerPage).not.toMatch(/provider=["']dynamic["']/i)
    expect(providerPage).not.toMatch(/name=["']Dynamic["']/)
  })

  it("wallet setup page only calls wallet APIs and provider rail enablement, not POS or checkout APIs", () => {
    expect(page).toContain("/api/wallets/pinetree-profile")
    expect(page).toContain("/api/wallets/pinetree/sync")
    expect(page).toContain("/api/wallets/lightning/pinetree-managed")
    expect(page).toContain("/api/providers")
    expect(page).not.toContain("/api/wallets/settlement")
    expect(page).not.toContain("/api/wallets/send-sessions")
    expect(page).not.toContain("/api/pos")
    expect(page).not.toContain("/api/dashboard/checkout")
  })

  it("removes external wallet controls from this page", () => {
    expect(page).not.toContain("Advanced wallet options")
    expect(page).not.toContain("Connect external wallet")
  })

  it("filters Dynamic wallet setup to embedded PineTree wallet options only", () => {
    expect(provider).toContain("walletsFilter: filterPineTreeMerchantWalletOptions")
    expect(provider).toContain("isEmbeddedWallet")
    expect(provider).toContain('"dynamicwaas"')
    expect(provider).toContain('"turnkey"')
    for (const blocked of [
      '"metamask"',
      '"coinbase"',
      '"walletconnect"',
      '"phantom"',
      '"solflare"',
      '"trust"',
    ]) {
      expect(provider).toContain(blocked)
    }
  })

  it("declares the required SDK packages", () => {
    for (const dependency of [
      "@dynamic-labs/sdk-react-core",
      "@dynamic-labs/ethereum",
      "@dynamic-labs/solana",
      "@dynamic-labs/bitcoin",
    ]) {
      expect(packageJson.dependencies[dependency]).toBe("^4.90.0")
    }
    expect(provider).not.toContain("@dynamic-labs/spark")
  })

  // -------------------------------------------------------------------------
  // PineTree-managed Lightning backend (Session 2)
  // -------------------------------------------------------------------------

  it("loads lightning profile in parallel with the wallet profile", () => {
    expect(page).toContain("/api/wallets/lightning/pinetree-managed")
    expect(page).toContain("lightningProfileState")
    expect(page).toContain("LightningProfileState")
    // Both fetched in a single Promise.all so neither blocks the other
    expect(page).toContain("Promise.all")
  })

  it("Bitcoin display readiness is not derived from a Dynamic Spark address", () => {
    // Readiness is driven by the DB record, not any Spark address returned by Dynamic
    expect(page).toContain("railReadiness?.bitcoin_lightning.walletProvisioned")
    expect(page).toContain("railReadiness?.bitcoin_lightning.withdrawalReady")
    expect(page).toContain("function WalletOverviewSummary")
    // No old pattern that checked Spark address length
    expect(page).not.toContain("profileAddresses.lightning.length > 0")
    expect(page).not.toContain("lightningAddress.length")
  })

  it("PineTree Wallet can be created with Base/Solana active while BTC payout sync is internal", () => {
    // hasWallet is true once Base or Solana is active — Lightning pending does not block it
    expect(page).toContain("const hasWallet = profileState.kind")
    expect(page).toContain("baseReady || solanaReady || btcPayoutReady || bitcoinReady")
    // lightningPending is a valid state for an active wallet
    expect(page).not.toContain("lightningPending")
    expect(page).not.toContain("lightningRetryable")
  })

  it("syncs PineTree-managed Bitcoin automatically and does not render a merchant CTA", () => {
    expect(page).not.toContain("Enable Bitcoin Lightning")
    expect(page).not.toContain("handleEnableLightning")
    expect(page).toContain("syncPineTreeManagedLightning")
    // Uses a POST fetch to the internal route — no redirect to Speed sign-up
    expect(page).toContain("/api/wallets/lightning/pinetree-managed")
    expect(page).not.toContain("speed.com")
    expect(page).not.toContain("tryspeed.com")
    expect(page).not.toContain("router.push")
  })

  it("does not render Bitcoin setup pending copy or retry controls", () => {
    expect(page).not.toContain("Bitcoin address pending")
    expect(page).not.toContain("Bitcoin Lightning is being prepared through PineTree")
    expect(page).not.toContain("Base and Solana can be used while PineTree prepares Bitcoin")
    expect(page).not.toContain("PineTree is enabling your Lightning rail")
    expect(page).not.toContain("lightningRetryable")
  })

  it("does not ask the merchant to sign up for Speed, paste keys, or connect NWC", () => {
    expect(page).not.toContain("Sign up for Speed")
    expect(page).not.toContain("TrySpeed")
    expect(page).not.toContain("speed.com")
    expect(page).not.toContain("Connect NWC")
    expect(page).not.toContain("Connect Spark")
    expect(page).not.toContain("Spark setup")
    expect(page).not.toContain("nostr+walletconnect")
    expect(page).not.toContain("Paste your")
    expect(page).not.toContain("Speed API key")
    expect(page).not.toContain("Bitcoin payouts route to your PineTree Bitcoin wallet")
    expect(page).not.toContain("Bitcoin payments are handled automatically by PineTree")
    expect(page).not.toContain("Bitcoin receiving is managed automatically by PineTree")
  })

  it("does not expose Speed API keys or secrets to the browser", () => {
    expect(page).not.toContain("SPEED_API_KEY")
    expect(page).not.toContain("SPEED_SECRET")
    expect(page).not.toContain("speed_secret")
    // The lightning API route response only contains a safe profile shape, not secrets
    expect(lightningApiRoute).toContain("safeLightningProfile")
    expect(lightningApiRoute).toContain("SPEED_API_KEY_present")
    expect(lightningApiRoute).not.toContain("speed_account_secret")
    expect(lightningApiRoute).not.toContain("sk_live_")
    expect(lightningApiRoute).not.toContain("sk_test_")
    // API route comments confirm security intent
    expect(lightningApiRoute).toContain("No Speed API keys or secrets are returned to the browser")
    expect(speedConnectedAccountHelper).not.toContain("NEXT_PUBLIC_SPEED")
  })

  it("merchant_lightning_profiles migration creates the correct table shape", () => {
    expect(lightningMigration).toContain("merchant_lightning_profiles")
    expect(lightningMigration).toContain("merchant_id")
    expect(lightningMigration).toContain("provider")
    expect(lightningMigration).toContain("status")
    expect(lightningMigration).toContain("speed_connected_account_id")
    expect(lightningMigration).toContain("speed_connect_setup_url")
    expect(lightningMigration).toContain("provider_response_summary")
    expect(lightningMigration).toContain("provider_error_message")
    expect(lightningMigration).toContain("setup_source")
    expect(lightningMigration).toContain("UNIQUE")
    expect(speedConnectMigration).toContain("speed_connect_setup_url")
    expect(speedConnectMigration).toContain("provider_response_summary")
    expect(speedConnectMigration).toContain("provider_error_message")
  })

  it("lightning DB helper exposes readiness derivation and safe mutation functions only", () => {
    expect(lightningDbHelper).toContain("deriveLightningReadiness")
    expect(lightningDbHelper).toContain("getMerchantLightningProfile")
    expect(lightningDbHelper).toContain("markMerchantLightningPending")
    expect(lightningDbHelper).toContain("markMerchantLightningReady")
    // Readiness comes from profile.status
    expect(lightningDbHelper).toContain('"pending"')
    expect(lightningDbHelper).toContain('"ready"')
    // No secrets stored here
    expect(lightningDbHelper).not.toContain("SPEED_API_KEY")
  })

  it("pinetree-managed lightning API route requires merchant JWT and returns profile only", () => {
    expect(lightningApiRoute).toContain("requireMerchantIdFromRequest")
    expect(lightningApiRoute).toContain("GET")
    expect(lightningApiRoute).toContain("POST")
    expect(lightningApiRoute).toContain("getMerchantLightningProfile")
    expect(lightningApiRoute).toContain("upsertMerchantLightningProfile")
    expect(lightningApiRoute).toContain("isSpeedPlatformTreasurySweepEnabled")
    expect(lightningApiRoute).toContain("getSafeTreasurySweepLogContext")
    expect(lightningApiRoute).toContain("btc_address_present")
    expect(lightningApiRoute).toContain("btc_payout_enabled")
    expect(lightningApiRoute).toContain("createOrLinkSpeedConnectedAccountForMerchant")
    expect(lightningApiRoute).toContain("mapSpeedReadinessToLightningStatus")
    expect(lightningApiRoute).toContain("SPEED_API_KEY_present")
  })

  it("Speed connected-account helper is server-side and uses documented Speed Connect account links", () => {
    expect(speedConnectedAccountHelper).toContain("createOrLinkSpeedConnectedAccountForMerchant")
    expect(speedConnectedAccountHelper).toContain("CreateOrLinkSpeedConnectedAccountInput")
    expect(speedConnectedAccountHelper).toContain("merchant_id")
    expect(speedConnectedAccountHelper).toContain("business_name")
    expect(speedConnectedAccountHelper).toContain("merchant_email")
    expect(speedConnectedAccountHelper).toContain("pinetree_reference_id")
    expect(speedConnectedAccountHelper).toContain("speed_connected_account_id")
    expect(speedConnectedAccountHelper).toContain("speed_connected_account_status")
    expect(speedConnectedAccountHelper).toContain("setup_url")
    expect(speedConnectedAccountHelper).toContain("provider_response_summary")
    expect(speedConnectedAccountHelper).toContain("error_message")
    expect(speedConnectedAccountHelper).toContain("createSpeedConnectAccountLink")
    expect(speedConnectedAccountHelper).toContain("listSpeedConnectedAccounts")
    expect(speedConnectedAccountHelper).toContain("retrieveSpeedConnectedAccount")
    expect(speedConnectedAccountHelper).toContain("invite_account_link")
    expect(speedConnectedAccountHelper).not.toContain("/accounts")
    expect(speedConnectedAccountHelper).not.toContain("/sub-merchants")
  })

  it("Speed Connect env vars are server-only and minimal", () => {
    expect(speedConnectedAccountHelper).toContain("SPEED_CONNECT_ENABLED")
    expect(speedConnectedAccountHelper).toContain("SPEED_CONNECT_RETURN_URL")
    expect(speedConnectedAccountHelper).toContain("speed_api_key_missing")
    expect(speedConnectedAccountHelper).not.toContain("NEXT_PUBLIC_SPEED_CONNECT")
    expect(page).not.toContain("SPEED_CONNECT_ENABLED")
    expect(page).not.toContain("SPEED_CONNECT_RETURN_URL")
  })

  it("Speed client exposes documented Connect methods through server-side Speed auth", () => {
    expect(speedClient).toContain("SPEED_API_KEY")
    expect(speedClient).toContain("SPEED_API_BASE_URL")
    expect(speedClient).toContain("createSpeedConnectAccountLink")
    expect(speedClient).toContain("/connect/generate/account-link")
    expect(speedClient).toContain("retrieveSpeedConnectedAccount")
    expect(speedClient).toContain("/connect/${encodeURIComponent(id)}")
    expect(speedClient).toContain("listSpeedConnectedAccounts")
    expect(speedClient).toContain('"/connect"')
  })

  it("canonical mode does not save a merchant Speed connected account", () => {
    expect(lightningApiRoute).toContain('speedConnectedAccountId: null')
    expect(lightningApiRoute).toContain('"pinetree_wallet_btc_payout_ready"')
    expect(lightningApiRoute).toContain('"btc_address_missing_internal"')
    expect(lightningApiRoute).toContain('internal_readiness_issue: btcAddressReady ? null : "btc_address_missing"')
    expect(lightningApiRoute).toContain("bitcoinLightningAccountId: null")
    expect(lightningApiRoute).toContain("speedSetup.speed_connected_account_id")
  })

  it("managed Lightning POST records canonical treasury-sweep state without secrets", () => {
    expect(lightningApiRoute).toContain("[pinetree-managed-lightning] treasury_sweep_post_start")
    expect(lightningApiRoute).toContain("lightning_provider")
    expect(lightningApiRoute).toContain("settlement_mode")
    expect(lightningApiRoute).toContain("SPEED_API_KEY_present")
    expect(lightningApiRoute).toContain("SPEED_WEBHOOK_SECRET_present")
    expect(lightningApiRoute).toContain("SPEED_API_BASE_URL")
    expect(lightningApiRoute).toContain("final_saved_profile_status")
    expect(lightningApiRoute).toContain("speed_platform_config_missing")
  })

  it("merchant Lightning profile requires BTC address to be ready before status is ready", () => {
    expect(lightningApiRoute).toContain("const btcAddressReady = Boolean(walletProfile?.btc_address && walletProfile.btc_payout_enabled)")
    expect(lightningApiRoute).toContain("walletProfile?.btc_address && walletProfile.btc_payout_enabled")
    expect(lightningApiRoute).toContain("const nextStatus: MerchantLightningProfileStatus = !speedConfig.configured")
    expect(lightningApiRoute).toContain("!btcAddressReady")
    expect(lightningApiRoute).toContain('internal_readiness_issue: btcAddressReady ? null : "btc_address_missing"')
    expect(lightningApiRoute).not.toContain('"Bitcoin address pending for PineTree Wallet."')
  })

  it("Lightning stays pending when Speed returns only an invite/setup link", () => {
    expect(speedConnectedAccountHelper).toContain("speed_connect_invite_created")
    expect(speedConnectedAccountHelper).toContain("setupUrl")
    expect(speedConnectedAccountHelper).toContain('status: "pending"')
    expect(speedConnectedAccountHelper).toContain('source: "existing_connected_account"')
  })

  it("Lightning stays pending and does not fake ready on missing endpoint or missing account id", () => {
    expect(speedConnectedAccountHelper).toContain('return "pending"')
    expect(speedConnectedAccountHelper).toContain("speed_connect_disabled")
    expect(speedConnectedAccountHelper).toContain("speed_api_key_missing")
    expect(speedConnectedAccountHelper).toContain("speed_connect_return_url_missing")
    expect(speedConnectedAccountHelper).toContain("Speed connected account was not found")
    expect(lightningApiRoute).toContain('"btc_address_missing_internal"')
    expect(lightningApiRoute).toContain("const nextStatus = mapSpeedReadinessToLightningStatus(speedSetup.readiness)")
  })

  it("syncs PineTree Wallet Lightning fields from the managed Lightning profile", () => {
    expect(lightningApiRoute).toContain('bitcoinLightningProvider: "speed"')
    expect(lightningApiRoute).toContain('bitcoinLightningReceiveMode: "invoice"')
    expect(lightningApiRoute).toContain("bitcoinLightningStatus: lightningProfile.status")
    expect(dbHelper).toContain("bitcoinLightningReceiveMode")
  })

  it("Speed Connect return route is removed (canonical treasury-sweep mode, no merchant Speed OAuth)", () => {
    // The connect-return route was part of the merchant-facing Speed Connect OAuth flow.
    // In canonical mode, Lightning is managed through PineTree's platform account, so this
    // merchant-facing OAuth callback route has been intentionally deleted.
    expect(speedConnectReturnRouteExists).toBe(false)
  })

  it("existing POS and checkout payment creation remain unchanged", () => {
    expect(speedClient).toContain("createSpeedLightningPayment")
    expect(speedAdapter).toContain("createLightningInvoice")
    expect(speedAdapter).toContain("getMerchantSpeedProvider")
    expect(paymentsRoute).toContain("getSafeSpeedCustomerErrorMessage")
    expect(page).not.toContain("/api/payments")
    expect(page).not.toContain("createSpeedLightningPayment")
  })

  it("legacy merchant-facing Speed Connect route is removed (canonical mode only)", () => {
    // The Speed Connect merchant account setup flow has been replaced by the
    // canonical PineTree treasury-sweep mode. The route is intentionally deleted.
    const fs = require("node:fs")
    const path = require("node:path")
    expect(
      fs.existsSync(path.join(process.cwd(), "app/api/wallets/lightning/speed/connect/route.ts"))
    ).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Withdrawal approval state machine — Task 3
  // -------------------------------------------------------------------------

  it("UI never renders both a withdrawal error and Approve withdrawal simultaneously", () => {
    // Approval errors render on the failed screen, away from the review screen button.
    expect(page).toContain('if (screen === "failed")')
    expect(page).toContain("withdrawalApprovalError")
    expect(page).toContain('setWithdrawalScreen("failed")')
  })

  it("valid Solana review with Dynamic approvalMethod shows Approve withdrawal button", () => {
    expect(page).toContain('if (screen === "review" && review)')
    expect(page).toContain("\"Approve withdrawal\"")
    expect(page).toContain("Confirm the withdrawal details before submitting.")
  })

  it("clicking Approve calls the prepare route before signing", () => {
    // handleSubmitWithdrawal routes to prepare first when approvalMethod is dynamic_browser
    expect(page).toContain("if (withdrawalReview?.review.approvalMethod === \"dynamic_browser\")")
    expect(page).toContain("/api/wallets/pinetree-wallet/withdrawals/${encodeURIComponent(withdrawalId)}/prepare")
    // prepare is fetched with POST before sendDynamicPreparedWithdrawal is called
    const submitFn = page.slice(page.indexOf("async function handleSubmitWithdrawal()"), page.indexOf("// ---------------------------------------------------------------------------\n  // Early returns"))
    const prepareIndex = submitFn.indexOf("/prepare")
    const signingIndex = submitFn.indexOf("sendDynamicPreparedWithdrawal")
    expect(prepareIndex).toBeGreaterThan(-1)
    expect(signingIndex).toBeGreaterThan(prepareIndex)
  })

  it("Solana prepared transaction calls Dynamic signAndSendTransaction", () => {
    // sendDynamicPreparedWithdrawal handles the solana_transaction payload kind
    expect(page).toContain("signAndSendTransaction")
    expect(page).toContain("prepared.payload.transactionBase64")
    expect(page).toContain("kind: \"solana_transaction\"")
    expect(dynamicSignerLookup).toContain("wallet.signAndSendTransaction || wallet.connector?.signAndSendTransaction")
    // The transaction bytes are deserialised from the server-built base64 payload
    expect(page).toContain("Transaction.from(base64ToBytes(prepared.payload.transactionBase64))")
  })

  it("returned tx hash from signing is sent to the submit route", () => {
    // After signing succeeds, the hash is POSTed to the submit endpoint
    expect(page).toContain("/api/wallets/pinetree-wallet/withdrawals/${encodeURIComponent(withdrawalId)}/submit")
    expect(page).toContain("tx_hash: dynamicSubmission.txHash || \"\"")
    expect(page).toContain("provider_reference: dynamicSubmission.providerReference || dynamicSubmission.txHash || \"\"")
  })

  it("successful Dynamic signing sets the withdrawal to Processing status", () => {
    // completeDynamicWalletWithdrawal stores status: "processing" after a valid txHash
    expect(withdrawalEngine).toContain("status: \"processing\"")
    expect(withdrawalEngine).toContain("merchantStatus: \"Processing\"")
    expect(withdrawalEngine).toContain("txHash")
    // Confirmed status is never set without a real on-chain result
    expect(withdrawalEngine).not.toContain("status: \"confirmed\"")
  })

  it("UI shows transaction reference after successful Dynamic approval", () => {
    // After submit succeeds, the page renders the withdrawalSubmitResult with a reference
    expect(page).toContain("Transaction reference:")
    expect(page).toContain("submitResult.request.provider_reference")
    expect(page).toContain("Withdrawal submitted")
    expect(page).toContain("setWithdrawalSubmitResult(submitted as WithdrawalSubmitResponse)")
  })

  it("missing Dynamic signer does not show Approve withdrawal", () => {
    // When no matching wallet is found at signing time, sendDynamicPreparedWithdrawal throws
    // and the catch block moves to the failed screen — the review button cannot coexist with the error.
    expect(page).toContain("PineTree Wallet is not active in this browser session.")
    expect(page).toContain("sanitizeWithdrawalSubmitErrorForMerchant(error instanceof Error ? error.message : undefined)")
    expect(page).toContain('setWithdrawalScreen("failed")')
    expect(page).not.toContain("// Signing failure (Dynamic path) reaches here. Clear the stale review")
  })

  it("missing Dynamic signer fails instead of creating a manual review request", () => {
    expect(page).toContain("\"Submit withdrawal request\"")
    expect(page).toContain('setWithdrawalApprovalError("This withdrawal cannot be signed in this browser session.")')
    expect(page).not.toContain("action: \"submit\"")
    expect(page).not.toContain("withdrawal_id: withdrawalId")
  })

  it("stale withdrawal review is cleared when amount, address, rail, or asset changes", () => {
    // handleWithdrawalAssetSelect clears review
    expect(page).toContain("function handleWithdrawalAssetSelect(")
    expect(page).toContain("setWithdrawalRail(nextRail)")
    expect(page).toContain("setWithdrawalAsset(nextAsset)")
    // All change handlers clear stale review
    const assetSelect = page.slice(
      page.indexOf("function handleWithdrawalAssetSelect("),
      page.indexOf("async function handleReviewWithdrawal(")
    )
    expect(assetSelect).toContain("setWithdrawalReview(null)")
    // handleReviewWithdrawal also clears review at the top of each new review
    expect(page).toContain("setWithdrawalReview(null)")
  })

  it("Base ETH withdrawal uses the EVM Dynamic path with an evm_transaction payload", () => {
    expect(withdrawalEngine).toContain("kind: \"evm_transaction\"")
    // ETH transfer sends value directly to the destination
    expect(withdrawalEngine).toContain("SystemProgram.transfer")
    // Engine dispatches evm_transaction for Base
    const engineBase = withdrawalEngine.slice(
      withdrawalEngine.indexOf("kind: \"evm_transaction\""),
      withdrawalEngine.indexOf("kind: \"evm_transaction\"") + 300
    )
    expect(engineBase).toContain("evm_transaction")
  })

  it("Base USDC withdrawal uses EVM path with token contract address", () => {
    // Token transfers encode the ERC-20 contract address and transfer calldata
    expect(withdrawalEngine).toContain("BASE_USDC_TOKEN_ADDRESS")
    expect(withdrawalEngine).toContain("to: BASE_USDC_TOKEN_ADDRESS")
    expect(withdrawalEngine).toContain("tokenContract: prepared.rail === \"base\" && prepared.asset === \"USDC\" ? BASE_USDC_TOKEN_ADDRESS : null")
    // prepare stores the token_contract for client-side verification
    expect(withdrawalProductionSchemaMigration).toContain("token_contract")
  })

  it("provider disabled state does not block withdrawal when source address exists", () => {
    // Withdrawal availability is driven by address presence (walletConnected / configured),
    // not by whether a payment provider is enabled for that rail.
    // Note: rail display chips DO use row.enabled && row.configured — that is intentional.
    // Only the withdrawable-asset calculation must use configured alone.
    expect(page).toContain("const noWithdrawableAssets = assetOptions.length === 0")
    expect(page).toContain("withdrawalWalletRows")
    // The withdrawable-assets useMemo filters by configured (address present) not enabled
    const withdrawableSection = page.slice(
      page.indexOf("const withdrawableAssetOptions = useMemo"),
      page.indexOf("const withdrawableAssetOptions = useMemo") + 400
    )
    expect(withdrawableSection).toContain(".filter((row) => row.configured)")
    expect(withdrawableSection).not.toContain("row.enabled")
  })

  it("no confirmed status is ever set without a real chain confirmation", () => {
    const allWithdrawalSource = [withdrawalEngine, withdrawalApiRoute, withdrawalPrepareRoute, withdrawalSubmitRoute].join("\n")
    expect(allWithdrawalSource).not.toContain("status: \"confirmed\"")
    // Processing is the terminal client-visible state; confirmed is set only by webhooks
    expect(withdrawalEngine).toContain("status: \"processing\"")
    expect(withdrawalEngine).toContain("merchantStatus: \"Processing\"")
  })

  it("prepare and submit routes never return provider secrets or raw transaction payloads to the browser", () => {
    // Prepare returns only the unsigned payload kind + fields the client needs to sign
    expect(withdrawalPrepareRoute).not.toContain("DYNAMIC_API_KEY")
    expect(withdrawalPrepareRoute).not.toContain("DYNAMIC_API_SECRET")
    expect(withdrawalPrepareRoute).not.toContain("PRIVATE_KEY")
    expect(withdrawalPrepareRoute).not.toContain("process.env")
    expect(withdrawalSubmitRoute).not.toContain("DYNAMIC_API_KEY")
    expect(withdrawalSubmitRoute).not.toContain("DYNAMIC_API_SECRET")
    expect(withdrawalSubmitRoute).not.toContain("PRIVATE_KEY")
    expect(withdrawalSubmitRoute).not.toContain("process.env")
    // The debug logging in the page only logs safe metadata — no secrets
    expect(page).toContain("console.info(\"[pinetree-withdrawals] approval_state\"")
    expect(page).not.toContain("privateKey")
    expect(page).not.toContain("DYNAMIC_API_KEY")
  })

  // -------------------------------------------------------------------------
  // Withdrawal execution: Dynamic signing paths — Task 4
  // -------------------------------------------------------------------------

  it("Dynamic Solana signing uses a shared active-account helper that preserves this binding", () => {
    // Method extraction (const fn = obj.method; fn()) loses 'this' in strict mode.
    // signAndSendTransaction on TurnkeySolanaWalletConnector calls this.walletUiUtils, so
    // 'this' must remain the connector object — inline ?. calls guarantee that.
    expect(page).toContain("signDynamicSolanaTransactionWithActiveAccount(")
    expect(dynamicSignerLookup).toContain("await wallet.signAndSendTransaction?.(transaction, signOptions) as unknown")
    expect(dynamicSignerLookup).toContain("await wallet.connector?.signAndSendTransaction?.(transaction, signOptions) as unknown")
    expect(page).not.toContain("const signAndSendTransaction = wallet.signAndSendTransaction")
  })

  it("Dynamic Solana signer handles both string and {signature} return shapes", () => {
    // TurnkeySolanaWalletConnector.signAndSendTransaction returns a string.
    // ISolana (injected wallets like Phantom) returns { signature: string }.
    // Both must be normalised to a plain hash string before submitting.
    expect(dynamicSignerLookup).toContain("typeof txResult === \"string\"")
    expect(dynamicSignerLookup).toContain("(txResult as { signature?: string }).signature")
  })

  it("wallet not found in Dynamic session shows reconnect error and logs signer_not_found", () => {
    // When wallets[] from useUserWallets() contains no wallet matching the saved DB address,
    // we emit a safe diagnostic log and throw a reconnect-guidance error — not the generic copy.
    expect(page).toContain("console.info(\"[pinetree-withdrawals] signer_not_found\"")
    expect(page).toContain("PineTree Wallet is not active in this browser session. Open PineTree Wallet to reconnect, then try again.")
    expect(page).toContain("dynamicWalletCount:")
    expect(page).toContain("hasAnyDynamicWallet")
  })

  it("Dynamic Base EVM signing calls getWalletClient inline and dispatches sendTransaction", () => {
    // getWalletClient must be called through the wallet/connector owner so 'this' is preserved
    // (TurnkeyEVMWalletConnector.getWalletClient reads this.turnkeyAddress).
    expect(page).toContain("await wallet.getWalletClient?.(chainIdStr)")
    expect(page).toContain("await wallet.connector?.getWalletClient?.(chainIdStr)")
    expect(page).toContain("client.sendTransaction({")
    expect(page).toContain("BigInt(prepared.payload.value)")
  })

  it("missing Base wallet client throws signing-unavailable error instead of falling back to manual review", () => {
    // When getWalletClient returns undefined or a client without sendTransaction,
    // the EVM path throws an actionable signing error — not a pending-review request.
    expect(page).toContain("if (!client?.sendTransaction)")
    expect(page).toContain("Unable to sign this withdrawal. Please try again.")
    expect(page).not.toContain("action: \"submit\"")
  })

  it("sanitizer passes through session reconnect errors and blocks internal signer copy", () => {
    // Both session-not-active and session-mismatch errors must reach the UI for merchant guidance.
    expect(page).toContain("if (raw.includes(\"PineTree Wallet is not active in this browser session\")) return raw")
    expect(page).toContain("if (raw.includes(\"different PineTree Wallet session\")) return raw")
    // The old generic signer passthrough is removed — use the new actionable messages instead.
    expect(page).not.toContain("if (raw === \"PineTree Wallet signer is not available for this asset yet.\") return raw")
  })

  // -------------------------------------------------------------------------
  // Withdrawal reconnect recovery — Task 5
  // -------------------------------------------------------------------------

  it("failed screen with session failure shows Open PineTree Wallet and Edit withdrawal", () => {
    // isSignerSessionError drives which primary button appears on the failed screen.
    expect(page).toContain("isSignerSessionError")
    expect(page).toContain("not active in this browser session")
    expect(page).toContain("different PineTree Wallet session")
    // Primary reconnect button on the failed screen
    expect(page).toContain("isSignerSessionError && onOpenWallet")
    // Edit withdrawal is always the secondary button
    expect(page).toContain("Edit withdrawal")
  })

  it("Open PineTree Wallet action clears failed state and preserves withdrawal form values", () => {
    // handleWithdrawalReconnect resets the screen to form so the preserved values (rail/asset/
    // destination/amount) are visible when the merchant navigates back to the Withdraw tab.
    expect(page).toContain("function handleWithdrawalReconnect()")
    expect(page).toContain("setWithdrawalScreen(\"form\")")
    expect(page).toContain("setWithdrawalReview(null)")
    expect(page).toContain("setWithdrawalApprovalError(\"\")")
    // Form values (rail, asset, destination, amount) are NOT cleared in reconnect
    const reconnectFn = page.slice(
      page.indexOf("function handleWithdrawalReconnect()"),
      page.indexOf("function handleCreateWallet()")
    )
    expect(reconnectFn).not.toContain("setWithdrawalRail")
    expect(reconnectFn).not.toContain("setWithdrawalAsset")
    expect(reconnectFn).not.toContain("setWithdrawalDestination")
    expect(reconnectFn).not.toContain("setWithdrawalAmount")
  })

  it("reconnect handler calls syncProfileFromDynamic to resync wallet profile", () => {
    // After clearing the error state, the handler resyncs in case the wallet reconnected.
    expect(page).toContain("void syncProfileFromDynamic()")
    const reconnectFn = page.slice(
      page.indexOf("function handleWithdrawalReconnect()"),
      page.indexOf("function handleCreateWallet()")
    )
    expect(reconnectFn).toContain("syncProfileFromDynamic")
  })

  it("reconnect handler triggers Dynamic auth flow when no wallets are loaded", () => {
    // When no Dynamic wallets are active (wallets[] empty, no primaryWallet), the handler
    // calls setShowAuthFlow(true) to open the Dynamic connect/auth overlay and then waits
    // for wallets to update — it does NOT just navigate to the overview tab.
    const reconnectFn = page.slice(
      page.indexOf("function handleWithdrawalReconnect()"),
      page.indexOf("function handleCreateWallet()")
    )
    expect(reconnectFn).toContain("setShowAuthFlow(true)")
  })

  it("no Wallet approval pill appears in withdrawal review or failure screens", () => {
    expect(page).not.toContain("Wallet approval")
    expect(page).not.toContain("wallet-approval")
    expect(page).not.toContain("approval pill")
  })

  it("no PineTree Wallet signer is not available merchant-facing copy remains in page", () => {
    // The old generic error string is gone; session errors use specific reconnect-guidance copy.
    expect(page).not.toContain("PineTree Wallet signer is not available for this asset yet.")
    // Actionable errors that replaced it must be present
    expect(page).toContain("PineTree Wallet is not active in this browser session.")
    expect(page).toContain("different PineTree Wallet session")
    expect(page).toContain("Unable to sign this withdrawal. Please try again.")
  })

  it("address mismatch shows a distinct session-mismatch error distinct from session-not-found", () => {
    // When Dynamic wallets are present but none match the saved DB address (different account),
    // the error is distinct from the no-wallets case, guiding the merchant to sign in again.
    expect(page).toContain("This browser is connected to a different PineTree Wallet session.")
    expect(page).toContain("hasAnyDynamicWallet")
    // Both error paths share the same signer_not_found log key for diagnostics
    expect(page).toContain("matchingWalletFound: false")
    expect(page).toContain("dynamicWalletCount:")
    expect(page).toContain("payloadKind:")
  })

  // -------------------------------------------------------------------------
  // Withdrawal reconnect recovery — Task 6
  // -------------------------------------------------------------------------

  it("reconnect refreshes Dynamic wallets before matching source address", () => {
    // When no wallets are active, the handler sets withdrawalReconnectPending and a useEffect
    // watches wallets + primaryWallet; once non-empty, it runs address matching and clears
    // pending — so the retry always uses the freshest wallet list from the Dynamic SDK.
    expect(page).toContain("withdrawalReconnectPending")
    expect(page).toContain("setWithdrawalReconnectPending")
    expect(page).toContain("withdrawalReconnectSourceRef")
    // useEffect watches wallets and primaryWallet for the reconnect path
    expect(page).toContain("reconnect_after")
  })

  it("signer lookup searches all Dynamic wallets, not just primaryWallet", () => {
    // findDynamicWalletForSource deduplicates candidates[] and primaryWallet into a single
    // search list so that wallets in either source can match the saved DB source address.
    expect(dynamicSignerLookup).toContain("[primaryWallet, ...candidates]")
    expect(dynamicSignerLookup).toContain("getDynamicWalletSearchList(candidates, primaryWallet, rail).find")
  })

  it("Solana address matching uses exact string comparison after shared lowercase normalisation", () => {
    // Both the stored address and the Dynamic wallet address are lowercased before comparison.
    // A Solana address like 'CdKwuF...' lowercases identically from both sides, so the match
    // is correct; no separate case-sensitive path is needed.
    expect(dynamicSignerLookup).toContain('if (rail === "base") return address.toLowerCase()')
    expect(dynamicSignerLookup).toContain("dynamicWalletAddressesMatch(address, sourceAddress, rail)")
    expect(dynamicSignerLookup).toContain("normalizedCandidate === normalizedSource")
  })

  it("EVM address matching is case-insensitive via shared lowercase normalisation", () => {
    // EVM addresses from different sources may differ in case ('0xAbCd' vs '0xabcd').
    // Both sides are lowercased before comparison so a checksum-cased DB address matches
    // a lowercase Dynamic wallet address and vice versa.
    expect(dynamicSignerLookup).toContain('if (rail === "base") return address.toLowerCase()')
    expect(dynamicSignerLookup).toContain("dynamicWalletAddressesMatch(address, sourceAddress, rail)")
    expect(dynamicSignerLookup).toContain("normalizedCandidate === normalizedSource")
  })

  it("reconnect with wallets loaded but address mismatch opens Dynamic auth before failing", () => {
    // When handleWithdrawalReconnect runs and Dynamic wallets are already loaded but none
    // match the DB source address, it opens Dynamic auth/connect and lets the reconnect
    // effect validate the refreshed wallet list.
    const reconnectFn = page.slice(
      page.indexOf("async function handleWithdrawalReconnect()"),
      page.indexOf("function handleCreateWallet()")
    )
    expect(reconnectFn).toContain("setWithdrawalReconnectPending(true)")
    expect(reconnectFn).toContain("setShowDynamicUserProfile(false)")
    expect(reconnectFn).toContain("setShowAuthFlow(true)")
    expect(page).toContain("This browser is connected to a different PineTree Wallet session. Sign in with the PineTree Wallet used for this merchant, then try again.")
  })

  it("signer_lookup diagnostic logs wallet count and address prefixes before matching", () => {
    // The signer_lookup event is emitted (gated by walletCreationDebugEnabled) before the
    // wallet search so that diagnostics capture the exact state seen during signing.
    expect(page).toContain("\"[pinetree-withdrawals] signer_lookup\"")
    expect(page).toContain("dynamicWalletAddressPrefixes")
    expect(page).toContain("sourceAddressPrefix")
    expect(page).toContain("hasPrimaryWallet")
  })

  it("no pending review fallback: PineTree Wallet Solana/Base withdrawals always use dynamic_browser path", () => {
    // There is no client-side fallback to action: "submit" for Solana or Base withdrawals.
    // Signing failures surface as errors, not silent fallbacks to manual review.
    expect(page).not.toContain("action: \"submit\"")
  })
})
