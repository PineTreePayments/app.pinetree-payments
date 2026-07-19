import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8")
}

function exists(file: string) {
  return fs.existsSync(path.join(process.cwd(), file))
}

// ---------------------------------------------------------------------------
// Speed capabilities diagnostic (server-only)
// ---------------------------------------------------------------------------

describe("speedCapabilities.ts", () => {
  const src = read("providers/lightning/speedCapabilities.ts")

  it("exports checkSpeedCapabilities", () => {
    expect(src).toContain("export async function checkSpeedCapabilities")
  })

  it("reports configuration without mutation-shaped provider probes", () => {
    expect(src).not.toContain("fetch(")
    expect(src).not.toContain('"/payments"')
    expect(src).not.toContain('"/send"')
    expect(src).not.toContain('"/connect/custom"')
    expect(src).toContain("checked: false")
  })

  it("returns SpeedCapabilitiesResult shape", () => {
    expect(src).toContain("speed_api_configured")
    expect(src).toContain("can_create_invoice")
    expect(src).toContain("can_create_send")
    expect(src).toContain("can_create_merchant_account")
    expect(src).toContain("can_read_balance")
  })

  it("does not expose SPEED_API_KEY in return value", () => {
    expect(src).not.toContain("SPEED_API_KEY:")
    expect(src).not.toContain("api_key:")
  })

  it("leaves Basic authentication construction in the shared Speed client", () => {
    expect(src).toContain("SPEED_API_KEY")
    expect(src).not.toContain("Authorization")
    const client = read("providers/lightning/speedClient.ts")
    expect(client).toContain("Authorization")
  })
})

// ---------------------------------------------------------------------------
// Internal capabilities route — auth protection
// ---------------------------------------------------------------------------

