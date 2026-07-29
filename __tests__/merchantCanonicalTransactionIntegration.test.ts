import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { projectCanonicalTransaction } from "@/engine/canonicalTransactions"
import {
  summarizeCanonicalTransactionActivity,
  toMerchantTransactionReadRow,
} from "@/engine/transactionsDashboard"

function fixture(status: string, grossAmount: number) {
  return projectCanonicalTransaction({
    id: `payment-${status.toLowerCase()}`,
    merchant_id: "merchant-1",
    gross_amount: grossAmount,
    merchant_amount: grossAmount,
    pinetree_fee: 0,
    currency: "USD",
    provider: "base",
    provider_reference: `provider-${status.toLowerCase()}`,
    status,
    network: "base",
    metadata: {
      selectedAsset: "USDC",
      source: "checkout",
      internalSecret: "never-return-this",
      split: {
        nativeSymbol: "USDC",
        expectedAmountNative: grossAmount,
        quotePriceUsd: 1,
        relayerPrivateKey: "never-return-this-either",
      },
    },
    created_at: "2026-07-28T12:34:56.000Z",
    transactions: [{
      id: `attempt-${status.toLowerCase()}`,
      payment_id: `payment-${status.toLowerCase()}`,
      merchant_id: "merchant-1",
      provider: "base",
      provider_transaction_id: `hash-${status.toLowerCase()}`,
      network: "base",
      status: status === "INCOMPLETE" ? "CANCELED" : status,
      channel: "online",
      total_amount: Math.round(grossAmount * 100),
      created_at: "2026-07-28T12:34:57.000Z",
    }],
    payment_events: status === "INCOMPLETE" ? [{
      id: "event-canceled",
      payment_id: "payment-incomplete",
      event_type: "payment.canceled",
      provider_event: "provider-canceled",
      created_at: "2026-07-28T12:35:00.000Z",
    }] : [],
  })
}

describe("merchant canonical transaction integration", () => {
  it("keeps payment status authoritative while exposing conflicting event evidence only in history", () => {
    const canonical = fixture("INCOMPLETE", 1.22)
    const row = toMerchantTransactionReadRow(canonical)

    expect(row).toMatchObject({
      paymentId: "payment-incomplete",
      canonicalStatus: "INCOMPLETE",
      displayStatus: "Incomplete",
      rail: "Base",
      asset: "USDC",
      currency: "USD",
      amountMinor: 122,
      occurredAt: "2026-07-28T12:34:56.000Z",
    })
    expect(row.lifecycle_events).toEqual([
      expect.objectContaining({ type: "payment.canceled", status: "CANCELED" }),
    ])
    expect(Object.keys(row).sort()).toEqual([
      "amountMinor",
      "asset",
      "assetPaymentDetails",
      "attemptId",
      "canonicalStatus",
      "channel",
      "currency",
      "displayAmount",
      "displayStatus",
      "lifecycle_events",
      "network",
      "occurredAt",
      "paymentId",
      "provider",
      "providerReference",
      "rail",
      "transactionHash",
    ])
    expect(row).not.toHaveProperty("metadata")
    expect(row).not.toHaveProperty("raw")
    expect(row).not.toHaveProperty("attempts")
    expect(row).not.toHaveProperty("diagnostics")
    expect(row).not.toHaveProperty("lifecycleEvents")
    expect(row).not.toHaveProperty("payments")
    expect(JSON.stringify(row)).not.toContain("never-return-this")
    expect(JSON.stringify(row)).not.toContain("provider-canceled")
  })

  it("calculates counts, success rate, and volume from the same one-row-per-payment set", () => {
    const rows = [fixture("CONFIRMED", 12.34), fixture("CANCELED", 9.99)]

    expect(summarizeCanonicalTransactionActivity(rows)).toEqual({
      volume: 12.34,
      transactionCount: 2,
      confirmedCount: 1,
      confirmedRate: 50,
    })
  })

  it("keeps overview and transactions free of independent lifecycle queries and UI status selection", () => {
    const overviewSource = fs.readFileSync(
      path.join(process.cwd(), "engine/dashboardOverview.ts"),
      "utf8"
    )
    const transactionsSource = fs.readFileSync(
      path.join(process.cwd(), "engine/transactionsDashboard.ts"),
      "utf8"
    )
    const uiSource = fs.readFileSync(
      path.join(process.cwd(), "app/dashboard/transactions/page.tsx"),
      "utf8"
    )

    expect(overviewSource).toContain("getAllCanonicalTransactions")
    expect(overviewSource).toContain("toMerchantTransactionReadRow")
    expect(overviewSource).not.toContain('.from("transactions")')
    expect(transactionsSource).toContain("getCanonicalTransactionPage")
    expect(transactionsSource).not.toContain('.from("payment_events")')
    expect(uiSource).toContain('tx.canonicalStatus === "CONFIRMED"')
    expect(uiSource).not.toContain("payment?.status || tx.status")
  })
})
