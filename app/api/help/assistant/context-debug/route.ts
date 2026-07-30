import { NextRequest, NextResponse } from "next/server"
import { getPineTreeAssistantContext, type AssistantRailSummary } from "@/lib/help/pinetreeAssistantContext"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

// Mirrors the explicit rail allowlists already used correctly elsewhere
// (types/payment.ts's getRailsForCategory("crypto"), providers/cardProviderReadiness.ts's
// per-provider card checks) - crypto/card must never be derived from "is this
// value literally the string 'shift4'", since Stripe (a card provider) is a
// separate provider id from Shift4 and would otherwise be misclassified as crypto.
// Checked against AssistantRailSummary.rail, which carries the raw
// merchant_providers.provider id (see buildRailSummaries in
// lib/help/pinetreeAssistantContext.ts) - never .provider, which is a
// display label that falls back to the raw id for some providers and a
// friendly name for others, and is not a reliable set-membership key.
const CRYPTO_RAIL_PROVIDERS = new Set(["solana", "base", "bitcoin_lightning", "lightning", "lightning_speed", "lightning_nwc"])
const CARD_RAIL_PROVIDERS = new Set(["shift4", "stripe", "fluidpay"])

export function derivePosMethodDebugFlags(railSummaries: AssistantRailSummary[]): {
  cryptoEnabled: boolean
  cardEnabled: boolean
} {
  return {
    cryptoEnabled: railSummaries.some(
      (r) => r.availableForPos && CRYPTO_RAIL_PROVIDERS.has(r.rail.toLowerCase().trim())
    ),
    cardEnabled: railSummaries.some(
      (r) => r.availableForPos && CARD_RAIL_PROVIDERS.has(r.rail.toLowerCase().trim())
    ),
  }
}

/**
 * GET /api/help/assistant/context-debug
 *
 * Returns what PineTree AI sees for the authenticated merchant's account context.
 * Useful for diagnosing mismatches between the AI assistant and dashboard data.
 *
 * In development: returns full safe diagnostic output.
 * In production: returns only non-sensitive counts (no keys, names, or credentials).
 */
