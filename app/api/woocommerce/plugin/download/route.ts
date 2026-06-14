import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { NextRequest, NextResponse } from "next/server"
import { getRouteErrorStatus, requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"

const ARTIFACT_PATH = join(process.cwd(), "artifacts", "woocommerce", "pinetree-woocommerce.zip")
const FILENAME = "pinetree-woocommerce.zip"

// GET /api/woocommerce/plugin/download
//
// Serves the packaged WooCommerce plugin zip to authenticated merchants.
// Build the artifact with: npm run package:woocommerce
export async function GET(req: NextRequest) {
  try {
    await requireMerchantIdFromRequest(req)

    if (!existsSync(ARTIFACT_PATH)) {
      return NextResponse.json(
        { error: "Plugin package is being prepared. Try again shortly." },
        { status: 503 }
      )
    }

    const fileBuffer = readFileSync(ARTIFACT_PATH)

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${FILENAME}"`,
        "Content-Length": String(fileBuffer.length),
        "Cache-Control": "private, no-cache, no-store",
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Download failed" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
