import { describe, expect, it } from "vitest"
import { getShift4DisplayStatus } from "@/lib/shift4DisplayStatus"

describe("Shift4 provider display status", () => {
  it("shows Not connected before submission", () => {
    expect(getShift4DisplayStatus({ providerStatus: "pending" })).toEqual({
      label: "Not connected",
      tone: "default"
    })
  })

  it("shows Pending after an account reference is saved", () => {
    expect(getShift4DisplayStatus({
      providerStatus: "pending",
      accountReference: "shift4-application-123"
    })).toEqual({
      label: "Pending",
      tone: "amber"
    })
  })

  it.each([
    { providerStatus: "active" },
    { merchantApprovalStatus: "Approved" },
    { apiStatus: "Live ready" }
  ])("shows Connected for approved or active setup", (input) => {
    expect(getShift4DisplayStatus(input)).toEqual({
      label: "Connected",
      tone: "blue"
    })
  })

  it.each(["Rejected", "Declined", "Denied"])(
    "shows Denied for rejected applications with %s",
    (merchantApprovalStatus) => {
      expect(getShift4DisplayStatus({
        accountReference: "shift4-application-123",
        merchantApprovalStatus
      })).toEqual({
        label: "Denied",
        tone: "red"
      })
    }
  )

  it("does not treat inactive as active", () => {
    expect(getShift4DisplayStatus({ providerStatus: "inactive" })).toEqual({
      label: "Not connected",
      tone: "default"
    })
  })

  it("lets rejection override stale active fields", () => {
    expect(getShift4DisplayStatus({
      providerStatus: "active",
      accountReference: "shift4-application-123",
      merchantApprovalStatus: "Rejected"
    })).toEqual({
      label: "Denied",
      tone: "red"
    })
  })
})
