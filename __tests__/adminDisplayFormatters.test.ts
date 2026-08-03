import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  formatFilterLabel,
  formatNetworkName,
  formatPaymentSource,
  formatProviderName,
  formatRailName,
  isKnownRail,
} from "@/components/admin/displayFormatters"
import { resolveCanonicalPaymentSource } from "@/lib/utils/paymentSource"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

const reports = read("app/dashboard/admin/reports/page.tsx")
const explorer = read("app/dashboard/admin/transactions/page.tsx")
const overview = read("app/dashboard/admin/page.tsx")
const detailFormat = read("components/admin/TransactionDetail/format.ts")
const formatters = read("components/admin/displayFormatters.ts")

const ADMIN_SURFACES: Array<[string, string]> = [
  ["reports", reports],
  ["transactions", explorer],
  ["overview", overview],
]

describe("canonical provider names", () => {
  it.each([
    ["lightning_speed", "Bitcoin Lightning"],
    ["speed", "Bitcoin Lightning"],
    ["stripe", "Stripe"],
    ["shift4", "Shift4"],
    ["fluidpay", "FluidPay"],
    ["base", "Base Pay"],
    ["base_pay", "Base Pay"],
    ["solana", "Solana Pay"],
    ["solana_pay", "Solana Pay"],
    ["cash", "Cash"],
  ])("formatProviderName(%s) === %s", (raw, expected) => {
    expect(formatProviderName(raw)).toBe(expected)
  })

  it("normalizes casing and separator variations to one name", () => {
    for (const variant of [
      "LIGHTNING_SPEED",
      "lightning-speed",
      "Lightning Speed",
      "  lightning_speed  ",
      "LightningSpeed",
    ]) {
      expect(formatProviderName(variant), variant).toBe("Bitcoin Lightning")
    }
  })

  it("title-cases an unknown provider instead of showing snake_case", () => {
    expect(formatProviderName("some_new_provider")).toBe("Some New Provider")
    expect(formatProviderName("acme-payments")).toBe("Acme Payments")
    // Never crashes, never renders the raw identifier.
    expect(formatProviderName(null)).toBe("—")
    expect(formatProviderName(undefined)).toBe("—")
    expect(formatProviderName("")).toBe("—")
  })
})

describe("canonical rail names", () => {
  it.each([
    ["cash", "Cash"],
    ["card", "Card"],
    ["bitcoin_lightning", "Bitcoin Lightning"],
    ["lightning", "Bitcoin Lightning"],
    ["base", "Base"],
    ["solana", "Solana"],
  ])("formatRailName(%s) === %s", (raw, expected) => {
    expect(formatRailName(raw)).toBe(expected)
  })

  it("accepts the canonical rail values the projector already emits", () => {
    for (const rail of ["Base", "Solana", "Card", "Cash", "Bitcoin Lightning", "Ethereum"]) {
      expect(formatRailName(rail), rail).toBe(rail)
    }
  })

  it("keeps rail and provider vocabularies separate", () => {
    // Rail "Base" is settled by provider "Base Pay" — the rail must not borrow
    // the product name, and vice versa.
    expect(formatRailName("base")).toBe("Base")
    expect(formatProviderName("base")).toBe("Base Pay")
    expect(formatRailName("solana")).toBe("Solana")
    expect(formatProviderName("solana")).toBe("Solana Pay")

    // A card rail is settled by Stripe/Shift4/FluidPay; the rail stays "Card".
    expect(formatRailName("card")).toBe("Card")
    for (const provider of ["stripe", "shift4", "fluidpay"]) {
      expect(formatRailName("card")).not.toBe(formatProviderName(provider))
    }
  })

  it("never resolves a provider identifier to a rail name", () => {
    // The closed rail vocabulary is what makes `stripe` → "Stripe" impossible
    // in a rail column: an identifier that is not a rail reads "Unknown".
    const providerOnlyIdentifiers = [
      "stripe",
      "shift4",
      "fluidpay",
      "coinbase",
      "lightning_speed",
      "speed",
      "tryspeed",
      "base_pay",
      "solana_pay",
      "nwc",
      "phantom",
      "solflare",
      "metamask",
      "coinbase_wallet",
    ]
    for (const identifier of providerOnlyIdentifiers) {
      expect(formatRailName(identifier), identifier).toBe("Unknown")
      expect(isKnownRail(identifier), identifier).toBe(false)
      // And each of them IS a real provider name — proving the rail formatter
      // is refusing a value it could have mapped, not one it simply lacks.
      expect(formatProviderName(identifier), identifier).not.toBe("Unknown")
    }
  })

  it("collapses any unrecognized rail rather than inventing a label", () => {
    for (const notARail of ["polygon", "some_new_thing", "CONFIRMED", "pos"]) {
      expect(formatRailName(notARail), notARail).toBe("Unknown")
    }
    // The projector's own unresolved rails read the same way.
    expect(formatRailName("Other")).toBe("Unknown")
    expect(formatRailName("Unknown")).toBe("Unknown")
  })

  it("declares no provider-only key in the rail table", () => {
    const railTable = formatters.slice(
      formatters.indexOf("const RAIL_DISPLAY_NAMES"),
      formatters.indexOf("export function formatRailName")
    )
    for (const providerKey of ["stripe", "shift4", "fluidpay", "coinbase", "basepay", "solanapay", "speed"]) {
      expect(railTable, providerKey).not.toContain(`${providerKey}:`)
    }
  })

  it("returns an em dash rather than crashing on a missing rail", () => {
    // Absent and unrecognized are different: nothing to show vs not a rail.
    expect(formatRailName(null)).toBe("—")
    expect(formatRailName("")).toBe("—")
  })
})

