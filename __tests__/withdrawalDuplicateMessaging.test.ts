import { describe, expect, it } from "vitest"
import {
  WITHDRAWAL_ERROR_MESSAGES,
  presentWithdrawalError,
} from "@/engine/withdrawals/withdrawalErrorPresentation"

/**
 * Regression coverage for the false "already happened" incident: a Bitcoin
 * withdrawal that never reached the provider must never be described to the
 * merchant as an existing/completed withdrawal.
 *
 * - IDEMPOTENCY_KEY_CONFLICT means the same request key was reused with
 *   DIFFERENT details - nothing was submitted for the new request, so the
 *   copy must direct the merchant to a fresh attempt, not claim restoration.
 * - DUPLICATE_WITHDRAWAL may only claim an existing withdrawal exists and
 *   that its status is being checked - never that it completed.
 */
describe("withdrawal duplicate/conflict messaging truthfulness", () => {
  it("conflict copy never claims the withdrawal already exists or was restored", () => {
    const message = WITHDRAWAL_ERROR_MESSAGES.IDEMPOTENCY_KEY_CONFLICT
    expect(message.toLowerCase()).not.toContain("already exists")
    expect(message.toLowerCase()).not.toContain("already happened")
    expect(message.toLowerCase()).not.toContain("restored")
    expect(message.toLowerCase()).toContain("new")
  })

  it("duplicate copy says status is being checked, never that it completed", () => {
    const message = WITHDRAWAL_ERROR_MESSAGES.DUPLICATE_WITHDRAWAL
    expect(message.toLowerCase()).toContain("checking")
    expect(message.toLowerCase()).not.toContain("completed")
    expect(message.toLowerCase()).not.toContain("restored")
  })

  it("presentWithdrawalError maps an explicit conflict code to the conflict copy", () => {
    const presented = presentWithdrawalError({ code: "IDEMPOTENCY_KEY_CONFLICT" })
    expect(presented.code).toBe("IDEMPOTENCY_KEY_CONFLICT")
    expect(presented.message).toBe(WITHDRAWAL_ERROR_MESSAGES.IDEMPOTENCY_KEY_CONFLICT)
  })

  it("legacy 'duplicate' message text classifies to the checking-status copy", () => {
    const presented = presentWithdrawalError({ rawMessage: "duplicate withdrawal detected" })
    expect(presented.code).toBe("DUPLICATE_WITHDRAWAL")
    expect(presented.message).toBe(WITHDRAWAL_ERROR_MESSAGES.DUPLICATE_WITHDRAWAL)
  })
})
