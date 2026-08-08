/**
 * Bank withdrawals - the confirmation rule, drain state mapping, and ordering.
 *
 * The rule under test throughout: a source-chain transaction reaching the
 * settlement provider is NOT a completed bank payout. Only the provider's own
 * payout evidence may confirm a bank withdrawal.
 *
 * Every identifier, address, and hash here is fabricated.
 */

import { describe, expect, it } from "vitest"

import {
  drainForwardRank,
  isStaleDrainEvidence,
  mapDrainStateToWithdrawal,
} from "@/engine/withdrawals/bridgeDrainLifecycle"
import {
  bridgeChainForRail,
  depositTxHashMatches,
  findMatchingLiquidationAddress,
  isReturnAddressValidForChain,
  normalizeBridgeDrain,
  normalizeBridgeDrainState,
  normalizeBridgeExternalAccount,
  normalizeBridgeLiquidationAddress,
  railForBridgeChain,
} from "@/providers/bridge/normalizeMoneyMovement"
import { BRIDGE_DRAIN_STATES } from "@/providers/bridge/types"
import { isSupportedBankWithdrawalSource } from "@/engine/bridgeLiquidationRoutes"

const FAKE_BASE_ADDRESS = "0x1111111111111111111111111111111111111111"
const FAKE_SOLANA_ADDRESS = "5rEXAmpLeFakeSoLanaAddressForTests1111111111"

describe("Bank payout evidence decides confirmation", () => {
  it("never confirms from a state that only proves funds reached the provider", () => {
    for (const state of ["awaiting_funds", "in_review", "funds_received", "payment_submitted"] as const) {
      const outcome = mapDrainStateToWithdrawal(state)
      expect(outcome.status, state).toBe("processing")
      expect(outcome.terminalSuccess, state).toBe(false)
    }
  })

  it("confirms only on a completed payout", () => {
    const outcome = mapDrainStateToWithdrawal("payment_processed")
    expect(outcome.status).toBe("confirmed")
    expect(outcome.terminalSuccess).toBe(true)
    expect(outcome.terminalFailure).toBe(false)
  })

  it("treats a returned, refunded, undeliverable, or canceled payout as a verified failure", () => {
    for (const state of ["undeliverable", "returned", "refunded", "canceled"] as const) {
      const outcome = mapDrainStateToWithdrawal(state)
      expect(outcome.status, state).toBe("failed")
      expect(outcome.terminalFailure, state).toBe(true)
      // A failed payout must never read as success anywhere.
      expect(outcome.terminalSuccess, state).toBe(false)
      expect(outcome.errorCode, state).toBeTruthy()
    }
  })

  it("treats a provider error as UNKNOWN, not as failure", () => {
    const outcome = mapDrainStateToWithdrawal("error")
    // Unknown means: change nothing, keep looking. Never a verdict.
    expect(outcome.status).toBeNull()
    expect(outcome.unresolved).toBe(true)
    expect(outcome.terminalFailure).toBe(false)
    expect(outcome.requiresOperatorAction).toBe(true)
  })

  it("keeps an in-flight refund nonterminal while flagging it for an operator", () => {
    const outcome = mapDrainStateToWithdrawal("refund_in_flight")
    expect(outcome.status).toBe("processing")
    expect(outcome.terminalFailure).toBe(false)
    expect(outcome.requiresOperatorAction).toBe(true)
  })

  it("changes nothing for an unrecognized provider value", () => {
    const outcome = mapDrainStateToWithdrawal("unknown")
    expect(outcome.status).toBeNull()
    expect(outcome.terminalSuccess).toBe(false)
    expect(outcome.terminalFailure).toBe(false)
  })

  it("maps every documented drain state deliberately", () => {
    for (const state of BRIDGE_DRAIN_STATES) {
      const outcome = mapDrainStateToWithdrawal(state)
      // Exactly one of: confirmed, failed, still processing, or unresolved.
      const resolutions = [
        outcome.terminalSuccess,
        outcome.terminalFailure,
        outcome.status === "processing",
        outcome.unresolved,
      ].filter(Boolean)
      expect(resolutions.length, state).toBe(1)
    }
  })

  it("never exposes a provider status code or provider vocabulary in merchant copy", () => {
    for (const state of BRIDGE_DRAIN_STATES) {
      const message = mapDrainStateToWithdrawal(state).merchantMessage
      if (!message) continue
      const lower = message.toLowerCase()
      // The provider's own snake_case codes are the leak this guards against;
      // ordinary English that happens to share a word is fine.
      expect(lower, state).not.toMatch(/[a-z]+_[a-z_]+/)
      for (const term of ["bridge", "drain", "liquidation", "kyb", "endorsement"]) {
        expect(lower, `${state}/${term}`).not.toContain(term)
      }
    }
  })
})

