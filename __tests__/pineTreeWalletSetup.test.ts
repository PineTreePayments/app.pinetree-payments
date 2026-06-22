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
  const packageJson = JSON.parse(read("package.json")) as { dependencies: Record<string, string> }

  it("loads wallet infrastructure only around the authenticated dashboard", () => {
    expect(layout).toContain("<PineTreeDynamicProvider>")
    expect(layout).toContain("</PineTreeDynamicProvider>")
    expect(layout).toContain('/dashboard/wallet-setup')
    expect(provider).toContain("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID")
    expect(provider).toContain('appName: "PineTree Wallets"')
  })

  it("registers EVM, Solana, Bitcoin, and Spark wallet connectors", () => {
    expect(provider).toContain("EthereumWalletConnectors")
    expect(provider).toContain("SolanaWalletConnectors")
    expect(provider).toContain("BitcoinWalletConnectors")
    expect(provider).toContain("SparkWalletConnectors")
  })

  it("uses PineTree branding and exposes all requested wallet groups", () => {
    expect(page).toContain("PineTree Wallet Setup")
    expect(page).toContain("Create PineTree Wallets")
    expect(page).toContain("Connect Wallet")
    expect(page).toContain("PineTree Solana Wallet")
    expect(page).toContain("PineTree Base Wallet")
    expect(page).toContain("PineTree Bitcoin Wallet")
    expect(page).toContain("PineTree Lightning Wallet")
    expect(page).not.toContain("Sign up with Dynamic")
  })

  it("reads wallet addresses without adding payment or backend calls", () => {
    expect(page).toContain("useUserWallets()")
    expect(page).toContain("wallet.address")
    expect(page).toContain("wallet.additionalAddresses")
    expect(page).not.toContain("/api/")
    expect(page).toContain("Payments are not enabled through these wallets yet.")
  })

  it("handles missing configuration, unavailable SDK, disconnected users, and empty wallets", () => {
    expect(provider).toContain("if (!environmentId)")
    expect(provider).toContain("WalletInfrastructureErrorBoundary")
    expect(page).toContain('kind="missing-env"')
    expect(page).toContain('kind="sdk"')
    expect(page).toContain("Not connected")
    expect(page).toContain("Wallets not created yet.")
  })

  it("does not expose wallet infrastructure as a merchant provider", () => {
    expect(providerPage).not.toMatch(/provider=["']dynamic["']/i)
    expect(providerPage).not.toMatch(/name=["']Dynamic["']/)
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
})
