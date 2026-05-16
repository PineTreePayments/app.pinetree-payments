import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import {
  PAYMENT_APP_REGISTRY,
  deriveLightningWalletAction,
  getAppsForRail,
  type PaymentApp,
  type LightningWalletAction,
} from "@/lib/wallets/paymentAppRegistry"

// ─── Scenario types ───────────────────────────────────────────────────────────

type LightningSimScenario = {
  label: string
  description: string
  walletId: string
  /** Platform determines which store URL is surfaced as fallback */
  platform: "ios" | "android" | "desktop"
  /** Whether the wallet app is considered installed (cannot be detected reliably in browsers) */
  assumedInstalled: boolean
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

function makeScenarios(): LightningSimScenario[] {
  return [
    // ── Cash App ──────────────────────────────────────────────────────────────
    {
      label: "cash_app_ios_installed",
      description: "Cash App installed on iOS — navigate to lightning: URI; Cash App opens",
      walletId: "cash-app",
      platform: "ios",
      assumedInstalled: true,
    },
    {
      label: "cash_app_ios_not_installed",
      description:
        "Cash App NOT installed on iOS — navigate to lightning: URI; browser can't open it; " +
        "after 1.4 s timeout offer App Store fallback",
      walletId: "cash-app",
      platform: "ios",
      assumedInstalled: false,
    },
    {
      label: "cash_app_android_installed",
      description: "Cash App installed on Android — navigate to lightning: URI; Cash App opens",
      walletId: "cash-app",
      platform: "android",
      assumedInstalled: true,
    },
    {
      label: "cash_app_android_not_installed",
      description: "Cash App NOT installed on Android — timeout then Play Store",
      walletId: "cash-app",
      platform: "android",
      assumedInstalled: false,
    },

    // ── Strike ────────────────────────────────────────────────────────────────
    {
      label: "strike_ios_installed",
      description: "Strike installed on iOS — navigate to lightning: URI; Strike opens",
      walletId: "strike",
      platform: "ios",
      assumedInstalled: true,
    },
    {
      label: "strike_ios_not_installed",
      description:
        "Strike NOT installed on iOS — navigate to lightning: URI; timeout then App Store",
      walletId: "strike",
      platform: "ios",
      assumedInstalled: false,
    },
    {
      label: "strike_android_installed",
      description: "Strike installed on Android — navigate to lightning: URI; Strike opens",
      walletId: "strike",
      platform: "android",
      assumedInstalled: true,
    },
    {
      label: "strike_android_not_installed",
      description: "Strike NOT installed on Android — timeout then Play Store",
      walletId: "strike",
      platform: "android",
      assumedInstalled: false,
    },

    // ── Phoenix ───────────────────────────────────────────────────────────────
    {
      label: "phoenix_ios_installed",
      description: "Phoenix installed on iOS — navigate to phoenix:lightning:${invoice}; Phoenix opens",
      walletId: "phoenix",
      platform: "ios",
      assumedInstalled: true,
    },
    {
      label: "phoenix_ios_not_installed",
      description: "Phoenix NOT installed on iOS — timeout then App Store",
      walletId: "phoenix",
      platform: "ios",
      assumedInstalled: false,
    },
    {
      label: "phoenix_android_installed",
      description: "Phoenix installed on Android — navigate to phoenix:lightning:${invoice}; Phoenix opens",
      walletId: "phoenix",
      platform: "android",
      assumedInstalled: true,
    },
    {
      label: "phoenix_android_not_installed",
      description: "Phoenix NOT installed on Android — timeout then Play Store",
      walletId: "phoenix",
      platform: "android",
      assumedInstalled: false,
    },

    // ── Zeus ──────────────────────────────────────────────────────────────────
    {
      label: "zeus_ios_installed",
      description: "Zeus installed on iOS — navigate to zeusln:${invoice}; Zeus opens",
      walletId: "zeus",
      platform: "ios",
      assumedInstalled: true,
    },
    {
      label: "zeus_ios_not_installed",
      description: "Zeus NOT installed on iOS — timeout then App Store",
      walletId: "zeus",
      platform: "ios",
      assumedInstalled: false,
    },
    {
      label: "zeus_android_installed",
      description: "Zeus installed on Android — navigate to zeusln:${invoice}; Zeus opens",
      walletId: "zeus",
      platform: "android",
      assumedInstalled: true,
    },
    {
      label: "zeus_android_not_installed",
      description: "Zeus NOT installed on Android — timeout then Play Store",
      walletId: "zeus",
      platform: "android",
      assumedInstalled: false,
    },

    // ── Wallet of Satoshi ─────────────────────────────────────────────────────
    {
      label: "wallet_of_satoshi_ios_installed",
      description: "Wallet of Satoshi installed on iOS — navigate to lightning: URI",
      walletId: "wallet-of-satoshi",
      platform: "ios",
      assumedInstalled: true,
    },
    {
      label: "wallet_of_satoshi_ios_not_installed",
      description: "Wallet of Satoshi NOT installed on iOS — timeout then App Store",
      walletId: "wallet-of-satoshi",
      platform: "ios",
      assumedInstalled: false,
    },
    {
      label: "wallet_of_satoshi_android_installed",
      description: "Wallet of Satoshi installed on Android — navigate to lightning: URI",
      walletId: "wallet-of-satoshi",
      platform: "android",
      assumedInstalled: true,
    },
    {
      label: "wallet_of_satoshi_android_not_installed",
      description: "Wallet of Satoshi NOT installed on Android — timeout then Play Store",
      walletId: "wallet-of-satoshi",
      platform: "android",
      assumedInstalled: false,
    },

    // ── Muun ─────────────────────────────────────────────────────────────────
    {
      label: "muun_ios_installed",
      description: "Muun installed on iOS — navigate to lightning: URI; Muun opens",
      walletId: "muun",
      platform: "ios",
      assumedInstalled: true,
    },
    {
      label: "muun_ios_not_installed",
      description: "Muun NOT installed on iOS — timeout then App Store",
      walletId: "muun",
      platform: "ios",
      assumedInstalled: false,
    },
    {
      label: "muun_android_installed",
      description: "Muun installed on Android — navigate to lightning: URI; Muun opens",
      walletId: "muun",
      platform: "android",
      assumedInstalled: true,
    },
    {
      label: "muun_android_not_installed",
      description: "Muun NOT installed on Android — timeout then Play Store",
      walletId: "muun",
      platform: "android",
      assumedInstalled: false,
    },

    // ── Breez ─────────────────────────────────────────────────────────────────
    {
      label: "breez_ios_installed",
      description: "Breez installed on iOS — navigate to breez:${invoice}; Breez opens",
      walletId: "breez",
      platform: "ios",
      assumedInstalled: true,
    },
    {
      label: "breez_ios_not_installed",
      description: "Breez NOT installed on iOS — timeout then App Store",
      walletId: "breez",
      platform: "ios",
      assumedInstalled: false,
    },
    {
      label: "breez_android_installed",
      description: "Breez installed on Android — navigate to breez:${invoice}; Breez opens",
      walletId: "breez",
      platform: "android",
      assumedInstalled: true,
    },
    {
      label: "breez_android_not_installed",
      description: "Breez NOT installed on Android — timeout then Play Store",
      walletId: "breez",
      platform: "android",
      assumedInstalled: false,
    },

    // ── BlueWallet ────────────────────────────────────────────────────────────
    {
      label: "bluewallet_ios_installed",
      description: "BlueWallet installed on iOS — navigate to bluewallet:lightning:${invoice}; BlueWallet opens",
      walletId: "bluewallet",
      platform: "ios",
      assumedInstalled: true,
    },
    {
      label: "bluewallet_ios_not_installed",
      description: "BlueWallet NOT installed on iOS — timeout then App Store",
      walletId: "bluewallet",
      platform: "ios",
      assumedInstalled: false,
    },
    {
      label: "bluewallet_android_installed",
      description: "BlueWallet installed on Android — navigate to bluewallet:lightning:${invoice}; BlueWallet opens",
      walletId: "bluewallet",
      platform: "android",
      assumedInstalled: true,
    },
    {
      label: "bluewallet_android_not_installed",
      description: "BlueWallet NOT installed on Android — timeout then Play Store",
      walletId: "bluewallet",
      platform: "android",
      assumedInstalled: false,
    },

    // ── Generic invoice fallback ──────────────────────────────────────────────
    {
      label: "generic_lightning_uri_ios",
      description:
        "Generic 'Pay with installed Lightning wallet' button — navigates to lightning:${invoice}; " +
        "OS routes to any installed wallet that handles lightning: URI",
      walletId: "cash-app",
      platform: "ios",
      assumedInstalled: false,
    },

    // ── No wallet installed ───────────────────────────────────────────────────
    {
      label: "no_wallet_ios",
      description:
        "No Lightning wallet installed on iOS — all wallets show 'Pay invoice' (attempt) " +
        "with store fallback after timeout",
      walletId: "cash-app",
      platform: "ios",
      assumedInstalled: false,
    },
    {
      label: "no_wallet_desktop",
      description: "Desktop — QR code shown; wallet picker offers install links",
      walletId: "cash-app",
      platform: "desktop",
      assumedInstalled: false,
    },

    // ── Return-from-wallet recovery scenarios ─────────────────────────────────
    {
      label: "cash_app_returned_without_paying",
      description:
        "Cash App opened (lightning: URI), customer returned to payment page without paying. " +
        "visibilitychange/pageshow fires; noPayAfterReturn=true; recovery UI shown with " +
        "'Try again with Cash App' and 'Switch payment method'.",
      walletId: "cash-app",
      platform: "ios",
      assumedInstalled: true,
    },
    {
      label: "strike_returned_without_paying",
      description:
        "Strike opened, customer returned without paying. Same recovery path as Cash App.",
      walletId: "strike",
      platform: "ios",
      assumedInstalled: true,
    },
    {
      label: "phoenix_returned_without_paying",
      description:
        "Phoenix opened via phoenix:lightning: scheme, customer returned without paying. " +
        "Recovery UI offers retry or switch.",
      walletId: "phoenix",
      platform: "ios",
      assumedInstalled: true,
    },
    {
      label: "zeus_returned_without_paying",
      description:
        "Zeus opened via zeusln: scheme, customer returned without paying.",
      walletId: "zeus",
      platform: "ios",
      assumedInstalled: true,
    },
    {
      label: "muun_returned_without_paying",
      description:
        "Muun opened via lightning: URI, customer returned without paying.",
      walletId: "muun",
      platform: "ios",
      assumedInstalled: true,
    },
    {
      label: "breez_returned_without_paying",
      description:
        "Breez opened via breez: scheme, customer returned without paying.",
      walletId: "breez",
      platform: "ios",
      assumedInstalled: true,
    },
    {
      label: "bluewallet_returned_without_paying",
      description:
        "BlueWallet opened via bluewallet:lightning: scheme, customer returned without paying.",
      walletId: "bluewallet",
      platform: "ios",
      assumedInstalled: true,
    },

    // ── Switch payment method ─────────────────────────────────────────────────
    {
      label: "switch_method_after_timeout",
      description:
        "Customer did not pay within 1.4 s timeout window and declined the App Store fallback. " +
        "Recovery UI offers 'Switch payment method' which calls onCancel() to deselect Lightning.",
      walletId: "cash-app",
      platform: "ios",
      assumedInstalled: false,
    },

    // ── Retry after failed attempt ────────────────────────────────────────────
    {
      label: "retry_after_failed_open",
      description:
        "Wallet link failed to open (no app installed, user dismissed App Store). " +
        "noPayAfterReturn=true on page return. Customer taps 'Try again' to re-open wallet picker.",
      walletId: "wallet-of-satoshi",
      platform: "android",
      assumedInstalled: false,
    },
  ]
}

// ─── Store fallback URL helper ────────────────────────────────────────────────

type AppStoreFallback = {
  platform: "ios" | "android" | "desktop"
  url: string
  label: string
}

const STORE_URLS: Record<
  string,
  { ios?: string; android?: string; universal: string }
> = {
  "cash-app": {
    ios: "https://apps.apple.com/us/app/cash-app/id711923939",
    android: "https://play.google.com/store/apps/details?id=com.squareup.cash",
    universal: "https://cash.app/download",
  },
  strike: {
    ios: "https://apps.apple.com/us/app/strike-btc-global-money/id1488724463",
    android: "https://play.google.com/store/search?q=Strike%20Bitcoin&c=apps",
    universal: "https://strike.me/download",
  },
  phoenix: {
    ios: "https://apps.apple.com/us/search?term=Phoenix%20Wallet%20Bitcoin",
    android: "https://play.google.com/store/search?q=Phoenix%20Wallet%20Bitcoin&c=apps",
    universal: "https://phoenix.acinq.co",
  },
  zeus: {
    ios: "https://apps.apple.com/us/app/zeus-wallet/id1456038895",
    android: "https://play.google.com/store/search?q=ZEUS%20Wallet&c=apps",
    universal: "https://zeusln.app",
  },
  "wallet-of-satoshi": {
    ios: "https://apps.apple.com/us/search?term=Wallet%20of%20Satoshi",
    android: "https://play.google.com/store/apps/details?id=com.livingroomofsatoshi.wallet",
    universal: "https://www.walletofsatoshi.com",
  },
  muun: {
    ios: "https://apps.apple.com/us/search?term=Muun%20Bitcoin%20Lightning",
    android: "https://play.google.com/store/search?q=Muun%20Bitcoin%20Lightning&c=apps",
    universal: "https://muun.com",
  },
  breez: {
    ios: "https://apps.apple.com/us/search?term=Breez%20Lightning%20Wallet",
    android: "https://play.google.com/store/search?q=Breez%20Lightning%20Wallet&c=apps",
    universal: "https://breez.technology",
  },
  bluewallet: {
    ios: "https://apps.apple.com/us/search?term=BlueWallet",
    android: "https://play.google.com/store/search?q=BlueWallet&c=apps",
    universal: "https://bluewallet.io",
  },
}

function getStoreFallback(walletId: string, platform: "ios" | "android" | "desktop"): AppStoreFallback {
  const urls = STORE_URLS[walletId]
  const app = PAYMENT_APP_REGISTRY[walletId]
  if (!urls) {
    return { platform, url: app?.installUrl ?? "", label: "Visit website" }
  }
  if (platform === "ios" && urls.ios) return { platform, url: urls.ios, label: "App Store" }
  if (platform === "android" && urls.android) return { platform, url: urls.android, label: "Google Play" }
  return { platform, url: urls.universal, label: "Visit website" }
}

// ─── Invoice URL builder ──────────────────────────────────────────────────────

const INVOICE_URL_BUILDERS: Record<string, (invoice: string) => string> = {
  phoenix:    (invoice) => `phoenix:lightning:${invoice}`,
  zeus:       (invoice) => `zeusln:${invoice}`,
  breez:      (invoice) => `breez:${invoice}`,
  bluewallet: (invoice) => `bluewallet:lightning:${invoice}`,
}

function buildInvoiceUrl(walletId: string, invoice: string): string {
  const builder = INVOICE_URL_BUILDERS[walletId]
  if (builder) return builder(invoice)
  return `lightning:${invoice}`
}

// ─── Open strategy description ────────────────────────────────────────────────

function describeOpenStrategy(app: PaymentApp, platform: "ios" | "android" | "desktop"): string {
  if (platform === "desktop") {
    return "Desktop: show QR code and manual invoice copy. Wallet picker provides install links."
  }
  if (app.mobileOpenStrategy === "lightning_uri") {
    return (
      "Navigate to lightning:INVOICE. The OS routes to any installed app that handles the " +
      "lightning: URI scheme. After 1.4 s, if the page is still visible, offer the app store as a fallback."
    )
  }
  if (app.mobileOpenStrategy === "invoice_scheme") {
    return (
      `Navigate to ${app.nativeScheme ?? "wallet-specific-scheme:"}INVOICE. ` +
      "If the app is not installed the browser may show an error. " +
      "After 1.4 s, if the page is still visible, offer the app store as a fallback."
    )
  }
  return "No mobile open strategy available — offer install link directly."
}

// ─── Pass/fail validation ─────────────────────────────────────────────────────

function buildValidation(
  app: PaymentApp,
  scenario: LightningSimScenario,
  action: LightningWalletAction,
  invoiceUrl: string,
  storeFallback: AppStoreFallback,
): {
  pass: boolean
  expectedAction: LightningWalletAction
  actualAction: LightningWalletAction
  expectedOpenStrategy: string
  actualOpenStrategy: string
  expectedCustomerLabel: string
  actualCustomerLabel: string
  reason: string
} {
  const issues: string[] = []

  if (!app.railSupport.includes("bitcoin_lightning")) {
    issues.push("app.railSupport does not include 'bitcoin_lightning'")
  }

  if (app.supportsLightningInvoice && action !== "pay_invoice") {
    issues.push(`app.supportsLightningInvoice is true but action is '${action}'`)
  }

  if (action === "pay_invoice") {
    // Verify invoice URL scheme matches registry's mobileOpenStrategy
    if (app.mobileOpenStrategy === "lightning_uri" && !invoiceUrl.startsWith("lightning:")) {
      issues.push(
        `strategy is 'lightning_uri' but invoiceUrl starts with '${invoiceUrl.substring(0, 20)}'`,
      )
    }
    if (app.mobileOpenStrategy === "invoice_scheme" && app.nativeScheme) {
      if (!invoiceUrl.startsWith(app.nativeScheme)) {
        issues.push(
          `nativeScheme is '${app.nativeScheme}' but invoiceUrl starts with '${invoiceUrl.substring(0, 20)}'`,
        )
      }
    }
  }

  // Verify store fallback URL exists for non-desktop scenarios
  if (scenario.platform !== "desktop" && !storeFallback.url) {
    issues.push("no store fallback URL for mobile scenario")
  }

  const customerLabel = action === "pay_invoice" ? "Pay invoice" : "Install"
  return {
    pass: issues.length === 0,
    expectedAction: action,
    actualAction: action,
    expectedOpenStrategy: app.mobileOpenStrategy,
    actualOpenStrategy: app.mobileOpenStrategy,
    expectedCustomerLabel: customerLabel,
    actualCustomerLabel: customerLabel,
    reason: issues.length === 0 ? "All checks passed" : issues.join("; "),
  }
}

// ─── Build a single result row ────────────────────────────────────────────────

function buildResult(scenario: LightningSimScenario) {
  const app = PAYMENT_APP_REGISTRY[scenario.walletId]
  if (!app) {
    return {
      scenario: scenario.label,
      error: `Unknown walletId: ${scenario.walletId}`,
      validation: { pass: false, reason: `Unknown walletId: ${scenario.walletId}` },
    }
  }

  const action = deriveLightningWalletAction(app)
  const storeFallback = getStoreFallback(scenario.walletId, scenario.platform)
  const exampleInvoice = "lnbc1500n1example..."
  const invoiceUrl = buildInvoiceUrl(scenario.walletId, exampleInvoice)
  const validation = buildValidation(app, scenario, action, invoiceUrl, storeFallback)

  return {
    scenario: scenario.label,
    description: scenario.description,
    wallet: {
      id: app.id,
      displayName: app.displayName,
      appFamily: app.appFamily,
    },
    input: {
      platform: scenario.platform,
      assumedInstalled: scenario.assumedInstalled,
    },
    result: {
      action,
      customerFacingLabel: action === "pay_invoice" ? "Pay invoice" : "Install",
      mobileOpenStrategy: app.mobileOpenStrategy,
      invoiceUrl,
      openStrategy: describeOpenStrategy(app, scenario.platform),
      storeFallback,
    },
    ui: {
      showPayInvoice: action === "pay_invoice" && scenario.platform !== "desktop",
      showInstall:
        action === "install" ||
        (action === "pay_invoice" && !scenario.assumedInstalled && scenario.platform !== "desktop"),
      showQrCode: scenario.platform === "desktop",
      showOpenApp: action === "pay_invoice" && scenario.platform !== "desktop",
      storeLabel: storeFallback.label,
      storeUrl: storeFallback.url,
    },
    validation,
    notes: app.notes ?? null,
  }
}

// ─── All wallets summary ──────────────────────────────────────────────────────

function buildAllWalletsSummary() {
  return getAppsForRail("bitcoin_lightning").map((app) => {
    const action = deriveLightningWalletAction(app)
    return {
      id: app.id,
      displayName: app.displayName,
      mobileOpenStrategy: app.mobileOpenStrategy,
      nativeScheme: app.nativeScheme ?? null,
      customerFacingLabel: action === "pay_invoice" ? "Pay invoice" : "Install",
      supportsLightningInvoice: app.supportsLightningInvoice,
    }
  })
}

// ─── Missing coverage ─────────────────────────────────────────────────────────

function buildMissingCoverage(coveredIds: Set<string>) {
  return getAppsForRail("bitcoin_lightning")
    .filter((app) => !coveredIds.has(app.id))
    .map((app) => ({ id: app.id, displayName: app.displayName }))
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)

    const scenarios = makeScenarios()
    const results = scenarios.map(buildResult)

    const passed = results.filter((r) => r.validation?.pass === true).length
    const failed = results.filter((r) => r.validation?.pass === false).length
    const coveredIds = new Set(results.map((r) => r.wallet?.id).filter(Boolean) as string[])
    const missingCoverage = buildMissingCoverage(coveredIds)

    return NextResponse.json({
      ok: true,
      summary: {
        total: results.length,
        passed,
        failed,
        missingCoverage,
        allWallets: buildAllWalletsSummary(),
      },
      note: [
        "Cash App, Strike, Wallet of Satoshi, and Muun use the standard lightning: URI scheme.",
        "Phoenix uses phoenix:lightning:, Zeus uses zeusln:, Breez uses breez:, BlueWallet uses bluewallet:lightning:.",
        "All mobile paths attempt to open the app first, then fall back to the store",
        "after a 1.4 s timeout if the page remains visible.",
        "Deep-link detection is not possible in browsers; the timeout pattern is the standard safe approach.",
        "Validation checks: rail support, invoiceUrl scheme vs registry mobileOpenStrategy/nativeScheme, store fallback URL.",
      ].join(" "),
      results,
    })
  } catch (err) {
    const status = getRouteErrorStatus(err)
    const message = err instanceof Error ? err.message : "Simulator error"
    return NextResponse.json({ error: message }, { status })
  }
}

// POST — simulate a single custom scenario
export async function POST(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)

    const body = (await req.json()) as {
      walletId?: string
      platform?: "ios" | "android" | "desktop"
      assumedInstalled?: boolean
    }

    const walletId = String(body.walletId || "cash-app")
    const platform = (body.platform === "ios" || body.platform === "android" || body.platform === "desktop")
      ? body.platform
      : "ios"
    const assumedInstalled = Boolean(body.assumedInstalled ?? false)

    const app = PAYMENT_APP_REGISTRY[walletId]
    if (!app) {
      const validIds = getAppsForRail("bitcoin_lightning").map((a) => a.id).join(", ")
      return NextResponse.json(
        { error: `Unknown walletId: ${walletId}. Valid Lightning wallet IDs: ${validIds}` },
        { status: 400 },
      )
    }

    const scenario: LightningSimScenario = {
      label: "custom",
      description: "Custom POST scenario",
      walletId,
      platform,
      assumedInstalled,
    }

    return NextResponse.json({ ok: true, result: buildResult(scenario) })
  } catch (err) {
    const status = getRouteErrorStatus(err)
    const message = err instanceof Error ? err.message : "Simulator error"
    return NextResponse.json({ error: message }, { status })
  }
}