describe("GET /api/internal/speed/capabilities", () => {
  const route = read("app/api/internal/speed/capabilities/route.ts")

  it("imports checkSpeedCapabilities from speedCapabilities", () => {
    expect(route).toContain('from "@/providers/lightning/speedCapabilities"')
    expect(route).toContain("checkSpeedCapabilities")
  })

  it("checks INTERNAL_API_SECRET in authorization header", () => {
    expect(route).toContain("INTERNAL_API_SECRET")
    expect(route).toContain("authorization")
  })

  it("also accepts CRON_SECRET as auth token", () => {
    expect(route).toContain("CRON_SECRET")
  })

  it("requires Bearer token prefix", () => {
    expect(route).toContain("Bearer ")
  })

  it("returns 401 when authorization fails", () => {
    expect(route).toContain("401")
    expect(route).toContain("Unauthorized")
  })

  it("returns capabilities object (not raw config or secrets)", () => {
    expect(route).toContain("capabilities")
    expect(route).not.toContain("SPEED_API_KEY")
    expect(route).not.toContain("api_key")
  })

  it("is an internal route (not under /api/providers or merchant paths)", () => {
    const routePath = "app/api/internal/speed/capabilities/route.ts"
    expect(exists(routePath)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Internal BTC address setter — admin only
// ---------------------------------------------------------------------------

describe("POST /api/internal/wallets/pinetree/btc-address", () => {
  const route = read("app/api/internal/wallets/pinetree/btc-address/route.ts")

  it("exists as an internal route", () => {
    expect(exists("app/api/internal/wallets/pinetree/btc-address/route.ts")).toBe(true)
  })

  it("is protected by INTERNAL_API_SECRET only (not merchant auth)", () => {
    expect(route).toContain("INTERNAL_API_SECRET")
    expect(route).not.toContain("supabase.auth")
    expect(route).not.toContain("merchant_id from session")
  })

  it("requires Bearer token header", () => {
    expect(route).toContain("Bearer ")
    expect(route).toContain("authorization")
  })

  it("requires merchant_id in request body", () => {
    expect(route).toContain("merchant_id")
    expect(route).toContain("merchant_id is required")
  })

  it("requires btc_address in request body", () => {
    expect(route).toContain("btc_address")
    expect(route).toContain("btc_address is required")
  })

  it("calls upsertPineTreeWalletProfile to set BTC address", () => {
    expect(route).toContain("upsertPineTreeWalletProfile")
    expect(route).toContain("btcPayoutEnabled: true")
  })

  it("infers address type from address prefix when not explicitly provided", () => {
    expect(route).toContain("inferBtcAddressType")
    expect(route).toContain("normalizeBtcAddressType")
  })

  it("returns 401 for missing or wrong secret", () => {
    expect(route).toContain("401")
    expect(route).toContain("Unauthorized")
  })

  it("does not include raw secrets in JSON responses", () => {
    // The route reads INTERNAL_API_SECRET for auth — that's expected.
    // What must NOT appear is the secret being passed into NextResponse.json().
    expect(route).not.toContain("SPEED_API_KEY")
    // Confirm no direct interpolation of the secret value into response objects
    expect(route).not.toContain("secret,")
    expect(route).not.toContain("secret }")
  })
})

// ---------------------------------------------------------------------------
// Speed merchant account mode stub in speedClient
// ---------------------------------------------------------------------------

describe("speedClient speed_merchant_account mode", () => {
  const client = read("providers/lightning/speedClient.ts")

  it("exports SPEED_MERCHANT_ACCOUNT_MODE constant", () => {
    expect(client).toContain('SPEED_MERCHANT_ACCOUNT_MODE = "speed_merchant_account"')
  })

  it("includes speed_merchant_account in SpeedLightningSettlementMode union", () => {
    expect(client).toContain("SPEED_MERCHANT_ACCOUNT_MODE")
    expect(client).toContain("SpeedLightningSettlementMode")
  })

  it("exports isSpeedMerchantAccountModeEnabled helper", () => {
    expect(client).toContain("isSpeedMerchantAccountModeEnabled")
  })

  it("still exports SPEED_PLATFORM_TREASURY_SWEEP_MODE (canonical Lightning mode)", () => {
    expect(client).toContain("SPEED_PLATFORM_TREASURY_SWEEP_MODE")
  })
})

// ---------------------------------------------------------------------------
// Providers page — deprecated symbols removed
// ---------------------------------------------------------------------------

describe("Providers page deprecated crypto wallet connect removed", () => {
  const page = read("app/dashboard/providers/page.tsx")

  it("no longer imports QRCode", () => {
    expect(page).not.toContain("qrcode")
  })

  it("no longer imports useRef", () => {
    expect(page).not.toContain("useRef")
  })

  it("no longer imports Image from next/image", () => {
    expect(page).not.toContain('from "next/image"')
  })

  it("no longer imports speedLoginUrl / speedSignupUrl / speedAccountSetupUrl", () => {
    expect(page).not.toContain("speedLoginUrl")
    expect(page).not.toContain("speedSignupUrl")
    expect(page).not.toContain("speedAccountSetupUrl")
  })

  it("no longer has Alby or Zeus URL constants", () => {
    expect(page).not.toContain("providerAlbyHubAppsUrl")
    expect(page).not.toContain("providerZeusIosUrl")
  })

  it("no longer has NWC state", () => {
    expect(page).not.toContain("nwcUri")
    expect(page).not.toContain("nwcWalletLabel")
    expect(page).not.toContain("nwcTestResult")
  })

  it("no longer has Speed Connect merchant state", () => {
    expect(page).not.toContain("speedAccountId")
    expect(page).not.toContain("lightningSetupTab")
    expect(page).not.toContain("speedSetupStep")
  })

  it("no longer has wallet session / mobile connect state", () => {
    expect(page).not.toContain("walletSessionId")
    expect(page).not.toContain("selectedWalletType")
    expect(page).not.toContain("showMobileConnect")
    expect(page).not.toContain("walletQrCode")
    expect(page).not.toContain("walletMobileDeeplink")
    expect(page).not.toContain("connectedWalletAddress")
  })

  it("no longer has polling refs", () => {
    expect(page).not.toContain("pollerRef")
    expect(page).not.toContain("pollStopAtRef")
    expect(page).not.toContain("walletSetupRequestRef")
    expect(page).not.toContain("didToastSyncRef")
  })

  it("no longer has buildMobileBridgeUrl or buildWalletDeepLink", () => {
    expect(page).not.toContain("buildMobileBridgeUrl")
    expect(page).not.toContain("buildWalletDeepLink")
  })

  it("no longer has createWalletConnectSession", () => {
    expect(page).not.toContain("createWalletConnectSession")
  })

  it("no longer has connectSolanaWallet or connectBaseWallet", () => {
    expect(page).not.toContain("connectSolanaWallet")
    expect(page).not.toContain("connectBaseWallet")
  })

  it("no longer has openSolanaMobileWallet or openBaseMobileWallet", () => {
    expect(page).not.toContain("openSolanaMobileWallet")
    expect(page).not.toContain("openBaseMobileWallet")
  })

  it("no longer has connectWalletOnThisDevice", () => {
    expect(page).not.toContain("connectWalletOnThisDevice")
  })

  it("no longer has selectWalletType function", () => {
    expect(page).not.toContain("function selectWalletType")
  })

  it("no longer has testNwcConnection", () => {
    expect(page).not.toContain("testNwcConnection")
  })

  it("no longer has testPineTreeSpeedPlatform", () => {
    expect(page).not.toContain("testPineTreeSpeedPlatform")
  })

  it("no longer has saveSpeedSetup", () => {
    expect(page).not.toContain("saveSpeedSetup")
  })

  it("no longer has disconnectSpeed", () => {
    expect(page).not.toContain("disconnectSpeed")
  })

  it("no longer has SolanaProviderLike or Eip1193ProviderLike types", () => {
    expect(page).not.toContain("SolanaProviderLike")
    expect(page).not.toContain("Eip1193ProviderLike")
  })

  it("no longer has getInjectedSolanaProvider or getInjectedEthereumProvider", () => {
    expect(page).not.toContain("getInjectedSolanaProvider")
    expect(page).not.toContain("getInjectedEthereumProvider")
    expect(page).not.toContain("getInjectedBaseProvider")
  })

  it("no longer has WalletConnectSession type", () => {
    expect(page).not.toContain("WalletConnectSession")
  })

  it("no longer shows NWC setup UI", () => {
    expect(page).not.toContain("NWC connection string")
    expect(page).not.toContain("nostr+walletconnect://")
    expect(page).not.toContain("Advanced NWC Wallet")
  })

  it("no longer shows Speed Connect merchant setup UI", () => {
    // These strings appeared only in the multi-step Speed merchant account setup wizard.
    // "Merchant Speed Account ID connected" is kept in the status display for legacy accounts.
    expect(page).not.toContain("I have a Speed account")
    expect(page).not.toContain("Open Speed Associated Accounts")
    expect(page).not.toContain("Enter Account ID")
    expect(page).not.toContain("Step 1 of 2")
    expect(page).not.toContain("Step 2 of 2")
  })

  it("shows Lightning is managed through PineTree Wallet", () => {
    expect(page).toContain("Bitcoin Lightning is managed through PineTree Wallet")
  })

  it("no longer shows Solana/Base wallet selection UI in modal", () => {
    expect(page).not.toContain("Scan QR with mobile wallet")
    expect(page).not.toContain("Open in mobile wallet")
    expect(page).not.toContain("Open Mobile Wallet")
    expect(page).not.toContain("Connect on this device")
    expect(page).not.toContain("Connect on This Device")
  })

  it("still has card provider logic intact", () => {
    expect(page).toContain("isManagedCardProvider")
    expect(page).toContain("beginCardProviderSetup")
  })

  it("still defines canonicalWalletMode", () => {
    expect(page).toContain("canonicalWalletMode")
    expect(page).toContain("NEXT_PUBLIC_PINE_TREE_WALLET_CANONICAL")
  })

  it("save footer only shows for coinbase (not solana/base/lightning)", () => {
    expect(page).toContain('activeProvider === "coinbase"')
    expect(page).not.toContain('activeProvider !== "lightning" && !isManagedCardProvider')
  })
})

// ---------------------------------------------------------------------------
// Deleted API routes confirmed absent
// ---------------------------------------------------------------------------

describe("Deprecated API routes deleted", () => {
  it("NWC connect route is deleted", () => {
    expect(exists("app/api/wallets/lightning/connect/route.ts")).toBe(false)
  })

  it("NWC test route is deleted", () => {
    expect(exists("app/api/wallets/lightning/test/route.ts")).toBe(false)
  })

  it("Speed Connect merchant route is deleted", () => {
    expect(exists("app/api/wallets/lightning/speed/connect/route.ts")).toBe(false)
  })

  it("Speed Connect return route is deleted", () => {
    expect(exists("app/api/wallets/lightning/speed/connect-return/route.ts")).toBe(false)
  })

  it("Speed platform test route is deleted", () => {
    expect(exists("app/api/wallets/lightning/speed/test/route.ts")).toBe(false)
  })
})
