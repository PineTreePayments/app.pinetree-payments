#!/usr/bin/env node

const baseUrl = String(process.env.PINETREE_TERMINAL_SMOKE_BASE_URL || "http://localhost:3000").replace(/\/$/, "")
const token = String(process.env.PINETREE_TERMINAL_SMOKE_BEARER_TOKEN || "")
const posTerminalId = String(process.env.PINETREE_TERMINAL_SMOKE_POS_TERMINAL_ID || "")
const amount = Number(process.env.PINETREE_TERMINAL_SMOKE_AMOUNT || "1.00")

if (!token || !posTerminalId) {
  console.error("Set PINETREE_TERMINAL_SMOKE_BEARER_TOKEN and PINETREE_TERMINAL_SMOKE_POS_TERMINAL_ID.")
  process.exit(1)
}

const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${path}: ${body.error || response.status}`)
  return body
}

if (!String(process.env.STRIPE_SECRET_KEY || "").startsWith("sk_test_")) {
  console.error("Refusing to run: STRIPE_SECRET_KEY must be a Stripe test-mode key.")
  process.exit(1)
}

let paymentId = ""
try {
  const { reader } = await request("/api/providers/stripe/terminal/readers/simulated", { method: "POST", body: "{}" })
  const payment = await request("/api/payments/stripe/terminal", {
    method: "POST",
    body: JSON.stringify({ posTerminalId, amount, currency: "USD", readerId: reader.id })
  })
  paymentId = payment.paymentId
  await request("/api/providers/stripe/terminal/readers/simulate-payment", { method: "POST", body: JSON.stringify({ paymentId }) })

  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const state = await request(`/api/payments/stripe/terminal/${encodeURIComponent(paymentId)}`)
    if (state.payment.status === "CONFIRMED") {
      console.log(JSON.stringify({ ok: true, paymentId, status: "CONFIRMED", reader: reader.label }, null, 2))
      process.exit(0)
    }
    if (["FAILED", "INCOMPLETE"].includes(state.payment.status)) throw new Error(`Payment reached ${state.payment.status}`)
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
  throw new Error("Timed out waiting for the verified Stripe webhook and PineTree ledger transition")
} catch (error) {
  if (paymentId) await request(`/api/payments/stripe/terminal/${encodeURIComponent(paymentId)}/cancel`, { method: "POST" }).catch(() => undefined)
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