describe("canonical network names", () => {
  it.each([
    ["bitcoin_lightning", "Bitcoin Lightning"],
    ["lightning", "Bitcoin Lightning"],
    ["base", "Base"],
    ["ethereum", "Ethereum"],
    ["solana", "Solana"],
    ["card", "Card Network"],
    ["cash", "Cash"],
  ])("formatNetworkName(%s) === %s", (raw, expected) => {
    expect(formatNetworkName(raw)).toBe(expected)
  })

  it("never exposes snake_case enum formatting", () => {
    expect(formatNetworkName("btc_lightning")).toBe("Bitcoin Lightning")
    expect(formatNetworkName(null)).toBe("—")
  })

  it("stays open to new chains, unlike the closed rail vocabulary", () => {
    // A new chain is legitimate stored network data, so it is title-cased.
    expect(formatNetworkName("some_new_network")).toBe("Some New Network")
    expect(formatNetworkName("polygon")).toBe("Polygon")
    // The same value is not a rail, so the rail column refuses it.
    expect(formatRailName("polygon")).toBe("Unknown")
  })

  it("normalizes the documented card-processor-in-network legacy rows", () => {
    // engine/canonicalTransactions.ts resolveRail() branches on
    // CARD_PROVIDERS.has(networkKey), so a processor name stored in
    // payments.network means the card rail — not a provider to name here.
    const engine = read("engine/canonicalTransactions.ts")
    expect(engine).toContain("CARD_PROVIDERS.has(networkKey)")
    for (const legacy of ["stripe", "shift4", "fluidpay"]) {
      expect(formatNetworkName(legacy), legacy).toBe("Card Network")
      expect(formatNetworkName(legacy), legacy).not.toBe(formatProviderName(legacy))
    }
  })
})

describe("canonical payment source names", () => {
  it.each([
    ["pos", "Terminal"],
    ["in_person", "Terminal"],
    ["terminal", "Terminal"],
    ["online", "Online Checkout"],
    ["ecommerce", "Online Checkout"],
    ["checkout", "Online Checkout"],
    ["api", "API"],
    ["invoice", "Invoice"],
  ])("formatPaymentSource(%s) === %s", (raw, expected) => {
    expect(formatPaymentSource(raw)).toBe(expected)
  })

  it("never defaults an untagged row into Terminal or Online Checkout", () => {
    for (const untagged of [null, undefined, "", "   ", "legacy_value"]) {
      expect(formatPaymentSource(untagged), String(untagged)).toBe("Unknown source")
    }
  })

  it("is the same mapping the engine projects onto the canonical record", () => {
    expect(resolveCanonicalPaymentSource("pos")).toEqual({ key: "terminal", label: "Terminal" })
    expect(resolveCanonicalPaymentSource("in_person").key).toBe("terminal")
    expect(resolveCanonicalPaymentSource(null)).toEqual({
      key: "unknown",
      label: "Unknown source",
    })
    // Engine re-exports the shared resolver rather than keeping a second copy.
    const engine = read("engine/canonicalTransactions.ts")
    expect(engine).toContain('from "@/lib/utils/paymentSource"')
    expect(engine).not.toContain("const PAYMENT_SOURCE_LABELS")
  })

  it("does not guess a source from the provider", () => {
    for (const provider of ["stripe", "shift4", "base", "solana", "lightning_speed"]) {
      expect(formatPaymentSource(provider), provider).toBe("Unknown source")
    }
  })
})

