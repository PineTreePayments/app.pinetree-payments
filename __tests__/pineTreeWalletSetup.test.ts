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
    expect(provider).toContain('appName: "PineTree Wallet"')
  })

  it("registers EVM, Solana, Bitcoin, and Spark wallet connectors", () => {
    expect(provider).toContain("EthereumWalletConnectors")
    expect(provider).toContain("SolanaWalletConnectors")
    expect(provider).toContain("BitcoinWalletConnectors")
    expect(provider).toContain("SparkWalletConnectors")
  })

  it("presents one merchant PineTree Wallet profile", () => {
    expect(page).toContain(">PineTree Wallet</h1>")
    expect(page).toContain(">PineTree Wallet</h2>")
    expect(page).toContain("One merchant wallet profile")
    expect(page).toContain("Create PineTree Wallet")
    expect(page).toContain("Open PineTree Wallet")
    expect(page).toContain('{hasAddresses ? "Open PineTree Wallet" : "Create PineTree Wallet"}')
    expect(page).not.toContain("Sign up with Dynamic")
  })

  it("keeps raw address details off the main setup summary", () => {
    expect(page).toContain('label="Base address"')
    expect(page).toContain('label="Solana address"')
    expect(page).toContain('label="Bitcoin Lightning/Spark address"')
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

  it("removes external wallet controls from this page", () => {
    expect(page).not.toContain("Advanced wallet options")
    expect(page).not.toContain("Connect external wallet")
  })

  it("reads wallet addresses without adding payment or backend calls", () => {
    expect(page).toContain("useUserWallets()")
    expect(page).toContain("wallet.address")
    expect(page).toContain("wallet.additionalAddresses")
    expect(page).not.toContain("/api/")
  })

  it("handles missing configuration, unavailable SDK, disconnected users, and empty wallets", () => {
    expect(provider).toContain("if (!environmentId)")
    expect(provider).toContain("WalletInfrastructureErrorBoundary")
    expect(page).toContain('kind="missing-env"')
    expect(page).toContain('kind="sdk"')
    expect(page).toContain('"Not created"')
    expect(page).toContain('"Ready"')
    expect(page).toContain('"Needs attention"')
    expect(page).toContain('status="Loading"')
    expect(page).toContain("Withdrawals coming soon")
    expect(page).toContain("Wallet activity will appear here.")
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
