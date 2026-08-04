import { NextRequest, NextResponse } from "next/server"

import {
  prepareShift4RetailCardPayment,
  Shift4RetailPreparationError,
} from "@/engine/shift4/retailPreparation"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { requireTerminalSession } from "@/lib/api/terminalAuth"

/**
 * POST /api/pos/shift4-retail-preparation — bind a POS reader selection to the
 * Shift4 Retail payment path.
 *
 * The POS sends ONE field: the PineTree reader ID it selected from the
 * merchant-scoped list. Merchant identity comes from the signed terminal
 * session claim; provider, environment, channel, the Shift4 terminal ID, the
 * device serial number and the manufacturer are all resolved server-side and
 * cannot be influenced by the request.
 *
 * A raw Shift4 terminal ID cannot be substituted: `readerId` must be a PineTree
 * row id, and it is re-resolved under this merchant's own scope before use.
 *
 * This route NEVER dispatches to Shift4. It returns the validated plan and the
 * reason dispatch is still blocked.
 */
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const noStore = { "Cache-Control": "no-store" } as const

export async function POST(request: NextRequest) {
  try {
    const { mid: merchantId } = requireTerminalSession(request)

    const body = (await request.json().catch(() => null)) as { readerId?: unknown } | null
    const readerId = typeof body?.readerId === "string" ? body.readerId.trim() : ""
    if (!UUID_PATTERN.test(readerId)) {
      // A Shift4 terminal ID lands here, and is refused, without ever reaching
      // a lookup that could confirm whether such a terminal exists.
      return NextResponse.json(
        { error: "A PineTree reader must be selected" },
        { status: 400, headers: noStore }
      )
    }

    const preparation = await prepareShift4RetailCardPayment({ merchantId, readerId })

    // Explicitly constructed. No serial number, token, terminal ID, or raw
    // provider material can reach the POS through this response.
    return NextResponse.json(
      {
        dispatchPermitted: preparation.dispatchPermitted,
        blockedReason: preparation.blockedReason,
        providerCallPerformed: preparation.providerCallPerformed,
        // Deliberately narrower than the Engine plan. The POS needs to name the
        // device and show why it is blocked; it has no use for the resolved
        // manufacturer or the deployment environment, so neither is disclosed.
        reader: {
          readerId: preparation.plan.readerId,
          label: preparation.plan.label,
          model: preparation.plan.model,
          maskedSerial: preparation.plan.maskedSerial,
          deviceClassification: preparation.plan.deviceClassification,
        },
        request: {
          operation: preparation.plan.operation,
          channel: preparation.plan.channel,
          pendingRequiredFields: preparation.plan.pendingRequiredFields,
        },
      },
      { headers: noStore }
    )
  } catch (error) {
    if (error instanceof Shift4RetailPreparationError) {
      // Ownership failures are generic by construction: another merchant's
      // reader is indistinguishable from one that does not exist.
      const status = error.code === "reader_unavailable" ? 404 : 409
      return NextResponse.json({ error: error.message }, { status, headers: noStore })
    }
    return NextResponse.json(
      { error: "Unable to prepare the Shift4 Retail terminal" },
      { status: getRouteErrorStatus(error), headers: noStore }
    )
  }
}