describe("filter labels keep raw values and polished text", () => {
  it("labels each filter with its own vocabulary", () => {
    expect(formatFilterLabel("provider", "lightning_speed")).toBe("Bitcoin Lightning")
    expect(formatFilterLabel("network", "bitcoin_lightning")).toBe("Bitcoin Lightning")
    expect(formatFilterLabel("rail", "card")).toBe("Card")
    expect(formatFilterLabel("source", "pos")).toBe("Terminal")
    // A network filter can never be labelled with a provider product name.
    expect(formatFilterLabel("network", "solana")).toBe("Solana")
    expect(formatFilterLabel("provider", "solana")).toBe("Solana Pay")
  })

  it("keeps Transaction Explorer filter request values canonical", () => {
    // Values stay raw for the API comparison; only the option text is formatted.
    expect(explorer).toContain('const NETWORK_FILTER_VALUES = ["solana", "base", "ethereum", "bitcoin_lightning"]')
    expect(explorer).toContain("{formatNetworkName(value)}")
    expect(explorer).toContain("{formatProviderName(value)}")
    // No hand-maintained option label that could drift from the formatter.
    expect(explorer).not.toContain('label: "Bitcoin Lightning" }')
    expect(explorer).not.toContain('{ value: "lightning", label: "Lightning" }')
  })

  it("formats the active filter pills", () => {
    expect(explorer).toContain("Network: {formatNetworkName(applied.network)}")
    expect(explorer).toContain("Provider: {formatProviderName(applied.provider)}")
  })
})

