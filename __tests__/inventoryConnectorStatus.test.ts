import { describe, expect, it } from "vitest"

import {
  canRunProviderSync,
  statusForCredentialConfiguration
} from "@/engine/inventoryConnectorLogic"

describe("inventory connector status logic", () => {
  it("does not mark missing provider credentials as connected", () => {
    expect(statusForCredentialConfiguration({ requiredValues: ["", undefined] })).toBe("REQUIRES_CONFIGURATION")
  })

  it("marks complete configuration as available but not connected", () => {
    expect(statusForCredentialConfiguration({ requiredValues: ["client-id", "client-secret"] })).toBe("AVAILABLE")
  })

  it("requires explicit connected state before sync can run", () => {
    expect(canRunProviderSync("REQUIRES_CONFIGURATION")).toBe(false)
    expect(canRunProviderSync("CONNECTED")).toBe(true)
  })
})
