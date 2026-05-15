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

    // ── Phoenix ───────────────────────────────────────────────────────────────
    {
      label: "phoenix_ios_installed",
      description: "Phoenix installed — navigate to phoenix:lightning:${invoice}; Phoenix opens",
      walletId: "phoenix",
      platform: "ios",
      assumedInstalled: true,
    },
    {
      label: "phoenix_ios_not_installed",
      description: "Phoenix NOT installed — timeout then App Store",
      walletId: "phoenix",
      platform: "ios",
      assumedInstalled: false,
    },

    // ── Zeus ──────────────────────────────────────────────────────────────────
    {
      label: "zeus_ios_installed",
      description: "Zeus installed — navigate to zeusln:${invoice}; Zeus opens",
      walletId: "zeus",
      platform: "ios",
      assumedInstalled: true,
    },

    // ── Wallet of Satoshi ─────────────────────────────────────────────────────
    {
      label: "wallet_of_satoshi_ios",
      description: "Wallet of Satoshi on iOS — lightning: URI; store fallback if not installed",
      walletId: "wallet-of-satoshi",
      platform: "ios",
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
  phoenix: (invoice) => `phoenix:lightning:${invoice}`,
  zeus: (invoice) => `zeusln:${invoice}`,
  breez: (invoice) => `breez:${invoice}`,
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
      "Navigate to lightning:${invoice}. The OS routes to any installed app that handles the " +
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

// ─── Build a single result row ────────────────────────────────────────────────

function buildResult(scenario: LightningSimScenario) {
  const app = PAYMENT_APP_REGISTRY[scenario.walletId]
  if (!app) {
    return {
      scenario: scenario.label,
      error: `Unknown walletId: ${scenario.walletId}`,
    }
  }

  const action = deriveLightningWalletAction(app)
  const storeFallback = getStoreFallback(scenario.walletId, scenario.platform)
  const exampleInvoice = "lnbc1500n1example..."
  const invoiceUrl = buildInvoiceUrl(scenario.walletId, exampleInvoice)

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

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)

    const scenarios = makeScenarios()
    const results = scenarios.map(buildResult)

    return NextResponse.json({
      ok: true,
      summary: {
        total: results.length,
        allWallets: buildAllWalletsSummary(),
      },
      note: [
        "Cash App and Strike use the standard lightning: URI scheme.",
        "Phoenix, Zeus, Breez, and BlueWallet use wallet-specific invoice URI schemes.",
        "All mobile paths attempt to open the app first, then fall back to the store",
        "after a 1.4 s timeout if the page remains visible.",
        "Deep-link detection is not possible in browsers; the timeout pattern is the",
        "standard safe approach.",
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
