import { NextRequest } from "next/server"
import { requireAdminFromRequest } from "@/lib/api/adminAuth"
import { readShift4FeatureFlags } from "@/engine/shift4/readiness"
import type { Shift4CertificationChannel } from "@/engine/shift4/certificationCatalog"
import { runShift4CertificationFixture, SHIFT4_CERTIFICATION_WORKFLOWS } from "@/engine/shift4/certificationService"
import { readJsonObject, shift4Error, shift4Success } from "@/lib/api/shift4Routes"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    await requireAdminFromRequest(request)
    const flags = readShift4FeatureFlags()
    if (!flags.certificationMode) throw Object.assign(new Error("Not found"), { status: 404, code: "not_found" })
    const body = await readJsonObject(request)
    if ("adapter" in body && body.adapter !== "fixture") {
      throw Object.assign(new Error("Certification fixtures only support the isolated fixture adapter"), { status: 400, code: "invalid_adapter" })
    }
    const mode = body.mode === "fixture" ? "fixture" : body.mode === "test" ? "test" : null
    const channel = ["all", "ecommerce", "retail"].includes(String(body.channel)) ? body.channel as Shift4CertificationChannel | "all" : null
    if (!mode || !channel) throw Object.assign(new Error("mode and channel are invalid"), { status: 400, code: "invalid_request" })
    if (mode === "test") throw Object.assign(new Error("Test-environment execution is blocked until official wire contracts, test credentials/devices, and analyst authorization are supplied"), { status: 503, code: "certification_external_blocker" })
    const requested = Array.isArray(body.caseIds) ? body.caseIds.filter((value): value is string => typeof value === "string") : []
    const workflow = typeof body.workflow === "string" && body.workflow in SHIFT4_CERTIFICATION_WORKFLOWS
      ? body.workflow as keyof typeof SHIFT4_CERTIFICATION_WORKFLOWS : undefined
    return shift4Success(await runShift4CertificationFixture({ channel, requested, workflow }))
  } catch (error) {
    return shift4Error(error, "Unable to run Shift4 certification fixture")
  }
}