describe("admin surfaces share one formatter", () => {
  it("imports the shared module on every admin surface", () => {
    for (const [name, source] of ADMIN_SURFACES) {
      expect(source, name).toContain('from "@/components/admin/displayFormatters"')
    }
    expect(detailFormat).toContain('from "@/components/admin/displayFormatters"')
  })

  it("leaves no duplicate provider or network mapping object in a page", () => {
    for (const [name, source] of ADMIN_SURFACES) {
      expect(source, name).not.toContain("const PROVIDER_LABELS")
      expect(source, name).not.toContain("const NETWORK_LABELS")
      expect(source, name).not.toContain("const RAIL_LABELS")
      // Pages no longer reach past the Admin formatter to the dashboard helpers.
      expect(source, name).not.toContain("formatDashboardProvider")
      expect(source, name).not.toContain("formatDashboardNetwork")
    }
    // The underlying naming tables exist in exactly one place each.
    const helpers = read("components/dashboard/displayHelpers.ts")
    expect(helpers).toContain("const PROVIDER_DISPLAY_NAMES")
    expect(helpers).toContain("const NETWORK_DISPLAY_NAMES")
    expect(formatters).toContain("const RAIL_DISPLAY_NAMES")
    expect(formatters).not.toContain("const PROVIDER_DISPLAY_NAMES")
  })

  it("renders report rows through the formatter, never the raw key", () => {
    expect(reports).toContain("{formatRailName(net)}")
    expect(reports).toContain("{formatProviderName(prov)}")
    expect(reports).toContain("{formatNetworkName(row.network)}")
    // The old raw fallbacks that leaked `stripe` and `lightning_speed`.
    expect(reports).not.toContain("?? net}")
    expect(reports).not.toContain("?? prov}")

    // No raw provider/rail identifier reaches the rendered markup.
    const reportsJsx = reports.slice(reports.indexOf("<AdminPageHeader"))
    for (const rawIdentifier of ["lightning_speed", "base_pay", "solana_pay", "btc_lightning"]) {
      expect(reportsJsx, rawIdentifier).not.toContain(rawIdentifier)
    }
  })

  it("names providers the same way on every admin surface", () => {
    // Provider Operations previously hard-coded its own ternary, which spelled
    // the same provider "Fluid Pay" while the formatter says "FluidPay".
    expect(overview).toContain("const providerLabel = formatProviderName(item.provider)")
    expect(overview).not.toContain('item.provider === "stripe" ? "Stripe"')
    expect(overview).not.toContain("Fluid Pay")

    // Attempt rows in the shared detail panel format their network too.
    const panel = read("components/admin/TransactionDetail/AdminTransactionDetailPanel.tsx")
    expect(panel).toContain("formatNetworkName(attempt.network)")
  })

  it("uses one user-facing name for payment origin everywhere", () => {
    const panel = read("components/admin/TransactionDetail/AdminTransactionDetailPanel.tsx")
    const merchantActivity = read("app/dashboard/TransactionActivityTable.tsx")

    // "Payment Source" is the user-facing label on both admin and merchant.
    expect(panel).toContain('label="Payment Source"')
    expect(merchantActivity).toContain('label: "Payment Source"')

    // "Stored Source" is reserved for the raw diagnostic value inside Admin.
    expect(panel).toContain('label="Stored Source"')
    expect(merchantActivity).not.toContain("Stored Source")

    // The retired label is gone from both, and neither renders a raw channel.
    for (const [name, source] of [["panel", panel], ["merchant", merchantActivity]] as const) {
      expect(source, name).not.toContain('label="Channel"')
      expect(source, name).not.toContain('label: "Channel"')
    }
    expect(merchantActivity).toContain("formatPaymentSource(tx.channel)")
    // Merchant reads the shared vocabulary from lib, not from the Admin module.
    expect(merchantActivity).toContain('from "@/lib/utils/paymentSource"')
    expect(merchantActivity).not.toContain("@/components/admin/")
  })

  it("pairs every column label with its own vocabulary", () => {
    const panel = read("components/admin/TransactionDetail/AdminTransactionDetailPanel.tsx")

    // A column headed "Rail" renders formatRailName; one headed "Network"
    // renders formatNetworkName. The two are never crossed.
    expect(overview).toContain('"Provider", "Rail", "Amount"')
    expect(overview).toContain("formatRailName(rail)")
    expect(explorer).toContain('"Provider", "Rail", "Amount"')
    expect(explorer).toContain("formatRailName(rail)")
    expect(panel).toContain('label="Rail"')
    expect(panel).toContain("adminPaymentRailLabel(payment)")

    // Raw network stays in diagnostics under an explicitly "Stored" label.
    expect(panel).toContain('label="Stored Network"')
    expect(panel).not.toContain('label="Network / Rail"')

    // The stale diagnostic's Network column keeps the network vocabulary.
    expect(reports).toContain("{formatNetworkName(row.network)}")
  })

  it("uses separate functions for provider and rail in the report tables", () => {
    const railTable = reports.slice(
      reports.indexOf('title="Volume by Rail"'),
      reports.indexOf('title="Volume by Provider"')
    )
    const providerTable = reports.slice(
      reports.indexOf('title="Volume by Provider"'),
      reports.indexOf('title="Top Merchants by Volume"')
    )
    expect(railTable).toContain("formatRailName")
    expect(railTable).not.toContain("formatProviderName")
    expect(providerTable).toContain("formatProviderName")
    expect(providerTable).not.toContain("formatRailName")
  })

  it("leaves report table alignment owned by the shared AdminMetricTable", () => {
    const metricTable = read("components/admin/AdminMetricTable.tsx")
    expect(metricTable).toContain("text-right tabular-nums")
    expect(metricTable.match(/style=\{\{ gridTemplateColumns \}\}/g)).toHaveLength(2)

    // Naming cleanup did not reintroduce per-table grid definitions.
    expect(reports).not.toContain("grid-cols-[1fr_90px_90px_110px_100px_80px]")
    expect(reports).not.toContain("grid-cols-[1fr_100px_120px]")
    expect(reports.match(/columns=\{VOLUME_COLUMNS\}/g)).toHaveLength(2)
    expect(reports.match(/<AdminMetricTable/g)).toHaveLength(3)
  })

  it("keeps rail and provider naming inside the shared expandable rows", () => {
    // The mobile redesign did not fork naming: both tables still pass the same
    // column definitions and their own formatter to one component.
    expect(reports).toContain("formatRailName(net)")
    expect(reports).toContain("formatProviderName(prov)")
    expect(reports).not.toContain("MobileRail")
    expect(reports).not.toContain("MobileProvider")
  })
})