export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const context = await getPineTreeAssistantContext(merchantId)
    const diag = context.diagnostics

    const isDev = process.env.NODE_ENV !== "production"

    if (isDev) {
      return NextResponse.json({
        merchantScope: {
          authenticated: true,
          merchantResolved: true,
          merchantIdMasked: diag?.merchantIdMasked ?? "unknown",
          merchantFound: diag?.sources.merchantProfile.found ?? false,
          source: "supabase-user-or-api-key"
        },
        sources: {
          merchantProfile: {
            ok: diag?.sources.merchantProfile.ok,
            found: diag?.sources.merchantProfile.found,
            businessNamePresent: Boolean(context.merchant?.businessName),
            emailPresent: Boolean(context.merchant?.email),
            statusPresent: Boolean(context.merchant?.status),
            errorMessage: diag?.sources.merchantProfile.errorMessage
          },
          providers: {
            ok: diag?.sources.providers.ok,
            rawCount: diag?.sources.providers.rawCount,
            connectedCount: diag?.sources.providers.connectedCount,
            enabledCount: diag?.sources.providers.enabledCount,
            providerKeys: diag?.sources.providers.providerKeys,
            statuses: diag?.sources.providers.statuses,
            errorMessage: diag?.sources.providers.errorMessage
          },
          wallets: {
            ok: diag?.sources.wallets.ok,
            rawCount: diag?.sources.wallets.rawCount,
            addressPresentCount: diag?.sources.wallets.addressPresentCount,
            networks: diag?.sources.wallets.networks,
            assets: diag?.sources.wallets.assets,
            walletTypes: diag?.sources.wallets.walletTypes,
            errorMessage: diag?.sources.wallets.errorMessage
          },
          availableNetworks: {
            ok: diag?.sources.availableNetworks.ok,
            networks: diag?.sources.availableNetworks.networks,
            errorMessage: diag?.sources.availableNetworks.errorMessage
          },
          paymentReadiness: {
            ok: diag?.sources.availableNetworks.ok,
            availableRails: diag?.sources.availableNetworks.networks ?? [],
            railCount: diag?.sources.availableNetworks.rawCount ?? 0
          },
          posMethods: {
            ok: diag?.sources.availableNetworks.ok,
            availableNetworks: diag?.sources.availableNetworks.networks ?? [],
            ...derivePosMethodDebugFlags(context.railSummaries)
          },
          checkout: {
            ok: diag?.sources.checkout.ok,
            totalLinks: diag?.sources.checkout.rawCount,
            activeLinks: diag?.sources.checkout.activeCount,
            availableRails: context.railSummaries.filter((r) => r.availableForCheckout).map((r) => r.rail),
            errorMessage: diag?.sources.checkout.errorMessage
          },
          payments: {
            ok: diag?.sources.payments.ok,
            recentCount: diag?.sources.payments.rawCount,
            confirmedCount: diag?.sources.payments.confirmedCount,
            pendingCount: diag?.sources.payments.pendingCount,
            processingCount: diag?.sources.payments.processingCount,
            failedCount: diag?.sources.payments.failedCount,
            incompleteCount: diag?.sources.payments.incompleteCount,
            recentProviders: diag?.sources.payments.recentProviders,
            recentNetworks: diag?.sources.payments.recentNetworks,
            errorMessage: (diag?.sources.payments as { errorMessage?: string } | undefined)?.errorMessage
          },
          tickets: {
            ok: diag?.sources.tickets.ok,
            rawCount: diag?.sources.tickets.rawCount,
            errorMessage: diag?.sources.tickets.errorMessage
          },
          terminals: {
            ok: diag?.sources.terminals.ok,
            rawCount: diag?.sources.terminals.rawCount,
            activeCount: context.pos.activeTerminalCount,
            errorMessage: diag?.sources.terminals.errorMessage
          }
        },
        railSummaries: context.railSummaries.map((r) => ({
          rail: r.rail,
          provider: r.provider,
          connected: r.connected,
          enabled: r.enabled,
          availableForPos: r.availableForPos,
          availableForCheckout: r.availableForCheckout,
          readySignal: r.readySignal,
          sourceSignals: r.sourceSignals
        })),
        setupSummary: context.setupSummary,
        sourceErrors: Object.entries(diag?.sources ?? {})
          .filter(([, s]) => !(s as { ok: boolean }).ok)
          .map(([key, s]) => ({
            source: key,
            errorMessage: (s as { errorMessage?: string }).errorMessage
          }))
      })
    }

    // Production: non-sensitive counts only
    return NextResponse.json({
      merchantScope: {
        authenticated: true,
        merchantResolved: true
      },
      sources: {
        providers: {
          ok: diag?.sources.providers.ok,
          rawCount: diag?.sources.providers.rawCount,
          connectedCount: diag?.sources.providers.connectedCount,
          enabledCount: diag?.sources.providers.enabledCount
        },
        wallets: {
          ok: diag?.sources.wallets.ok,
          rawCount: diag?.sources.wallets.rawCount
        },
        availableNetworks: {
          ok: diag?.sources.availableNetworks.ok,
          count: diag?.sources.availableNetworks.rawCount
        },
        checkout: {
          ok: diag?.sources.checkout.ok,
          totalLinks: diag?.sources.checkout.rawCount,
          activeLinks: diag?.sources.checkout.activeCount
        },
        payments: {
          ok: diag?.sources.payments.ok,
          recentCount: diag?.sources.payments.rawCount
        }
      },
      hasSourceErrors: Object.values(diag?.sources ?? {}).some((s) => !(s as { ok: boolean }).ok)
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to load assistant context debug") },
      { status: getRouteErrorStatus(error) }
    )
  }
}
