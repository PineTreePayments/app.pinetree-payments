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
    {
      label: "solflare_desktop_injected",
      description: "Solflare extension installed on desktop — provider injected",
      walletId: "solflare",
      providerDetected: true,
      isMobile: false,
      desktopProviderInjected: true,
    },
    {
      label: "solflare_desktop_not_installed",
      description: "Solflare not installed on desktop — show Install",
      walletId: "solflare",
      providerDetected: false,
      isMobile: false,
    },

    // ── Trust Wallet ──────────────────────────────────────────────────────────
    {
      label: "trust_wallet_mobile_installed",
      description: "Trust Wallet installed on mobile — provider detected",
      walletId: "trust-wallet",
      providerDetected: true,
      isMobile: true,
    },
    {
      label: "trust_wallet_mobile_not_installed",
      description: "Trust Wallet on mobile — Open app via trustwallet universal link",
      walletId: "trust-wallet",
      providerDetected: false,
      isMobile: true,
    },
    {
      label: "trust_wallet_desktop_injected",
      description: "Trust Wallet extension installed on desktop — provider injected",
      walletId: "trust-wallet",
      providerDetected: true,
      isMobile: false,
      desktopProviderInjected: true,
    },
    {
      label: "trust_wallet_desktop_not_installed",
      description: "Trust Wallet not installed on desktop — show Install",
      walletId: "trust-wallet",
      providerDetected: false,
      isMobile: false,
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
      label: "okx_mobile_installed",
      description: "OKX Wallet installed on mobile — provider detected",
      walletId: "okx-wallet",
      providerDetected: true,
      isMobile: true,
    },
    {
      label: "okx_mobile_not_installed",
      description: "OKX Wallet on mobile — Open app via okx:// deep link",
      walletId: "okx-wallet",
      providerDetected: false,
      isMobile: true,
    },
    {
      label: "okx_desktop_injected",
      description: "OKX Wallet extension installed on desktop — provider injected",
      walletId: "okx-wallet",
      providerDetected: true,
      isMobile: false,
      desktopProviderInjected: true,
    },
    {
      label: "okx_desktop_not_installed",
      description: "OKX Wallet not installed on desktop — show Install",
      walletId: "okx-wallet",
      providerDetected: false,
      isMobile: false,
    },

    // ── Backpack ──────────────────────────────────────────────────────────────
    {
      label: "backpack_mobile_installed",
      description: "Backpack installed on mobile — provider detected",
      walletId: "backpack",
      providerDetected: true,
      isMobile: true,
    },
    {
      label: "backpack_mobile_not_installed",
      description: "Backpack on mobile — Open app via backpack:// deep link",
      walletId: "backpack",
      providerDetected: false,
      isMobile: true,
    },
    {
      label: "backpack_desktop_injected",
      description: "Backpack extension installed on desktop — provider injected",
      walletId: "backpack",
      providerDetected: true,
      isMobile: false,
      desktopProviderInjected: true,
    },
    {
      label: "backpack_desktop_not_installed",
      description: "Backpack not installed on desktop — show Install",
      walletId: "backpack",
      providerDetected: false,
      isMobile: false,
    },

    // ── Glow ──────────────────────────────────────────────────────────────────
    {
      label: "glow_mobile_installed",
      description: "Glow installed on mobile — provider detected",
      walletId: "glow",
      providerDetected: true,
      isMobile: true,
    },
    {
      label: "glow_mobile_not_installed",
      description: "Glow on mobile — Open app via glow:// deep link",
      walletId: "glow",
      providerDetected: false,
      isMobile: true,
    },
    {
      label: "glow_desktop_injected",
      description: "Glow extension installed on desktop — provider injected",
      walletId: "glow",
      providerDetected: true,
      isMobile: false,
      desktopProviderInjected: true,
    },
    {
      label: "glow_desktop_not_installed",
      description: "Glow not installed on desktop — show Install",
      walletId: "glow",
      providerDetected: false,
      isMobile: false,
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

    // ── Return-from-wallet recovery scenarios ─────────────────────────────────
    {
      label: "phantom_mobile_returned_without_paying",
      description:
        "Phantom opened on mobile, customer returned to payment page without signing. " +
        "visibilitychange/pageshow fires; noTxAfterReturn=true; recovery UI shown with " +
        "'Try again with Phantom' and 'Switch payment method'. execStage resets to idle.",
      walletId: "phantom",
      providerDetected: false,
      isMobile: true,
    },
    {
      label: "solflare_mobile_returned_without_paying",
      description:
        "Solflare Universal Link opened on mobile, customer returned without paying. " +
        "Same walletLaunchedRef + visibilitychange recovery path.",
      walletId: "solflare",
      providerDetected: false,
      isMobile: true,
    },
    {
      label: "trust_wallet_mobile_returned_without_paying",
      description:
        "Trust Wallet opened via universal link on mobile, customer returned without signing. " +
        "Recovery UI: Try again with Trust Wallet / Switch payment method.",
      walletId: "trust-wallet",
      providerDetected: false,
      isMobile: true,
    },
    {
      label: "backpack_mobile_returned_without_paying",
      description:
        "Backpack opened via backpack:// deep link on mobile, customer returned without signing.",
      walletId: "backpack",
      providerDetected: false,
      isMobile: true,
    },
    {
      label: "glow_mobile_returned_without_paying",
      description:
        "Glow opened via glow:// deep link on mobile, customer returned without signing.",
      walletId: "glow",
      providerDetected: false,
      isMobile: true,
    },
    {
      label: "okx_mobile_returned_without_paying",
      description:
        "OKX Wallet opened via okx:// deep link on mobile, customer returned without signing.",
      walletId: "okx-wallet",
      providerDetected: false,
      isMobile: true,
    },

    // ── User-rejected transaction ─────────────────────────────────────────────
    {
      label: "phantom_desktop_user_rejected",
      description:
        "Phantom extension injected on desktop. signAndSendTransaction throws 'User rejected'. " +
        "execStage → retryable_error; error banner shown; recovery UI: Try again / Switch.",
      walletId: "phantom",
      providerDetected: true,
      isMobile: false,
      desktopProviderInjected: true,
    },
    {
      label: "solflare_desktop_user_rejected",
      description:
        "Solflare extension injected on desktop. Transaction rejected by user. Same retryable_error path.",
      walletId: "solflare",
      providerDetected: true,
      isMobile: false,
      desktopProviderInjected: true,
    },
    {
      label: "backpack_desktop_user_rejected",
      description:
        "Backpack extension injected on desktop. Transaction rejected by user.",
      walletId: "backpack",
      providerDetected: true,
      isMobile: false,
      desktopProviderInjected: true,
    },
    {
      label: "okx_desktop_user_rejected",
      description:
        "OKX Wallet extension injected on desktop. Transaction rejected by user.",
      walletId: "okx-wallet",
      providerDetected: true,
      isMobile: false,
      desktopProviderInjected: true,
    },

    // ── Switch payment method ─────────────────────────────────────────────────
    {
      label: "switch_method_after_mobile_open",
      description:
        "Customer opened wallet app on mobile but returned without paying, then taps " +
        "'Switch payment method'. onCancel() clears selectedAssetId and returns to rail selection.",
      walletId: "phantom",
      providerDetected: false,
      isMobile: true,
    },
    {
      label: "switch_method_after_desktop_reject",
      description:
        "Customer rejected transaction on desktop, then switches to a different payment method. " +
        "onCancel() resets execStage to idle and clears selectedAssetId.",
      walletId: "phantom",
      providerDetected: true,
      isMobile: false,
      desktopProviderInjected: true,
    },

    // ── Retry after failed attempt ────────────────────────────────────────────
    {
      label: "phantom_mobile_retry_after_return",
      description:
        "Customer returned without paying, then taps 'Try again with Phantom'. " +
        "Wallet picker re-opens, walletLaunchedRef resets to false before the new attempt.",
      walletId: "phantom",
      providerDetected: false,
      isMobile: true,
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

// ─── Pass/fail validation ─────────────────────────────────────────────────────

function buildValidation(
  app: PaymentApp,
  scenario: SolanaSimScenario,
  action: SolanaWalletAction,
): {
  pass: boolean
  expectedAction: SolanaWalletAction
  actualAction: SolanaWalletAction
  expectedCustomerLabel: string
  actualCustomerLabel: string
  reason: string
} {
  const issues: string[] = []

  if (!app.railSupport.includes("solana")) {
    issues.push("app.railSupport does not include 'solana'")
  }

  if (action === "connect" && !app.supportsSolanaProvider) {
    issues.push("action is 'connect' but app.supportsSolanaProvider is false")
  }

  if (action === "open_app" && !app.mobileInAppBrowserSolanaSupport) {
    issues.push("action is 'open_app' but app.mobileInAppBrowserSolanaSupport is false")
  }

  if (
    action === "open_app" &&
    (app.mobileOpenStrategy === "none" || app.mobileOpenStrategy === "walletconnect")
  ) {
    issues.push(`action is 'open_app' but app.mobileOpenStrategy is '${app.mobileOpenStrategy}'`)
  }

  if (action === "desktop_only" && app.mobileInAppBrowserSolanaSupport) {
    issues.push("action is 'desktop_only' but app.mobileInAppBrowserSolanaSupport is true")
  }

  if (action === "desktop_only" && !scenario.isMobile) {
    issues.push("action is 'desktop_only' but scenario.isMobile is false (only applies on mobile)")
  }

  if (action === "install" && !app.installUrl) {
    issues.push("action is 'install' but app.installUrl is empty")
  }

  const label = actionLabel(action)
  return {
    pass: issues.length === 0,
    expectedAction: action,
    actualAction: action,
    expectedCustomerLabel: label,
    actualCustomerLabel: label,
    reason: issues.length === 0 ? "All checks passed" : issues.join("; "),
  }
}

// ─── Build a single result row ────────────────────────────────────────────────

function buildResult(scenario: SolanaSimScenario) {
  const app = PAYMENT_APP_REGISTRY[scenario.walletId]
  if (!app) {
    return {
      scenario: scenario.label,
      error: `Unknown walletId: ${scenario.walletId}`,
      validation: { pass: false, reason: `Unknown walletId: ${scenario.walletId}` },
    }
  }

  const action = deriveExpectedAction(app, scenario)
  const validation = buildValidation(app, scenario, action)

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
    validation,
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

// ─── Missing coverage ─────────────────────────────────────────────────────────

function buildMissingCoverage(coveredIds: Set<string>) {
  return getAppsForRail("solana")
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
        allWalletsMobile: buildAllWalletsSummary(true),
        allWalletsDesktop: buildAllWalletsSummary(false),
      },
      note: [
        "Coinbase Wallet (self-custody) shows 'Desktop only' on mobile because its in-app",
        "browser routes into an EVM/Base context instead of injecting a Solana provider.",
        "Phantom uses a Phantom-specific browser URL. Solflare uses Universal Link v1.",
        "All other wallets use a generic wallet_deep_link scheme (backpack://, glow://, etc.).",
        "iOS may show an app-disambiguation sheet when multiple wallets handle the same URI.",
        "Validation checks registry consistency: action vs mobileOpenStrategy, installUrl, supportsSolanaProvider.",
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
