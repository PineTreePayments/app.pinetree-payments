import fs from "fs"
import path from "path"
import { describe, expect, it, vi } from "vitest"
import { filterPineTreeMerchantWalletOptions } from "@/components/providers/PineTreeDynamicProvider"
import { findDynamicApprovalWalletForSource } from "@/lib/wallets/dynamicSignerLookup"

const page = fs.readFileSync(
  path.join(process.cwd(), "app/dashboard/wallet-setup/page.tsx"),
  "utf8"
)

function walletOption(key: string, overrides?: Record<string, unknown>) {
  return {
    key,
    name: key,
    walletConnector: {
      key,
      name: key,
      isEmbeddedWallet: false,
      isWalletConnect: false,
      ...overrides,
    },
  } as never
}

describe("Dynamic embedded wallet hydration", () => {
  it("provider filter keeps Dynamic embedded wallet connectors", () => {
    const options = [
      walletOption("dynamicwaas"),
      walletOption("turnkeyhd"),
      walletOption("zerodev"),
      walletOption("magicemailotp"),
      walletOption("metamask"),
      walletOption("walletconnect", { isWalletConnect: true }),
    ]

    const filtered = filterPineTreeMerchantWalletOptions(options)
    const keys = filtered.map((option) => option.key)

    expect(keys).toEqual(["dynamicwaas", "turnkeyhd", "zerodev", "magicemailotp"])
  })

  it("Open PineTree Wallet uses the actual Dynamic embedded wallet hydration methods", () => {
    expect(page).toContain("useDynamicWaas")
    expect(page).toContain("useEmbeddedWallet")
    expect(page).toContain("initializeWaas({ forceClientRebuild: true })")
    expect(page).toContain("createOrRestoreSession()")
    expect(page).toContain("waitForDynamicWalletRuntime")
    expect(page).toContain('refreshDynamicWalletRuntime("withdrawal_reconnect_before_lookup"')
  })

  it("Approve withdrawal is blocked when Dynamic runtime has no matching signer", () => {
    expect(page).toContain('refreshDynamicWalletRuntime("withdrawal_submit_before_signing", { requireApprovalWallet: true })')
    expect(page).toContain('if (_debugApprovalMethod === "dynamic_browser" && !_debugMatchingWallet)')
    expect(page).toContain("PineTree Wallet is not active in this browser session")
    expect(page).toContain('setWithdrawalScreen("failed")')
  })

  it("ready DB profile with zero Dynamic wallets still maps to Connected for viewing", () => {
    expect(page).toContain("const baseSignerReady = Boolean(")
    expect(page).toContain("const solanaSignerReady = Boolean(")
    expect(page).toContain('const dynamicProfileReady = profile?.status === "ready" && baseReady && solanaReady && baseSignerReady && solanaSignerReady')
    expect(page).toContain('if (dynamicProfileReady || hasReadyBaseAndSolanaProfile) return "ready"')
    expect(page).toContain('if (repairOrSetupIncomplete) return "reconnect_needed"')
    expect(page).toContain('walletSetupPrimaryState === "ready" ? "Connected" :')
  })

  it("Solana embedded wallet signer lookup succeeds after hydration", () => {
    const solanaEmbeddedWallet = {
      address: "SolanaHydrated11111111111111111111111111111",
      key: "dynamicwaas",
      chain: "solana",
      signAndSendTransaction: vi.fn(),
    }

    expect(findDynamicApprovalWalletForSource(
      [],
      solanaEmbeddedWallet,
      "solana",
      "SolanaHydrated11111111111111111111111111111"
    )).toBe(solanaEmbeddedWallet)
  })

  it("Base embedded wallet signer lookup succeeds after hydration", () => {
    const baseEmbeddedWallet = {
      address: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
      key: "dynamicwaas",
      chain: "evm",
      getWalletClient: vi.fn(),
    }

    expect(findDynamicApprovalWalletForSource(
      [],
      baseEmbeddedWallet,
      "base",
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
    )).toBe(baseEmbeddedWallet)
  })
})
