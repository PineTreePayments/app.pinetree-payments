import { NextRequest, NextResponse } from "next/server"
import { getPineTreeAssistantContext } from "@/lib/help/pinetreeAssistantContext"
import { answerPineTreeQuestion } from "@/lib/help/pinetreeAssistant"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"
import { makeRateLimiter } from "@/lib/api/rateLimit"

// 20 AI questions per merchant per minute.  AI calls have non-trivial cost;
// this prevents runaway loops or abuse without affecting normal usage.
const assistantLimiter = makeRateLimiter({ windowMs: 60_000, maxRequests: 20 })

// Max message length to prevent oversized context injection
const MAX_MESSAGE_LENGTH = 2000

type AssistantRequestBody = {
  message?: string
  debug?: boolean
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)

    const limit = assistantLimiter.check(merchantId)
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment before asking another question." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } }
      )
    }

    const body = (await req.json().catch(() => ({}))) as AssistantRequestBody
    const message = String(body.message || "").trim().slice(0, MAX_MESSAGE_LENGTH)
    const debugMode = body.debug === true && process.env.NODE_ENV !== "production"

    if (!message && !debugMode) {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 }
      )
    }

    const context = await getPineTreeAssistantContext(merchantId)

    if (debugMode) {
      const diag = context.diagnostics
      return NextResponse.json({
        debug: true,
        merchantScope: {
          authenticated: true,
          merchantResolved: true,
          merchantIdMasked: diag?.merchantIdMasked ?? "unknown",
          source: "supabase-user-or-api-key"
        },
        sources: {
          merchantProfile: {
            ok: diag?.sources.merchantProfile.ok,
            found: diag?.sources.merchantProfile.found
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
            errorMessage: diag?.sources.wallets.errorMessage
          },
          availableNetworks: {
            ok: diag?.sources.availableNetworks.ok,
            networks: diag?.sources.availableNetworks.networks,
            errorMessage: diag?.sources.availableNetworks.errorMessage
          },
          checkout: {
            ok: diag?.sources.checkout.ok,
            activeLinks: diag?.sources.checkout.activeCount,
            totalLinks: diag?.sources.checkout.rawCount,
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
            incompleteCount: diag?.sources.payments.incompleteCount
          }
        },
        setupSummary: context.setupSummary,
        sourceErrors: Object.entries(diag?.sources ?? {})
          .filter(([, s]) => !(s as { ok: boolean }).ok)
          .map(([key, s]) => ({
            source: key,
            errorMessage: (s as { errorMessage?: string }).errorMessage
          }))
      })
    }

    const answer = answerPineTreeQuestion(message, context)

    return NextResponse.json({
      answer,
      contextSummary: {
        merchantId: context.merchant?.id || merchantId,
        businessName: context.merchant?.businessName || null,
        walletCount: context.wallets.length,
        providerCount: context.providers.length,
        recentPaymentCount: context.recentPayments.length,
        recentTicketCount: context.recentTickets.length,
        setupSummary: context.setupSummary
      }
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to answer PineTree AI question") },
      { status: getRouteErrorStatus(error) }
    )
  }
}
