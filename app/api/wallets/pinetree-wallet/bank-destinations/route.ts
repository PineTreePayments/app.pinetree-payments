import { type NextRequest, NextResponse } from "next/server"

import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import {
  linkBankDestinationEngine,
  listBankDestinationsEngine,
} from "@/engine/bridgeBankDestinations"

/**
 * Merchant bank payout destinations.
 *
 * A thin wrapper: authenticate, validate shape, call PineTree Engine, return
 * the Engine's safe projection. No business logic and no provider call lives
 * here.
 *
 * SECURITY: the response never contains a routing number, an account number, a
 * provider identifier, or a provider status string - only the Engine's masked
 * merchant-facing view. The account number arrives in the request body once and
 * is forwarded straight to the Engine, which hands it to the provider without
 * persisting or logging it.
 */

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const result = await listBankDestinationsEngine({ merchantId })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.retryable ? 503 : 409 })
    }
    return NextResponse.json({ destinations: result.destinations })
  } catch (error) {
    return NextResponse.json(
      { error: "Unable to load your bank accounts right now." },
      { status: getRouteErrorStatus(error) }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    const accountKind = String(body.account_kind || body.accountKind || "checking")
      .trim()
      .toLowerCase()
    if (accountKind !== "checking" && accountKind !== "savings") {
      return NextResponse.json({ error: "Choose checking or savings." }, { status: 400 })
    }

    const result = await linkBankDestinationEngine({
      merchantId,
      label: body.label != null ? String(body.label) : null,
      bankName: String(body.bank_name || body.bankName || ""),
      accountOwnerName: String(body.account_owner_name || body.accountOwnerName || ""),
      routingNumber: String(body.routing_number || body.routingNumber || ""),
      accountNumber: String(body.account_number || body.accountNumber || ""),
      accountKind,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.retryable ? 503 : 400 })
    }
    return NextResponse.json({ destination: result.destination }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: "Unable to add this bank account right now." },
      { status: getRouteErrorStatus(error) }
    )
  }
}
