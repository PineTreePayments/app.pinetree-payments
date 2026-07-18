import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const authMock = vi.hoisted(() => vi.fn())
const reportMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/api/merchantAuth", () => ({
  requireMerchantIdFromRequest: authMock,
  getRouteErrorStatus: (error: unknown) =>
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : 500,
}))

vi.mock("@/engine/reports", () => ({
  generateReportEngine: reportMock,
}))

import { GET } from "@/app/api/reports/route"

describe("reports route logging", () => {
  beforeEach(() => {
    authMock.mockReset()
    reportMock.mockReset()
    vi.restoreAllMocks()
  })

  it("returns an expected authentication rejection without emitting an error log", async () => {
    authMock.mockRejectedValue(Object.assign(new Error("Missing bearer token"), { status: 401 }))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const response = await GET(new NextRequest("https://app.pinetree-payments.com/api/reports"))

    expect(response.status).toBe(401)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it("retains error-level diagnostics for genuine server failures", async () => {
    authMock.mockResolvedValue("merchant-1")
    reportMock.mockRejectedValue(new Error("database unavailable"))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const response = await GET(new NextRequest("https://app.pinetree-payments.com/api/reports"))

    expect(response.status).toBe(500)
    expect(errorSpy).toHaveBeenCalledOnce()
  })
})
