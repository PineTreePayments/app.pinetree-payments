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
  const dbHelper = read("database/pineTreeWalletProfiles.ts")
  const migration = read("database/migrations/20260622_create_pinetree_wallet_profile.sql")
  // PineTree-managed Lightning backend files
  const lightningMigration = read("database/migrations/20260622_create_merchant_lightning_profiles.sql")
  const lightningDbHelper = read("database/merchantLightningProfiles.ts")
  const lightningApiRoute = read("app/api/wallets/lightning/pinetree-managed/route.ts")
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

  it("registers EVM, Solana, Bitcoin, and Spark wallet connectors", () => {
    expect(provider).toContain("EthereumWalletConnectors")
    expect(provider).toContain("SolanaWalletConnectors")
    expect(provider).toContain("BitcoinWalletConnectors")
    expect(provider).toContain("SparkWalletConnectors")
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
    // Addresses rendered in the modal come from profileAddresses (DB-backed), for Base/Solana/Bitcoin on-chain
    expect(page).toContain("profileAddresses.base")
    expect(page).toContain("profileAddresses.solana")
    expect(page).toContain("profileAddresses.bitcoin")
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
    // Mismatch warning is shown to the merchant
    expect(page).toContain("PineTree Wallet session not active for this account")
  })

  it("clears a stale Dynamic session before creating a wallet for a new merchant", () => {
    // logoutPending flow: detect stale session → call handleLogOut → wait → open auth flow
    expect(page).toContain("logoutPending")
    expect(page).toContain("handleLogOut")
    expect(page).toContain("Preparing…")
  })

  it("wallet status is derived from the DB profile, not the Dynamic browser session", () => {
    // baseReady and solanaReady come from profileAddresses (DB-backed addresses)
    expect(page).toContain("const baseReady = profileAddresses.base.length > 0")
    expect(page).toContain("const solanaReady = profileAddresses.solana.length > 0")
    // lightningReady comes from the merchant_lightning_profiles record, not a Dynamic Spark address
    expect(page).toContain('const lightningReady = lightningProfile?.status === "ready"')
    expect(page).toContain("const allPrimaryRailsReady = baseReady && solanaReady && lightningReady")
    expect(page).toContain('allPrimaryRailsReady ? "Ready" : "Needs attention"')
  })

  it("syncs Dynamic wallet addresses to the merchant profile on creation only when explicitly triggered", () => {
    // pendingSync is the guard: only set when the merchant explicitly clicks Create
    expect(page).toContain("pendingSync")
    expect(page).toContain("syncProfileFromDynamic")
    expect(page).toContain("extractDynamicWalletAddresses")
    // POST to pinetree-profile route includes dynamic_user_id to lock the profile to this session
    expect(page).toContain("dynamic_user_id")
    expect(page).toContain("user.userId")
  })

  it("provides a Refresh wallet addresses action that only updates the current merchant profile", () => {
    // Refresh is gated by canRefresh — only enabled when Dynamic session matches the saved profile
    expect(page).toContain("canRefresh")
    expect(page).toContain("dynamicSessionMatchesProfile")
    expect(page).toContain("Refresh wallet addresses")
    expect(page).toContain("handleRefreshAddresses")
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
      "WalletConnect",
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
    expect(page).toContain('label="Base address"')
    expect(page).toContain('label="Solana address"')
    // Lightning is PineTree-managed — no address row to copy, a dedicated section instead
    expect(page).not.toContain('<ReceiveRow label="Bitcoin Lightning/Spark address"')
    expect(page).toContain("Bitcoin Lightning is powered by PineTree")
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
    expect(page).toContain('label: "Receive"')
    expect(page).toContain('label: "Withdraw"')
    expect(page).toContain('label: "Activity"')
  })

  it("prioritizes Base, Solana, and Bitcoin Lightning/Spark", () => {
    expect(page).toContain('const primaryRails = ["Base", "Solana", "Bitcoin Lightning"]')
    expect(page).toContain("Bitcoin Lightning / Spark")
    expect(page).toContain("Bitcoin on-chain address")
  })

  it("requires Base, Solana, and Lightning before marking the wallet Ready", () => {
    expect(page).toContain("const allPrimaryRailsReady = baseReady && solanaReady && lightningReady")
    expect(page).toContain('allPrimaryRailsReady ? "Ready" : "Needs attention"')
    expect(page).toContain("Bitcoin Lightning setup pending")
  })

  it("shows receive readiness for Base and Solana, and a PineTree-managed section for Bitcoin Lightning", () => {
    expect(page).toContain('<ReceiveRow label="Base address"')
    expect(page).toContain('<ReceiveRow label="Solana address"')
    // Lightning is PineTree-managed — no address to copy, section explains the rail
    expect(page).not.toContain('<ReceiveRow label="Bitcoin Lightning/Spark address"')
    expect(page).toContain("Bitcoin Lightning is powered by PineTree")
    expect(page).toContain('No external merchant wallet connection is required')
    // Base/Solana ReceiveRow still shows Setup pending when address is missing
    expect(page).toContain('label={ready ? "Ready" : "Setup pending"}')
    expect(page).toContain(">Setup pending</p>")
  })

  // -------------------------------------------------------------------------
  // Withdrawal scaffold — no real fund movement
  // -------------------------------------------------------------------------

  it("scaffolds a disabled withdrawal review without fund movement", () => {
    expect(page).toContain('aria-label="Select withdrawal rail"')
    expect(page).toContain('aria-label="Destination address"')
    expect(page).toContain('aria-label="Withdrawal amount"')
    // Updated message per spec
    expect(page).toContain("Withdrawals are being prepared")
    expect(page).toContain("No funds will move from this screen yet")
    expect(page).toContain("disabled")
    // The Review button is disabled — no API calls for withdrawal execution
    expect(page).not.toContain("/api/wallets/settlement")
    expect(page).not.toContain("/api/wallets/send-sessions")
    expect(page).not.toContain("/api/providers")
  })

  it("withdrawal request DB scaffold exists with correct fields and safe-only statuses", () => {
    expect(migration).toContain("wallet_withdrawal_requests")
    expect(migration).toContain("merchant_id")
    expect(migration).toContain("wallet_profile_id")
    expect(migration).toContain("rail")
    expect(migration).toContain("destination_address")
    expect(migration).toContain("amount")
    expect(migration).toContain("status")
    expect(migration).toContain("created_at")
    expect(migration).toContain("updated_at")
    // Comments confirm no fund movement
    expect(migration).toContain("No fund movement")
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

  // -------------------------------------------------------------------------
  // Error / config states
  // -------------------------------------------------------------------------

  it("handles missing configuration, unavailable SDK, and profile load errors", () => {
    expect(provider).toContain("if (!environmentId)")
    expect(provider).toContain("WalletInfrastructureErrorBoundary")
    expect(page).toContain('kind="missing-env"')
    expect(page).toContain('kind="sdk"')
    expect(page).toContain('{ kind: "error" }')
    expect(page).toContain('"Not created"')
    expect(page).toContain('"Ready"')
    expect(page).toContain('"Needs attention"')
    expect(page).toContain('status="Loading"')
    expect(page).toContain("Wallet activity will appear here.")
  })

  // -------------------------------------------------------------------------
  // POS / checkout isolation — must not be affected
  // -------------------------------------------------------------------------

  it("does not expose wallet infrastructure as a merchant provider", () => {
    expect(providerPage).not.toMatch(/provider=["']dynamic["']/i)
    expect(providerPage).not.toMatch(/name=["']Dynamic["']/)
  })

  it("wallet setup page does not call payment routing, POS, or checkout APIs", () => {
    // Wallet setup only calls wallet-scoped API routes
    expect(page).toContain("/api/wallets/pinetree-profile")
    expect(page).toContain("/api/wallets/lightning/pinetree-managed")
    expect(page).not.toContain("/api/wallets/settlement")
    expect(page).not.toContain("/api/wallets/send-sessions")
    expect(page).not.toContain("/api/providers")
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
      "@dynamic-labs/spark",
    ]) {
      expect(packageJson.dependencies[dependency]).toBe("^4.90.0")
    }
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

  it("lightningReady comes from merchant_lightning_profiles.status, not a Dynamic Spark address", () => {
    // Readiness is driven by the DB record, not any Spark address returned by Dynamic
    expect(page).toContain('const lightningReady = lightningProfile?.status === "ready"')
    expect(page).toContain('const lightningPending = lightningProfile?.status === "pending"')
    // No old pattern that checked Spark address length
    expect(page).not.toContain("profileAddresses.lightning.length > 0")
    expect(page).not.toContain("lightningAddress.length")
  })

  it("PineTree Wallet can be created with Base/Solana active while Lightning profile is pending", () => {
    // hasWallet is true once Base or Solana is active — Lightning pending does not block it
    expect(page).toContain("const hasWallet = profileState.kind")
    expect(page).toContain("baseReady || solanaReady || lightningReady")
    // lightningPending is a valid state for an active wallet
    expect(page).toContain("lightningPending")
    expect(page).toContain("const lightningEnabled = lightningReady || lightningPending")
  })

  it("Enable Bitcoin Lightning button calls POST /api/wallets/lightning/pinetree-managed and does not redirect", () => {
    expect(page).toContain("Enable Bitcoin Lightning")
    expect(page).toContain("handleEnableLightning")
    // Uses a POST fetch to the internal route — no redirect to Speed sign-up
    expect(page).toContain("/api/wallets/lightning/pinetree-managed")
    expect(page).not.toContain("speed.com")
    expect(page).not.toContain("tryspeed.com")
    expect(page).not.toContain("router.push")
  })

  it("does not ask the merchant to sign up for Speed, paste keys, or connect NWC", () => {
    expect(page).not.toContain("Sign up for Speed")
    expect(page).not.toContain("TrySpeed")
    expect(page).not.toContain("speed.com")
    expect(page).not.toContain("Connect NWC")
    expect(page).not.toContain("nostr+walletconnect")
    expect(page).not.toContain("Paste your")
    expect(page).not.toContain("Speed API key")
    expect(page).toContain("No external merchant wallet connection is required")
  })

  it("does not expose Speed API keys or secrets to the browser", () => {
    expect(page).not.toContain("SPEED_API_KEY")
    expect(page).not.toContain("SPEED_SECRET")
    expect(page).not.toContain("speed_secret")
    // The lightning API route response only contains the profile object, not secrets
    expect(lightningApiRoute).toContain("return NextResponse.json({ profile: lightningProfile })")
    expect(lightningApiRoute).not.toContain("SPEED_API_KEY")
    expect(lightningApiRoute).not.toContain("speed_account_secret")
    // API route comments confirm security intent
    expect(lightningApiRoute).toContain("No Speed API keys or secrets are returned to the browser")
  })

  it("merchant_lightning_profiles migration creates the correct table shape", () => {
    expect(lightningMigration).toContain("merchant_lightning_profiles")
    expect(lightningMigration).toContain("merchant_id")
    expect(lightningMigration).toContain("provider")
    expect(lightningMigration).toContain("status")
    expect(lightningMigration).toContain("speed_connected_account_id")
    expect(lightningMigration).toContain("setup_source")
    expect(lightningMigration).toContain("UNIQUE")
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
    expect(lightningApiRoute).toContain("markMerchantLightningPending")
    // No Speed sub-account creation in this pass
    expect(lightningApiRoute).not.toContain("speedClient")
    expect(lightningApiRoute).not.toContain("createConnectedAccount")
    expect(lightningApiRoute).not.toContain("SPEED_API_KEY")
  })

  it("existing legacy Speed route still compiles (backward compat)", () => {
    const legacySpeedRoute = read("app/api/wallets/lightning/speed/connect/route.ts")
    // The legacy route that requires a merchant-supplied speedAccountId must still exist
    expect(legacySpeedRoute).toContain("speedAccountId")
  })
})
