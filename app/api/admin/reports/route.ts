import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import {
  getPlatformReport,
  getAdminStaleDiagnostic,
  type PlatformReportPeriod,
  type PlatformReportMode,
} from "@/database/adminReports"

const VALID_PERIODS = new Set<string>(["7d", "30d", "month", "quarter", "year"])
const VALID_MODES = new Set<string>(["all", "live", "test"])

export async function GET(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)

    const { searchParams } = req.nextUrl
    const type = searchParams.get("type") || "overview"

    if (type === "stale") {
      const result = await getAdminStaleDiagnostic()
      return NextResponse.json(result)
    }

    const rawPeriod = searchParams.get("period") || "30d"
    const rawMode = searchParams.get("mode") || "all"
    const period: PlatformReportPeriod = VALID_PERIODS.has(rawPeriod)
      ? (rawPeriod as PlatformReportPeriod)
      : "30d"
    const mode: PlatformReportMode = VALID_MODES.has(rawMode)
      ? (rawMode as PlatformReportMode)
      : "all"

    const result = await getPlatformReport(period, mode)
    return NextResponse.json(result)
  } catch (err) {
    const status = getRouteErrorStatus(err)
    const message = err instanceof Error ? err.message : "Internal server error"
    console.error("[admin/reports] error", { status, message })
    return NextResponse.json({ error: message }, { status })
  }
}