describe("Out-of-order payout evidence", () => {
  it("refuses evidence that moves backwards along the documented progression", () => {
    expect(
      isStaleDrainEvidence({
        storedState: "payment_processed",
        incomingState: "funds_received",
        storedUpdatedAtMs: null,
        incomingUpdatedAtMs: null,
      })
    ).toBe(true)
  })

  it("accepts evidence that moves forwards", () => {
    expect(
      isStaleDrainEvidence({
        storedState: "funds_received",
        incomingState: "payment_processed",
        storedUpdatedAtMs: 1000,
        incomingUpdatedAtMs: 2000,
      })
    ).toBe(false)
  })

  it("falls back to timestamps for states off the forward path", () => {
    expect(
      isStaleDrainEvidence({
        storedState: "returned",
        incomingState: "error",
        storedUpdatedAtMs: 5000,
        incomingUpdatedAtMs: 4000,
      })
    ).toBe(true)
  })

  it("ranks only the documented forward progression", () => {
    expect(drainForwardRank("funds_received")).toBeLessThan(drainForwardRank("payment_processed"))
    expect(drainForwardRank("returned")).toBe(-1)
    expect(drainForwardRank("unknown")).toBe(-1)
  })
})

describe("Settlement route safety", () => {
  it("supports only USDC on Base and Solana", () => {
    expect(isSupportedBankWithdrawalSource("base", "USDC")).toBe(true)
    expect(isSupportedBankWithdrawalSource("solana", "USDC")).toBe(true)
    // Native assets have no settlement route: the deposit address takes USDC.
    expect(isSupportedBankWithdrawalSource("base", "ETH")).toBe(false)
    expect(isSupportedBankWithdrawalSource("solana", "SOL")).toBe(false)
    expect(isSupportedBankWithdrawalSource("bitcoin", "BTC")).toBe(false)
  })

  it("requires a return address on the same chain as the route", () => {
    expect(isReturnAddressValidForChain("base", FAKE_BASE_ADDRESS)).toBe(true)
    expect(isReturnAddressValidForChain("solana", FAKE_SOLANA_ADDRESS)).toBe(true)
    // A wrong-chain return address would make an unprocessable deposit
    // unreturnable, so it is rejected rather than sent.
    expect(isReturnAddressValidForChain("base", FAKE_SOLANA_ADDRESS)).toBe(false)
    expect(isReturnAddressValidForChain("solana", FAKE_BASE_ADDRESS)).toBe(false)
    expect(isReturnAddressValidForChain("base", "")).toBe(false)
    expect(isReturnAddressValidForChain("bitcoin", FAKE_BASE_ADDRESS)).toBe(false)
  })

  it("maps rails to provider chains explicitly in both directions", () => {
    expect(bridgeChainForRail("base")).toBe("base")
    expect(bridgeChainForRail("solana")).toBe("solana")
    expect(bridgeChainForRail("bitcoin")).toBeNull()
    expect(railForBridgeChain("solana")).toBe("solana")
    expect(railForBridgeChain("ethereum")).toBeNull()
  })

  it("reuses an equivalent existing route instead of creating a duplicate", () => {
    const match = findMatchingLiquidationAddress(
      [
        {
          id: "fake_la_wrong_chain",
          address: FAKE_SOLANA_ADDRESS,
          chain: "solana",
          currency: "usdc",
          external_account_id: "fake_ea_1",
          destination_payment_rail: "ach",
          destination_currency: "usd",
          state: "active",
        },
        {
          id: "fake_la_match",
          address: FAKE_BASE_ADDRESS,
          chain: "base",
          currency: "usdc",
          external_account_id: "fake_ea_1",
          destination_payment_rail: "ach",
          destination_currency: "usd",
          state: "active",
        },
      ],
      {
        chain: "base",
        currency: "usdc",
        externalAccountId: "fake_ea_1",
        destinationPaymentRail: "ach",
        destinationCurrency: "usd",
      }
    )

    expect(match?.liquidationAddressId).toBe("fake_la_match")
  })

  it("never reuses a deactivated or differently-bound route", () => {
    const route = {
      chain: "base" as const,
      currency: "usdc",
      externalAccountId: "fake_ea_1",
      destinationPaymentRail: "ach",
      destinationCurrency: "usd",
    }

    expect(
      findMatchingLiquidationAddress(
        [
          {
            id: "fake_la_dead",
            address: FAKE_BASE_ADDRESS,
            chain: "base",
            currency: "usdc",
            external_account_id: "fake_ea_1",
            destination_payment_rail: "ach",
            destination_currency: "usd",
            state: "deactivated",
          },
        ],
        route
      )
    ).toBeNull()

    expect(
      findMatchingLiquidationAddress(
        [
          {
            id: "fake_la_other_bank",
            address: FAKE_BASE_ADDRESS,
            chain: "base",
            currency: "usdc",
            external_account_id: "fake_ea_2",
            destination_payment_rail: "ach",
            destination_currency: "usd",
            state: "active",
          },
        ],
        route
      )
    ).toBeNull()
  })
})

