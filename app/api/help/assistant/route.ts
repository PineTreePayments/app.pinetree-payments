import { NextRequest, NextResponse } from "next/server"
import { getPineTreeAssistantContext } from "@/lib/help/pinetreeAssistantContext"
import { answerPineTreeQuestion } from "@/lib/help/pinetreeAssistant"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"
import { getRequestIp, makeRateLimiter } from "@/lib/api/rateLimit"

const AI_LIMITED_MESSAGE = "PineTree AI is temporarily limited. Please try again shortly."

// In-memory limits are isolated behind lib/api/rateLimit so they can later move
// to shared storage without changing route behavior.
const merchantAssistantLimiter = makeRateLimiter({ windowMs: 60 * 60 * 1000, maxRequests: 20 })
const ipAssistantLimiter = makeRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 10 })

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
    const ip = getRequestIp(req)
    const ipLimit = ipAssistantLimiter.check(`ip:${ip}`)
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: AI_LIMITED_MESSAGE },
        { status: 429, headers: { "Retry-After": String(Math.ceil(ipLimit.retryAfterMs / 1000)) } }
      )
    }

    const body = (await req.json().catch(() => ({}))) as AssistantRequestBody
    const rawMessage = String(body.message || "").trim()
    const debugMode = body.debug === true && process.env.NODE_ENV !== "production"

    if (!rawMessage && !debugMode) {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 }
      )
    }

    if (rawMessage.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { error: `Message is too long. Please keep PineTree AI questions under ${MAX_MESSAGE_LENGTH} characters.` },
        { status: 400 }
      )
    }

    const merchantId = await requireMerchantIdFromRequest(req)
    const merchantLimit = merchantAssistantLimiter.check(`merchant:${merchantId}`)
    if (!merchantLimit.allowed) {
      return NextResponse.json(
        { error: AI_LIMITED_MESSAGE },
        { status: 429, headers: { "Retry-After": String(Math.ceil(merchantLimit.retryAfterMs / 1000)) } }
      )
    }

    const message = rawMessage
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
