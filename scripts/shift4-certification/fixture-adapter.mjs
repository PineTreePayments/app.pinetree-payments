export class Shift4FixtureAdapter {
  constructor(store) { this.store = store }
  async execute({ testCase, operation, ordinal, amountMinor, invoice }) {
    const expected = testCase.expected.toLowerCase(); const name = testCase.name.toLowerCase()
    let outcome = "approved", responseCode = "A", approvedAmountMinor = amountMinor
    if (operation === "invoice_lookup") {
      if (expected.includes("approved_after_lookup")) outcome = "approved"
      else if (expected.includes("referral")) { outcome = "referral"; responseCode = "R"; approvedAmountMinor = 0 }
      else if (expected.includes("blank")) { outcome = "unknown"; responseCode = null; approvedAmountMinor = null }
      else { outcome = "declined"; responseCode = "D"; approvedAmountMinor = 0 }
    } else if (name.includes("timeout") && ordinal === 1) { outcome = "unknown"; responseCode = null; approvedAmountMinor = null }
    else if (expected.includes("referral") && operation === "authorization") { outcome = "referral"; responseCode = "R"; approvedAmountMinor = 0 }
    else if (expected.includes("declined") || expected.includes("invalid") || expected.includes("http_400")) { outcome = "declined"; responseCode = expected.includes("http") ? "400" : "D"; approvedAmountMinor = 0 }
    else if ((name.includes("partial authorization") || name.includes("split tender")) && operation === "authorization" && ordinal === 1) { outcome = "partial_approval"; responseCode = "P"; approvedAmountMinor = Math.floor(amountMinor / 2) }
    else if (operation === "void") { outcome = "voided"; responseCode = "A"; approvedAmountMinor = 0 }
    return Object.freeze({ outcome, responseCode, approvedAmountMinor, invoice, providerRequestSent: false })
  }
}