describe("Provider object normalization", () => {
  it("keeps only masked bank details", () => {
    const normalized = normalizeBridgeExternalAccount({
      id: "fake_ea_1",
      bank_name: "Fake Bank",
      account_owner_name: "Fake Test Business LLC",
      currency: "USD",
      account: { last_4: "6789", checking_or_savings: "checking" },
      active: true,
    })

    expect(normalized).toMatchObject({
      externalAccountId: "fake_ea_1",
      last4: "6789",
      checkingOrSavings: "checking",
      currency: "usd",
      active: true,
    })
    // There is no field on the normalized shape that could carry a full number.
    expect(JSON.stringify(normalized)).not.toContain("account_number")
  })

  it("treats an omitted active flag as active rather than unusable", () => {
    expect(normalizeBridgeExternalAccount({ id: "fake_ea_2" }).active).toBe(true)
    expect(normalizeBridgeExternalAccount({ id: "fake_ea_3", active: false }).active).toBe(false)
  })

  it("normalizes a liquidation address and its deactivated state", () => {
    const normalized = normalizeBridgeLiquidationAddress({
      id: "fake_la_1",
      address: FAKE_BASE_ADDRESS,
      chain: "base",
      currency: "USDC",
      external_account_id: "fake_ea_1",
      destination_payment_rail: "ACH",
      destination_currency: "USD",
      state: "deactivated",
    })

    expect(normalized).toMatchObject({
      liquidationAddressId: "fake_la_1",
      depositAddress: FAKE_BASE_ADDRESS,
      chain: "base",
      currency: "usdc",
      destinationPaymentRail: "ach",
      destinationCurrency: "usd",
      active: false,
    })
  })

  it("normalizes a drain, keeping the amount as an exact decimal string", () => {
    const normalized = normalizeBridgeDrain({
      id: "fake_drain_1",
      liquidation_address_id: "fake_la_1",
      amount: "1234.567890",
      currency: "USD",
      state: "payment_processed",
      deposit_tx_hash: "0xDEPOSIT",
      destination_tx_hash: "0xPAYOUT",
      updated_at: "2026-08-07T00:00:00.000Z",
      destination: { payment_rail: "ach", currency: "usd", trace_number: "718268532664263" },
    })

    expect(normalized).toMatchObject({
      drainId: "fake_drain_1",
      state: "payment_processed",
      amount: "1234.567890",
      currency: "usd",
      payoutTraceReference: "718268532664263",
    })
    // Money never round-trips through a float.
    expect(typeof normalized?.amount).toBe("string")
  })

  it("returns null for a drain with no identifier instead of guessing", () => {
    expect(normalizeBridgeDrain({ id: "", state: "payment_processed" })).toBeNull()
  })

  it("normalizes an unrecognized drain state to unknown, never to a real one", () => {
    expect(normalizeBridgeDrainState("something_new")).toBe("unknown")
    expect(normalizeBridgeDrainState(null)).toBe("unknown")
    expect(normalizeBridgeDrainState("payment_processed")).toBe("payment_processed")
  })
})

describe("Deposit transaction correlation", () => {
  it("compares EVM hashes case-insensitively and Solana signatures exactly", () => {
    expect(depositTxHashMatches("base", "0xABC123", "0xabc123")).toBe(true)
    // Solana signatures are base58: case is significant.
    expect(depositTxHashMatches("solana", "AbC123", "abc123")).toBe(false)
    expect(depositTxHashMatches("solana", "AbC123", "AbC123")).toBe(true)
  })

  it("never matches an empty reference", () => {
    expect(depositTxHashMatches("base", "", "0xabc")).toBe(false)
    expect(depositTxHashMatches("base", "0xabc", "")).toBe(false)
  })
})
