import { NextRequest, NextResponse } from "next/server"
import { importInventoryCsv } from "@/engine/inventory/csvImport"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

const MAX_CSV_BYTES = 2 * 1024 * 1024

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const formData = await req.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "CSV file is required" }, { status: 400 })
    }
    if (file.size > MAX_CSV_BYTES) {
      return NextResponse.json({ error: "CSV file must be 2 MB or smaller" }, { status: 400 })
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      return NextResponse.json({ error: "File must use the .csv extension" }, { status: 400 })
    }
    const summary = await importInventoryCsv(merchantId, await file.text())
    return NextResponse.json(summary, { status: summary.created ? 201 : 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Inventory import failed"
    return NextResponse.json(
      { error: message },
      { status: message.includes("migration required") ? 409 : getRouteErrorStatus(error) }
    )
  }
}
