import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("mobile dashboard hero cleanup", () => {
  it("uses setup wording when Online Checkout has no active configuration", () => {
    const checkout = read("app/dashboard/checkout/page.tsx")

    expect(checkout).toContain(': "Set up checkout"')
    expect(checkout).toContain("Create a payment link or add a checkout button to start accepting online payments.")
    expect(checkout).toContain('valueClassName="text-2xl font-bold leading-[1.15] tracking-tight text-gray-950 sm:text-[1.75rem] md:text-[1.875rem]"')
    expect(checkout).not.toContain('? "Needs attention"')
  })

  it("shows readable Online Checkout metrics in an integrated split row", () => {
    const checkout = read("app/dashboard/checkout/page.tsx")
    const metrics = checkout.match(/data-checkout-hero-metrics[\s\S]*?\.map/)?.[0] ?? ""

    expect(metrics).toContain('"Active links", isLoading ? "—" : String(activeLinks)')
    expect(checkout).toContain("const checkoutButtonCount = 0")
    expect(metrics).toContain('"Button", String(checkoutButtonCount)')
    expect(metrics).toContain('"Activity", isLoading ? "—" : String(stats?.confirmedPayments ?? 0)')
    expect(metrics).not.toContain("truncate")
    expect(metrics).not.toContain("text-ellipsis")
    expect(metrics).toContain("grid-cols-3")
    expect(metrics).toContain("divide-x")
    expect(metrics).toContain("border-t")
    expect(metrics).not.toContain("overflow-hidden")
    expect(metrics).not.toContain("rounded-full")
    expect(checkout).toContain('className="mt-1 text-xl font-semibold leading-tight text-gray-950">{value}</p>')
    expect(checkout).not.toContain('text-gray-950 sm:text-2xl">{value}</p>')
    expect(checkout).not.toContain("BUTTON S...")
    expect(checkout).not.toContain("RECENT ACTI...")
  })

  it("integrates Transactions hero metrics without an inner box", () => {
    const transactions = read("app/dashboard/transactions/page.tsx")
    const metrics = transactions.match(/data-transactions-hero-metrics[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? ""

    expect(metrics).toContain("Transactions")
    expect(metrics).toContain("Success Rate")
    expect(metrics).toContain("divide-x")
    expect(metrics).toContain("border-t")
    expect(metrics).not.toContain("rounded-xl")
    expect(metrics).not.toContain("bg-white")
  })

  it("keeps the POS terminal action compact", () => {
    const pos = read("app/dashboard/pos/page.tsx")
    const action = pos.match(/<button[\s\S]*?onClick=\{startCreatingTerminal\}[\s\S]*?<\/button>/)?.[0] ?? ""

    expect(action).toContain("rounded-md")
    expect(action).toContain("h-10")
    expect(action).toContain("px-4")
    expect(action).toContain("self-end")
    expect(action).not.toContain("w-full")
  })

  it("shows Inventory metrics without a duplicate hero value", () => {
    const inventory = read("app/dashboard/inventory/page.tsx")

    expect(inventory).not.toContain("value={summary.catalogItems}")
    expect(inventory).toContain('label="Active items"')
    expect(inventory).toContain('label="Low stock"')
    expect(inventory).toContain('label="Out of stock"')
    expect(inventory).toContain('label="Inventory value"')
  })

  it("wallets route redirects to canonical wallet-setup page (experience unified)", () => {
    const wallets = read("app/dashboard/wallets/page.tsx")
    expect(wallets).toContain('redirect("/dashboard/wallet-setup")')
  })

  it("keeps iPhone Safari from zooming focused merchant form controls without forcing desktop typography", () => {
    const globals = read("app/globals.css")
    const mobileRule = globals.slice(
      globals.indexOf("@media (max-width: 767px)"),
      globals.indexOf("@keyframes fadeIn")
    )
    const formFieldRule = globals.slice(
      globals.lastIndexOf(".form-field {"),
      globals.indexOf(".form-field::placeholder")
    )

    expect(mobileRule).toContain("input,\n  select,\n  textarea,")
    expect(mobileRule).toContain('[contenteditable="true"]')
    expect(mobileRule).toContain('[role="textbox"]')
    expect(mobileRule).toContain(".form-field")
    expect(mobileRule).toContain("font-size: 16px !important;")
    expect(formFieldRule).toContain("font-size: 0.875rem;")
    expect(formFieldRule).not.toContain("font-size: 16px")
    expect(globals).toContain("min-height: 100dvh;")
    expect(globals).not.toContain("user-scalable=no")
    expect(globals).not.toContain("maximum-scale=1")
  })

  it("simplifies Providers summary and leaves provider details to the mounted Providers page", () => {
    const providers = read("app/dashboard/providers/page.tsx")
    const hero = providers.slice(
      providers.indexOf('eyebrow="PAYMENT INFRASTRUCTURE"'),
      providers.indexOf('<DashboardSection title="Engine Settings"')
    )

    expect(hero).toContain("Connected Providers")
    expect(hero).not.toContain("Card providers:")
    expect(hero).not.toContain("Crypto rails:")
    expect(hero).not.toContain("border-t border-blue-200")
  })

  it("does not let Settings preload provider, wallet, checkout, webhook, or inventory section data", () => {
    const settings = read("app/dashboard/settings/page.tsx")
    const loadSettingsBlock = settings.slice(
      settings.indexOf("const loadSettings = useCallback"),
      settings.indexOf("useEffect(() => {", settings.indexOf("const loadSettings = useCallback"))
    )

    expect(loadSettingsBlock).toContain('callSettingsApi("GET"')
    expect(loadSettingsBlock).not.toContain("/api/providers")
    expect(loadSettingsBlock).not.toContain("/api/wallets/overview")
    expect(loadSettingsBlock).not.toContain("/api/checkout-links")
    expect(loadSettingsBlock).not.toContain("/api/merchant/webhooks")
    expect(loadSettingsBlock).not.toContain("/api/inventory")
    expect(settings).toContain("const controller = new AbortController()")
    expect(settings).toContain("return () => controller.abort()")
    expect(settings).toContain("applyPayload(payload, authenticatedEmail)")
    expect(settings).not.toContain("}, [accountEmail])")
  })

  it("keeps dashboard layout session checks cheap and production logs sanitized", () => {
    const layout = read("app/dashboard/layout.tsx")
    const sessionEffect = layout.slice(
      layout.indexOf("async function checkSession()"),
      layout.indexOf("}, [pathname, router])")
    )

    expect(sessionEffect).toContain("supabase.auth.getSession()")
    expect(sessionEffect).not.toContain("/api/admin/me")
    expect(sessionEffect).toContain('process.env.NODE_ENV !== "production"')
    expect(sessionEffect).toContain("hasSession: Boolean(data.session)")
    expect(sessionEffect).not.toContain("data.session?.user?.email")
    expect(sessionEffect).not.toContain("document.cookie")
  })

  it("left-aligns the PineTree Wallet summary card and connected network pills", () => {
    const wallet = read("app/dashboard/wallet-setup/page.tsx")
    const chips = wallet.slice(
      wallet.indexOf("function EnabledRailChips("),
      wallet.indexOf("// ---------------------------------------------------------------------------\n// Activity tab")
    )
    const card = wallet.slice(
      wallet.indexOf("<article className="),
      wallet.indexOf("{/* Exactly one problem card renders")
    )

    expect(card).toContain(">PineTree Wallet</h2>")
    expect(chips).toContain("items-start text-left")
    expect(chips).toContain("Connected Networks")
    expect(chips).toContain("text-gray-950")
    expect(chips).toContain("justify-start gap-2.5")
    expect(chips).not.toContain("items-center text-center")
    expect(chips).not.toContain("text-blue-700/80")
    expect(chips).not.toContain("justify-center gap-2.5")
    expect(wallet).toContain("mt-auto flex justify-start pt-8")
    expect(wallet).not.toContain("mt-auto flex justify-center pt-8")
  })
})
