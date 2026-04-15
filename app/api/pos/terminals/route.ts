import { NextRequest, NextResponse } from "next/server"
import {
  createPosTerminalEngine,
  deletePosTerminalEngine,
  getPosTerminalsEngine
} from "@/engine/posTerminals"
import {
  getRouteErrorStatus,
  requireMerchantIdFromRequest
} from "@/lib/api/merchantAuth"

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)

    const terminals = await getPosTerminalsEngine(merchantId)
    return NextResponse.json({ success: true, terminals })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to load terminals") },
      { status: getRouteErrorStatus(error) }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)

    const body = (await req.json()) as {
      name?: string
      pin?: string
      autolock?: string
      recoveryPhrase?: string
      drawer_starting_amount?: number
    }

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Register name required" }, { status: 400 })
    }

    if (!body.pin || body.pin.length !== 4) {
      return NextResponse.json({ error: "PIN must be 4 digits" }, { status: 400 })
    }

    if (!body.recoveryPhrase?.trim() || body.recoveryPhrase.trim().length < 4) {
      return NextResponse.json(
        { error: "Recovery phrase must be at least 4 characters" },
        { status: 400 }
      )
    }

    const terminal = await createPosTerminalEngine(merchantId, {
      name: body.name.trim(),
      pin: body.pin,
      autolock: body.autolock || "5",
      recoveryPhrase: body.recoveryPhrase.trim(),
      drawer_starting_amount: Number(body.drawer_starting_amount ?? 0)
    })

    return NextResponse.json({ success: true, terminal })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to create terminal") },
      { status: getRouteErrorStatus(error) }
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)

    const body = (await req.json()) as { id?: string }
    if (!body.id) {
      return NextResponse.json({ error: "Missing terminal id" }, { status: 400 })
    }

    await deletePosTerminalEngine(merchantId, body.id)
    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to delete terminal") },
      { status: getRouteErrorStatus(error) }
    )
  }
}
