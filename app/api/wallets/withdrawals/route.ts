import { type NextRequest, NextResponse } from "next/server"
import { requireIdempotencyKey, readWalletJsonBody } from "@/lib/api/walletApiRoute"
import { requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { createWalletWithdrawal } from "@/engine/wallet/walletOperations"
import { updateWalletOperationCanonicalFields } from "@/database/merchantWalletOperations"
import { submitCanonicalWithdrawal } from "@/engine/withdrawals/canonicalWithdrawal"
import { getDeploymentBuildId } from "@/lib/deploymentInfo"
import { WalletApiRouteError, walletError, walletErrorHttpStatus, walletOk } from "@/engine/wallet/walletErrors"
import { classifyBitcoinWithdrawalDestination } from "@/providers/wallets/bitcoinWithdrawalDestination"

function safeErrorName(error: unknown) {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name || "") : ""
  return name.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 60) || "Error"
}

function safeErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "")
  return raw
    .trim()
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/[A-Za-z0-9+/=]{120,}/g, "[redacted-payload]")
    .slice(0, 180) || "Wallet withdrawal failed."
}

function routeFailure(error: unknown) {
  const structuralCode = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : ""
  if (error instanceof WalletApiRouteError || structuralCode) {
    const code = (error instanceof WalletApiRouteError ? error.code : structuralCode) as WalletApiRouteError["code"]
    const retryable = error instanceof WalletApiRouteError
      ? error.retryable
      : Boolean((error as { retryable?: unknown }).retryable)
    return {
      code,
      message: error instanceof Error ? error.message : "Wallet withdrawal failed.",
      retryable: code === "STATUS_UNKNOWN" ? false : retryable,
      httpStatus: walletErrorHttpStatus(code),
    }
  }
  return {
    code: "INTERNAL_ERROR" as const,
    message: "Something went wrong. Please try again.",
    retryable: false,
    httpStatus: 500,
  }
}

function withCorrelation<T extends { ok: boolean }>(body: T, correlationId?: string | null): T & { correlationId?: string } {
  const safeCorrelationId = String(correlationId || "").trim()
  if (!safeCorrelationId) return body
  return { ...body, correlationId: safeCorrelationId.slice(0, 40) }
}

function accountSuffix(accountId: string | null) {
  const normalized = String(accountId || "").trim()
  return normalized ? normalized.slice(-6) : null
}

export async function POST(req: NextRequest) {
  const correlationId = req.headers?.get("x-pinetree-withdrawal-correlation") || null
  const buildId = getDeploymentBuildId()
  let merchantId: string | null = null
  let asset: unknown = null
  let substage = "route_entry"
  let providerAccountId: string | null = null

  console.info("[pinetree-withdrawals] SPEED_ROUTE_ENTERED", {
    correlationId,
    buildId,
    routeStage: "route_entered",
  })

  try {
    substage = "authentication"
    merchantId = await requireMerchantIdFromRequest(req)

    substage = "body_parse"
    const idempotencyKey = requireIdempotencyKey(req)
    const body = await readWalletJsonBody(req)
    asset = body.asset ?? "SATS"
    const destinationId = body.destination_id !== undefined ? String(body.destination_id) : undefined

    console.info("[pinetree-withdrawals] SPEED_SUBMIT_RECEIVED", {
      correlationId,
      merchantId,
      asset,
      hasDestinationId: Boolean(destinationId),
      buildId,
      routeStage: "submit_received",
    })

    // Saved-address withdrawals route through the canonical dispatcher, which
    // may execute through the same payout provider from engine/withdrawals/*
    // rather than the generic walletOperations adapter path below.
    if (destinationId) {
      substage = "canonical_withdrawal_execution"
      const canonical = await submitCanonicalWithdrawal({
        merchantId,
        rail: "bitcoin",
        asset: "BTC",
        amountDecimal: String(body.amount_decimal || body.amountDecimal || ""),
        source: "saved_address",
        idempotencyKey,
        destinationId,
      })
      const write = canonical.kind === "executed" ? canonical.write : canonical
      console.info("[pinetree-withdrawals] SPEED_SUBMIT_RETURNED", {
        correlationId,
        merchantId,
        buildId,
        routeStage: "submit_returned",
        callGraph: "route->canonicalWithdrawal->provider",
        status: canonical.kind === "executed" ? canonical.write.operation.status : null,
      })
      return NextResponse.json(withCorrelation(walletOk(write), correlationId), {
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      })
    }

    substage = "destination_classification"
    const destination = String(body.destination || "")
    const classifiedDestination = classifyBitcoinWithdrawalDestination(destination)
    console.info("[pinetree-withdrawals] SPEED_DESTINATION_CLASSIFIED", {
      correlationId,
      merchantId,
      buildId,
      routeStage: "destination_classified",
      destinationMethod: classifiedDestination.valid ? classifiedDestination.method : "invalid",
      destinationType: classifiedDestination.valid ? classifiedDestination.kind : "invalid",
    })

    const diagnostics = {
      setSubstage(nextSubstage: string) {
        substage = nextSubstage
      },
      setProviderAccountId(nextProviderAccountId: string | null | undefined) {
        providerAccountId = String(nextProviderAccountId || "").trim() || null
      },
    }

    const result = await createWalletWithdrawal(merchantId, {
      asset: String(body.asset || ""),
      amountDecimal: String(body.amount_decimal || body.amountDecimal || ""),
      destination,
      note: typeof body.note === "string" ? body.note : undefined,
      idempotencyKey,
      correlationId,
      diagnostics,
    })

    substage = "operation_persistence"
    void updateWalletOperationCanonicalFields(merchantId, result.operation.id, { source: "manual" }).catch(() => {})

    console.info("[pinetree-withdrawals] SPEED_SUBMIT_RETURNED", {
      correlationId,
      merchantId,
      buildId,
      routeStage: "submit_returned",
      callGraph: "route->createWalletWithdrawal->walletOperations->speedWalletAdapter->speedWalletManagement->speedRequest(/send)",
      status: result.operation.status,
    })
    return NextResponse.json(withCorrelation(walletOk(result), correlationId), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    })
  } catch (error) {
    const failure = routeFailure(error)
    console.warn("[pinetree-withdrawals] SPEED_ROUTE_FAILED", {
      correlationId,
      merchantId,
      asset,
      buildId,
      substage,
      errorName: safeErrorName(error),
      normalizedErrorCode: failure.code,
      errorMessage: safeErrorMessage(error),
      httpStatus: failure.httpStatus,
      retryable: failure.retryable,
      providerAccountSuffix: accountSuffix(providerAccountId),
      routeStage: "route_failed",
    })
    return NextResponse.json(
      withCorrelation(walletError(failure.code, failure.message, failure.retryable), correlationId),
      {
        status: failure.httpStatus,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      }
    )
  }
}
