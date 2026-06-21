import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireMerchantIdFromRequest: vi.fn(),
  getMerchantSettingsReadiness: vi.fn(),
  createPosTerminalEngine: vi.fn(),
  getPosTerminalsEngine: vi.fn(),
  deletePosTerminalEngine: vi.fn()
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  getRouteErrorStatus: () => 500,
  requireMerchantIdFromRequest: mocks.requireMerchantIdFromRequest
}))

vi.mock("@/engine/settingsDashboard", () => ({
  getMerchantSettingsReadiness: mocks.getMerchantSettingsReadiness
}))

vi.mock("@/engine/posTerminals", () => ({
  createPosTerminalEngine: mocks.createPosTerminalEngine,
  deletePosTerminalEngine: mocks.deletePosTerminalEngine,
  getPosTerminalsEngine: mocks.getPosTerminalsEngine
}))

import { POST } from "@/app/api/pos/terminals/route"

function terminalRequest() {
  return new Request("https://app.pinetree-payments.test/api/pos/terminals", {
    method: "POST",
    body: JSON.stringify({
      name: "Front Register",
      pin: "1234",
      recoveryPhrase: "safe phrase",
      autolock: "5",
      drawer_starting_amount: 0
    })
  })
}

describe("POS terminal readiness route", () => {
  beforeEach(() => {
    mocks.requireMerchantIdFromRequest.mockResolvedValue("merchant_123")
    mocks.getMerchantSettingsReadiness.mockReset()
    mocks.createPosTerminalEngine.mockReset()
    mocks.getPosTerminalsEngine.mockReset()
    mocks.deletePosTerminalEngine.mockReset()
  })

  it("blocks terminal creation when settings are incomplete", async () => {
    mocks.getMerchantSettingsReadiness.mockResolvedValue({
      complete: false,
      missing: ["Business name"],
      reason: "Complete your business and tax settings before enabling POS terminals."
    })

    const response = await POST(terminalRequest() as never)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toBe("Settings required before creating a terminal.")
    expect(mocks.createPosTerminalEngine).not.toHaveBeenCalled()
  })

  it("allows terminal creation when settings are complete", async () => {
    mocks.getMerchantSettingsReadiness.mockResolvedValue({
      complete: true,
      missing: []
    })
    mocks.createPosTerminalEngine.mockResolvedValue({
      id: "terminal_123",
      name: "Front Register"
    })

    const response = await POST(terminalRequest() as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.terminal.id).toBe("terminal_123")
    expect(mocks.createPosTerminalEngine).toHaveBeenCalledWith(
      "merchant_123",
      expect.objectContaining({ name: "Front Register", pin: "1234" })
    )
  })
})
