import { describe, expect, it } from "vitest"
import { existsSync, readdirSync, readFileSync, statSync } from "fs"
import path from "path"

/**
 * Architecture guard: PineTree UI components must never call
 * provider-branded API routes, and generic app/api/wallets/* routes must
 * call the PineTree wallet engine directly rather than proxying to a
 * provider-specific route over HTTP. See the flow required in the task
 * that added this file:
 *   UI -> generic PineTree route -> PineTree wallet engine -> provider adapter -> provider API
 */

const ROOT = process.cwd()
const SCAN_DIRS = ["app", "components", "hooks"]
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"])

function listFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return []
  const entries = readdirSync(dir)
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      files.push(...listFilesRecursive(full))
    } else if (CODE_EXTENSIONS.has(path.extname(full))) {
      files.push(full)
    }
  }
  return files
}

function isRouteFile(filePath: string): boolean {
  return /route\.(ts|tsx)$/.test(filePath) && filePath.split(path.sep).includes("api")
}

describe("Wallet provider architecture boundary", () => {
  it("the old provider-branded route directory no longer exists", () => {
    expect(existsSync(path.join(ROOT, "app", "api", "wallets", "speed"))).toBe(false)
  })

  it("the old provider-branded panel component no longer exists", () => {
    expect(existsSync(path.join(ROOT, "components", "dashboard", "SpeedWalletManagementPanel.tsx"))).toBe(false)
  })

  it("the generic MerchantWalletManagementPanel component exists", () => {
    expect(existsSync(path.join(ROOT, "components", "dashboard", "MerchantWalletManagementPanel.tsx"))).toBe(true)
  })

  it("no app/components/hooks source file references a provider-branded wallet API path", () => {
    const offenders: string[] = []
    for (const dir of SCAN_DIRS) {
      for (const file of listFilesRecursive(path.join(ROOT, dir))) {
        const content = readFileSync(file, "utf8")
        if (content.includes("/api/wallets/speed")) {
          offenders.push(file)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("all 12 generic wallet routes exist under app/api/wallets/*", () => {
    const expected = [
      "capabilities/route.ts",
      "balances/route.ts",
      "activity/route.ts",
      "operations/[operationId]/route.ts",
      "withdrawals/route.ts",
      "withdrawals/[operationId]/route.ts",
      "payouts/route.ts",
      "payouts/[operationId]/route.ts",
      "swaps/quote/route.ts",
      "swaps/route.ts",
      "swaps/[operationId]/route.ts",
      "preferences/route.ts",
    ]
    for (const relative of expected) {
      expect(existsSync(path.join(ROOT, "app", "api", "wallets", relative))).toBe(true)
    }
  })

  it("generic wallet routes call the PineTree wallet engine directly - never fetch() another route or a provider-specific internal endpoint", () => {
    const walletRoutesDir = path.join(ROOT, "app", "api", "wallets")
    const routeFiles = listFilesRecursive(walletRoutesDir).filter(isRouteFile)
    // Only the routes this task introduced/touched - other pre-existing
    // /api/wallets/* routes (settlement, pinetree-wallet, etc.) are a
    // separate, unrelated feature area and out of scope for this guard.
    const genericWalletRoutes = routeFiles.filter((file) => {
      const relative = path.relative(walletRoutesDir, file)
      return /^(capabilities|balances|activity|operations|withdrawals|payouts|swaps|preferences)[/\\]/.test(relative)
    })
    expect(genericWalletRoutes.length).toBe(12)

    for (const file of genericWalletRoutes) {
      const content = readFileSync(file, "utf8")
      expect(content).not.toMatch(/fetch\(/)
      expect(content).toMatch(/from "@\/engine\/wallet\//)
    }
  })

  it("generic wallet routes never reference a provider name, provider account id, or provider header", () => {
    const walletRoutesDir = path.join(ROOT, "app", "api", "wallets")
    const routeFiles = listFilesRecursive(walletRoutesDir).filter(isRouteFile)
    const genericWalletRoutes = routeFiles.filter((file) => {
      const relative = path.relative(walletRoutesDir, file)
      return /^(capabilities|balances|activity|operations|withdrawals|payouts|swaps|preferences)[/\\]/.test(relative)
    })

    for (const file of genericWalletRoutes) {
      const content = readFileSync(file, "utf8")
      expect(content).not.toMatch(/\bSpeed\b/)
      expect(content).not.toContain("speedAccountId")
      expect(content).not.toContain("speed_account_id")
      expect(content).not.toContain("X-Speed-Account")
    }
  })

  it("the WalletApiRouteError codes used by generic routes are PineTree WALLET_* codes, never SPEED_*", () => {
    const errorsSource = readFileSync(path.join(ROOT, "engine", "wallet", "walletErrors.ts"), "utf8")
    expect(errorsSource).not.toMatch(/SPEED_[A-Z_]+/)
    expect(errorsSource).toContain("WALLET_PROVIDER_NOT_CONFIGURED")
    expect(errorsSource).toContain("WALLET_PROVIDER_NOT_READY")
    expect(errorsSource).toContain("WALLET_CAPABILITY_UNAVAILABLE")
  })

  it("the generic wallet-management engine layer never references provider-specific identifiers (speedAccountId, speed_account_id, X-Speed-Account)", () => {
    // Scoped to the generic engine boundary this task introduced - NOT a
    // repo-wide sweep. PineTree's pre-existing Lightning payment/settlement
    // code (engine/lightningSweep.ts, engine/withdrawals/walletWithdrawals.ts,
    // engine/createPayment.ts, etc.) legitimately treats Speed as its one
    // confirmed settlement provider today and is a separate, unrelated
    // system from wallet MANAGEMENT - it is out of scope for this guard.
    const genericEngineFiles = [
      "walletTypes.ts",
      "walletErrors.ts",
      "walletProviderAdapter.ts",
      "walletProviderRegistry.ts",
      "walletProviderResolution.ts",
      "loadWalletProviders.ts",
      "walletMoney.ts",
      "walletOperations.ts",
      "walletPreferences.ts",
    ]

    const offenders: string[] = []
    for (const filename of genericEngineFiles) {
      const filePath = path.join(ROOT, "engine", "wallet", filename)
      const content = readFileSync(filePath, "utf8")
      if (
        content.includes("speedAccountId") ||
        content.includes("speed_account_id") ||
        content.includes("X-Speed-Account") ||
        /\bSpeed\b/.test(content.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")) // ignore comments, which may legitimately explain the Speed-adapter boundary
      ) {
        offenders.push(filename)
      }
    }
    expect(offenders).toEqual([])
  })

  it("the generic wallet-management UI and API routes never reference provider-specific identifiers", () => {
    const offenders: string[] = []
    const scanTargets = [
      path.join(ROOT, "components", "dashboard", "MerchantWalletManagementPanel.tsx"),
      ...listFilesRecursive(path.join(ROOT, "app", "api", "wallets", "capabilities")),
      ...listFilesRecursive(path.join(ROOT, "app", "api", "wallets", "balances")),
      ...listFilesRecursive(path.join(ROOT, "app", "api", "wallets", "activity")),
      ...listFilesRecursive(path.join(ROOT, "app", "api", "wallets", "operations")),
      ...listFilesRecursive(path.join(ROOT, "app", "api", "wallets", "withdrawals")),
      ...listFilesRecursive(path.join(ROOT, "app", "api", "wallets", "payouts")),
      ...listFilesRecursive(path.join(ROOT, "app", "api", "wallets", "swaps")),
      ...listFilesRecursive(path.join(ROOT, "app", "api", "wallets", "preferences")),
    ]
    for (const filePath of scanTargets) {
      const content = readFileSync(filePath, "utf8")
      if (
        content.includes("speedAccountId") ||
        content.includes("speed_account_id") ||
        content.includes("X-Speed-Account")
      ) {
        offenders.push(path.relative(ROOT, filePath))
      }
    }
    expect(offenders).toEqual([])
  })
})
