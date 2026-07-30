import { describe, expect, it } from "vitest"
import {
  formatSupportCategory,
  formatSupportEnumLabel,
  formatSupportPriority,
  formatSupportSenderLabel,
  formatSupportStatus,
  formatSupportStatusShort,
  supportEnumEquals,
  supportPriorityPillClass,
  supportStatusPillClass,
} from "@/lib/support/supportDisplay"

describe("support enum display formatting", () => {
  it("title-cases single-word enums", () => {
    expect(formatSupportPriority("urgent")).toBe("Urgent")
    expect(formatSupportPriority("high")).toBe("High")
    expect(formatSupportPriority("normal")).toBe("Normal")
    expect(formatSupportPriority("low")).toBe("Low")
    expect(formatSupportStatus("resolved")).toBe("Resolved")
    expect(formatSupportStatus("open")).toBe("Open")
    expect(formatSupportStatus("archived")).toBe("Archived")
  })

  it("expands snake_case enums into title case", () => {
    expect(formatSupportCategory("wallet_connection")).toBe("Wallet Connection")
    expect(formatSupportStatus("in_review")).toBe("In Review")
  })

  it("keeps interior small words lowercase", () => {
    expect(formatSupportStatus("waiting_on_merchant")).toBe("Waiting on Merchant")
    expect(formatSupportEnumLabel("WAITING_ON_MERCHANT")).toBe("Waiting on Merchant")
  })

  it("never emits an all-caps word that was not a compact system label", () => {
    expect(formatSupportEnumLabel("URGENT")).toBe("Urgent")
    expect(formatSupportEnumLabel("PAYMENT_ISSUE")).toBe("Payment Issue")
  })

  it("preserves compact system acronyms already present in the canonical value", () => {
    expect(formatSupportCategory("POS Issue")).toBe("POS Issue")
    expect(formatSupportCategory("API Support")).toBe("API Support")
    expect(formatSupportCategory("pos_issue")).toBe("POS Issue")
  })

  it("passes through already-formatted stored categories unchanged", () => {
    for (const category of [
      "Payment Issue",
      "Wallet Connection",
      "Dashboard Issue",
      "Settlement Question",
      "POS Issue",
      "Feature Request",
      "API Support",
      "General Support",
    ]) {
      expect(formatSupportCategory(category)).toBe(category)
    }
  })

  it("renders an em dash for missing values instead of an empty pill", () => {
    expect(formatSupportEnumLabel("")).toBe("—")
    expect(formatSupportEnumLabel(null)).toBe("—")
    expect(formatSupportEnumLabel(undefined)).toBe("—")
  })

  it("offers a compact but still capitalized status label for chrome", () => {
    expect(formatSupportStatusShort("waiting_on_merchant")).toBe("Waiting")
    expect(formatSupportStatusShort("in_review")).toBe("In Review")
    expect(formatSupportStatusShort("open")).toBe("Open")
  })

  it("labels senders without leaking raw sender_type values", () => {
    expect(formatSupportSenderLabel("pinetree", null)).toBe("PineTree Support")
    expect(formatSupportSenderLabel("merchant", null)).toBe("Merchant")
    expect(formatSupportSenderLabel("system", null)).toBe("System")
    expect(formatSupportSenderLabel("pinetree", "Support Agent")).toBe("Support Agent")
  })

  it("compares enums case-insensitively so mixed-case stored rows still filter", () => {
    expect(supportEnumEquals("Urgent", "urgent")).toBe(true)
    expect(supportEnumEquals("urgent", "Urgent")).toBe(true)
    expect(supportEnumEquals("high", "urgent")).toBe(false)
  })

  it("keeps the documented status and priority colour projections", () => {
    expect(supportStatusPillClass("open")).toContain("blue")
    expect(supportStatusPillClass("resolved")).toContain("emerald")
    expect(supportStatusPillClass("archived")).toContain("gray")
    expect(supportPriorityPillClass("urgent")).toContain("red")
    expect(supportPriorityPillClass("normal")).toContain("blue")
  })
})
