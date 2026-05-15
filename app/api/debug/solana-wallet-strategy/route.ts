import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import {
  PAYMENT_APP_REGISTRY,
  deriveSolanaWalletAction,
  getAppsForRail,
  type PaymentApp,
  type SolanaWalletAction,
} from "@/lib/wallets/paymentAppRegistry"

// ─── Scenario types ───────────────────────────────────────────────────────────

type SolanaSimScenario = {
  label: string
  description: string
  walletId: string
  providerDetected: boolean
  isMobile: boolean
  /** True when the browser is on desktop and a Solana provider is injected */
  desktopProviderInjected?: boolean
  /** True when no wallet is installed at all */
  noWalletInstalled?: boolean
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

function makeScenarios(): SolanaSimScenario[] {
  return [
    // ── Phantom ────────────────────────────────────────────────────────────────
    {
      label: "phantom_mobile_installed",
      description: "Phantom installed on mobile — provider detected via wallet-standard or window.phantom",
      walletId: "phantom",
      providerDetected: true,
      isMobile: true,
    },
    {
      label: "phantom_mobile_not_installed",
      description: "Phantom NOT installed on mobile — show Open app (Phantom browser URL)",
      walletId: "phantom",
      providerDetected: false,
      isMobile: true,
    },
    {
      label: "phantom_desktop_injected",
      description: "Phantom extension installed on desktop — provider injected into browser",
      walletId: "phantom",
      providerDetected: true,
      isMobile: false,
      desktopProviderInjected: true,
    },
    {
      label: "phantom_desktop_not_installed",
      description: "Phantom not installed on desktop — show Install",
      walletId: "phantom",
      providerDetected: false,
      isMobile: false,
    },

    // ── Solflare ──────────────────────────────────────────────────────────────
    {
      label: "solflare_mobile_installed",
      description: "Solflare installed on mobile — provider detected",
      walletId: "solflare",
      providerDetected: true,
      isMobile: true,
    },
    {
      label: "solflare_mobile_not_installed",
      description: "Solflare NOT installed on mobile — Open app via Universal Link v1",
      walletId: "solflare",
      providerDetected: false,
      isMobile: true,
    },

    // ── Trust Wallet ──────────────────────────────────────────────────────────
    {
      label: "trust_wallet_mobile_not_installed",
      description: "Trust Wallet on mobile — Open app via trustwallet universal link",
      walletId: "trust-wallet",
      providerDetected: false,
      isMobile: true,
    },

    // ── Coinbase Wallet (self-custody) ────────────────────────────────────────
    {
      label: "coinbase_wallet_mobile",
      description:
        "Coinbase Wallet (self-custody) on mobile — in-app browser does NOT inject a Solana provider; Desktop only",
      walletId: "coinbase-wallet",
      providerDetected: false,
      isMobile: true,
    },
    {
      label: "coinbase_wallet_desktop",
      description:
        "Coinbase Wallet (self-custody) on desktop — no Solana provider detected; show Install",
      walletId: "coinbase-wallet",
      providerDetected: false,
      isMobile: false,
    },

    // ── OKX ───────────────────────────────────────────────────────────────────
    {
      label: "okx_mobile_not_installed",
      description: "OKX Wallet on mobile — Open app via okx:// deep link",
      walletId: "okx-wallet",
      providerDetected: false,
      isMobile: true,
    },

    // ── Backpack ──────────────────────────────────────────────────────────────
    {
      label: "backpack_mobile_not_installed",
      description: "Backpack on mobile — Open app via backpack:// deep link",
      walletId: "backpack",
      providerDetected: false,
      isMobile: true,
    },

    // ── Glow ──────────────────────────────────────────────────────────────────
    {
      label: "glow_mobile_not_installed",
      description: "Glow on mobile — Open app via glow:// deep link",
      walletId: "glow",
      providerDetected: false,
      isMobile: true,
    },

    // ── No wallet installed ───────────────────────────────────────────────────
    {
      label: "no_wallet_mobile",
      description: "No Solana wallet installed on mobile — all wallets show Open app or Desktop only",
      walletId: "phantom",
      providerDetected: false,
      isMobile: true,
      noWalletInstalled: true,
    },
    {
      label: "no_wallet_desktop",
      description: "No Solana wallet installed on desktop — all wallets show Install",
      walletId: "phantom",
      providerDetected: false,
      isMobile: false,
      noWalletInstalled: true,
    },
  ]
}

// ─── Derive expected action ────────────────────────────────────────────────────

function deriveExpectedAction(
  app: PaymentApp,
  scenario: SolanaSimScenario,
): SolanaWalletAction {
  return deriveSolanaWalletAction({
    app,
    providerDetected: scenario.providerDetected,
    isMobile: scenario.isMobile,
  })
}

// ─── Customer-facing label for a given action ─────────────────────────────────

function actionLabel(action: SolanaWalletAction): string {
  switch (action) {
    case "connect":       return "Connect"
    case "open_app":      return "Open app"
    case "desktop_only":  return "Desktop only"
    case "install":       return "Install"
    case "disabled":      return "Disabled"
  }
}

// ─── Build a single result row ────────────────────────────────────────────────

function buildResult(scenario: SolanaSimScenario) {
  const app = PAYMENT_APP_REGISTRY[scenario.walletId]
  if (!app) {
    return {
      scenario: scenario.label,
      error: `Unknown walletId: ${scenario.walletId}`,
    }
  }

  const action = deriveExpectedAction(app, scenario)

  return {
    scenario: scenario.label,
    description: scenario.description,
    wallet: {
      id: app.id,
      displayName: app.displayName,
      appFamily: app.appFamily,
    },
    input: {
      providerDetected: scenario.providerDetected,
      isMobile: scenario.isMobile,
      desktopProviderInjected: scenario.desktopProviderInjected ?? false,
      noWalletInstalled: scenario.noWalletInstalled ?? false,
    },
    result: {
      action,
      customerFacingLabel: actionLabel(action),
      mobileOpenStrategy: app.mobileOpenStrategy,
      supportsPaymentRequest: app.supportsPaymentRequest,
      supportsSolanaProvider: app.supportsSolanaProvider,
      mobileInAppBrowserSolanaSupport: app.mobileInAppBrowserSolanaSupport,
      installUrl: app.installUrl,
      notes: app.notes ?? null,
    },
    ui: {
      showOpenApp: action === "open_app",
      showInstall: action === "install",
      showDesktopOnly: action === "desktop_only",
      showConnect: action === "connect",
      showDisabled: action === "disabled",
    },
  }
}

// ─── Solana wallet overview (GET all wallets summary) ─────────────────────────

function buildAllWalletsSummary(isMobile: boolean) {
  return getAppsForRail("solana").map((app) => {
    const withProvider = deriveExpectedAction(app, {
      label: "summary",
      description: "",
      walletId: app.id,
      providerDetected: true,
      isMobile,
    })
    const withoutProvider = deriveExpectedAction(app, {
      label: "summary",
      description: "",
      walletId: app.id,
      providerDetected: false,
      isMobile,
    })
    return {
      id: app.id,
      displayName: app.displayName,
      appFamily: app.appFamily,
      mobileOpenStrategy: app.mobileOpenStrategy,
      supportsSolanaProvider: app.supportsSolanaProvider,
      mobileInAppBrowserSolanaSupport: app.mobileInAppBrowserSolanaSupport,
      actionWhenDetected: actionLabel(withProvider),
      actionWhenNotDetected: actionLabel(withoutProvider),
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
        allWalletsMobile: buildAllWalletsSummary(true),
        allWalletsDesktop: buildAllWalletsSummary(false),
      },
      note: [
        "Coinbase Wallet (self-custody) shows 'Desktop only' on mobile because its in-app",
        "browser routes into an EVM/Base context instead of injecting a Solana provider.",
        "Phantom and Solflare use wallet-specific open strategies (phantom browser URL /",
        "Solflare Universal Link). All other wallets use a generic wallet_deep_link scheme.",
        "iOS may show an app-disambiguation sheet when multiple wallets handle the same URI.",
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
      providerDetected?: boolean
      isMobile?: boolean
    }

    const walletId = String(body.walletId || "phantom")
    const providerDetected = Boolean(body.providerDetected ?? false)
    const isMobile = Boolean(body.isMobile ?? false)

    const app = PAYMENT_APP_REGISTRY[walletId]
    if (!app) {
      return NextResponse.json(
        { error: `Unknown walletId: ${walletId}. Valid IDs: ${Object.keys(PAYMENT_APP_REGISTRY).join(", ")}` },
        { status: 400 },
      )
    }

    const scenario: SolanaSimScenario = {
      label: "custom",
      description: "Custom POST scenario",
      walletId,
      providerDetected,
      isMobile,
    }

    return NextResponse.json({ ok: true, result: buildResult(scenario) })
  } catch (err) {
    const status = getRouteErrorStatus(err)
    const message = err instanceof Error ? err.message : "Simulator error"
    return NextResponse.json({ error: message }, { status })
  }
}
