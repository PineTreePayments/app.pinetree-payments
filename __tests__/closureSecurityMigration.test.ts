import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8")

describe("closure migration safety", () => {
  it("keeps reporting migration idempotent, non-destructive, and RLS-neutral", () => {
    const sql = read("database/migrations/20260717_harden_transaction_reporting_queries.sql").toLowerCase()
    expect(sql).toContain("add column if not exists timezone text not null default 'utc'")
    expect(sql).toContain("transactions_merchant_created_id_idx")
    expect(sql.match(/create index if not exists/g)?.length).toBe(8)
    expect(sql).not.toMatch(/drop\s+table|truncate|disable\s+row\s+level\s+security|drop\s+policy/)
  })

  it("binds balance snapshots to provider accounts without weakening RLS", () => {
    const sql = read("database/migrations/20260718_bind_wallet_balance_snapshots_to_provider_account.sql").toLowerCase()
    expect(sql).toContain("add column if not exists provider_account_id text")
    expect(sql).toContain("merchant_wallet_balance_snapshots_account_uidx")
    expect(sql).toContain("merchant_id, provider, provider_account_id, asset, network")
    expect(sql).not.toMatch(/drop\s+table|truncate|disable\s+row\s+level\s+security|drop\s+policy/)
  })
})

describe("merchant authorization boundaries", () => {
  it("derives report, export, transaction, wallet, provider, and Terminal scopes from server authentication", () => {
    const authenticatedRoutes: Array<[string, string]> = [
      ["app/api/reports/route.ts", "requireMerchantIdFromRequest"],
      ["app/api/reports/download/route.ts", "requireMerchantIdFromRequest"],
      ["app/api/transactions/route.ts", "requireMerchantIdFromRequest"],
      ["app/api/wallets/balances/route.ts", "withWalletMerchant"],
      ["app/api/providers/route.ts", "requireMerchantIdFromRequest"],
      ["app/api/providers/stripe/terminal/locations/route.ts", "requireStripeCardMerchant"],
      ["app/api/providers/stripe/terminal/readers/route.ts", "requireStripeCardMerchant"],
    ]

    for (const [route, boundary] of authenticatedRoutes) {
      const source = read(route)
      expect(source, route).toContain(boundary)
      expect(source, route).not.toMatch(/searchParams\.get\(["']merchantId["']\)/)
    }
  })

  it("scopes canonical report and transaction queries to the authenticated merchant", () => {
    expect(read("database/reports.ts")).toContain('.eq("merchant_id", merchantId)')
    expect(read("engine/transactionsDashboard.ts")).toContain('.eq("merchant_id", merchantId)')
    expect(read("engine/transactionsDashboard.ts")).not.toContain("raw_payload:")
  })
})
