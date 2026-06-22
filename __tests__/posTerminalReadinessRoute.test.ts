import { beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"

const mocks = vi.hoisted(() => ({
  requireMerchantIdFromRequest: vi.fn(),
  createPosTerminalEngine: vi.fn(),
  getPosTerminalsEngine: vi.fn(),
  deletePosTerminalEngine: vi.fn(),
  getMerchantTaxSettings: vi.fn()
}))

vi.mock("@/lib/api/merchantAuth", () => ({
  getRouteErrorStatus: () => 500,
  requireMerchantIdFromRequest: mocks.requireMerchantIdFromRequest
}))

vi.mock("@/engine/posTerminals", () => ({
  createPosTerminalEngine: mocks.createPosTerminalEngine,
  deletePosTerminalEngine: mocks.deletePosTerminalEngine,
  getPosTerminalsEngine: mocks.getPosTerminalsEngine
}))

vi.mock("@/database/merchants", () => ({
  getMerchantTaxSettings: mocks.getMerchantTaxSettings
}))

import { POST } from "@/app/api/pos/terminals/route"

function terminalRequest(tax: Record<string, unknown>) {
  return new Request("https://app.pinetree-payments.test/api/pos/terminals", {
    method: "POST",
    body: JSON.stringify({
      name: "Front Register",
      pin: "1234",
      recoveryPhrase: "safe phrase",
      autolock: "5",
      drawer_starting_amount: 0,
      ...tax
    })
  })
}

describe("POS terminal tax setup route", () => {
  beforeEach(() => {
    mocks.requireMerchantIdFromRequest.mockResolvedValue("merchant_123")
    mocks.createPosTerminalEngine.mockReset()
    mocks.createPosTerminalEngine.mockResolvedValue({ id: "terminal_123", name: "Front Register" })
    mocks.getMerchantTaxSettings.mockReset()
    mocks.getMerchantTaxSettings.mockResolvedValue({ taxEnabled: false, taxRate: 0 })
  })

  it("creates a terminal with no tax without a global settings readiness gate", async () => {
    const response = await POST(terminalRequest({ taxMode: "none" }) as never)
    expect(response.status).toBe(200)
    expect(mocks.createPosTerminalEngine).toHaveBeenCalledWith(
      "merchant_123",
      expect.objectContaining({ taxMode: "none", taxRate: null })
    )
  })

  it("creates a terminal with a valid custom tax rate", async () => {
    const response = await POST(terminalRequest({ taxMode: "custom", taxRate: 8.25 }) as never)
    expect(response.status).toBe(200)
    expect(mocks.createPosTerminalEngine).toHaveBeenCalledWith(
      "merchant_123",
      expect.objectContaining({ taxMode: "custom", taxRate: 8.25 })
    )
  })

  it("rejects an invalid custom tax rate", async () => {
    const response = await POST(terminalRequest({ taxMode: "custom", taxRate: 0 }) as never)
    expect(response.status).toBe(400)
    expect(mocks.createPosTerminalEngine).not.toHaveBeenCalled()
  })

  it("opens terminal setup without the old settings gate and shows inline tax choices", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "app/dashboard/pos/page.tsx"), "utf8")
    expect(source).toContain("function startCreatingTerminal()")
    expect(source).toContain("setCreating(true)")
    expect(source).toContain("Tax configuration")
    expect(source).toContain("No tax")
    expect(source).toContain("Use default tax rate")
    expect(source).toContain("Custom tax rate")
    expect(source).not.toContain("Settings required before creating a terminal")
    expect(source).not.toContain("showSettingsRequired")
  })
})
