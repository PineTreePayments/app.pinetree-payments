import fs from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  assertDynamicWalletChain,
  findDynamicApprovalWalletForSource,
  type DynamicWalletLike,
} from "@/lib/wallets/dynamicSignerLookup"

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8").replace(/\r\n/g, "\n")

function wallet(chain: "evm" | "solana" | "bitcoin", address: string): DynamicWalletLike {
  if (chain === "evm") return { chain: "evm", address, getWalletClient: vi.fn() }
  if (chain === "solana") return { chain: "solana", address, signAndSendTransaction: vi.fn() }
  return { chain: "bitcoin", address, signPsbt: vi.fn() }
}

describe("standardized withdrawal signer context", () => {
  const evm = wallet("evm", "0xA100000000000000000000000000000000000001")
  const solana = wallet("solana", "So1anaSource1111111111111111111111111111111")
  const bitcoin = wallet("bitcoin", "bc1qpreviousbitcoinwallet")

  it.each(["ETH", "USDC"])("Base %s selects only the source-matched EVM wallet", () => {
    expect(findDynamicApprovalWalletForSource([bitcoin, solana, evm], bitcoin, "base", String(evm.address))).toBe(evm)
    expect(() => assertDynamicWalletChain(evm, "base")).not.toThrow()
  })

  it.each(["SOL", "USDC"])("Solana %s selects only the source-matched Solana wallet", () => {
    expect(findDynamicApprovalWalletForSource([bitcoin, evm, solana], bitcoin, "solana", String(solana.address))).toBe(solana)
    expect(() => assertDynamicWalletChain(solana, "solana")).not.toThrow()
  })

  it("never lets a Bitcoin primary wallet leak into Base or Solana", () => {
    expect(findDynamicApprovalWalletForSource([bitcoin, evm], bitcoin, "base", String(bitcoin.address))).toBeNull()
    expect(findDynamicApprovalWalletForSource([bitcoin, solana], bitcoin, "solana", String(bitcoin.address))).toBeNull()
  })

  it("does not let stale selection ordering override the prepared source", () => {
    const stale = wallet("evm", "0xB200000000000000000000000000000000000002")
    expect(findDynamicApprovalWalletForSource([stale, evm], stale, "base", String(evm.address))).toBe(evm)
  })

  it("blocks mismatched addresses and wallet families", () => {
    expect(findDynamicApprovalWalletForSource([evm], evm, "base", "0xC300000000000000000000000000000000000003")).toBeNull()
    expect(() => assertDynamicWalletChain(bitcoin, "base")).toThrow(/expected EVM signer/)
    expect(() => assertDynamicWalletChain(evm, "solana")).toThrow(/expected Solana signer/)
  })
})

describe("standardized withdrawal presentation and submission safety", () => {
  const page = source("app/dashboard/wallet-setup/page.tsx")
  const cards = source("components/withdrawals/WithdrawalCards.tsx")
  const provider = source("components/providers/PineTreeDynamicProvider.tsx")

  it("defines and uses every shared PineTree withdrawal component", () => {
    for (const name of ["WithdrawalReviewCard", "WithdrawalProgressCard", "WithdrawalResultCard", "WithdrawalDetailsCard", "WithdrawalStatusPill"]) {
      expect(cards).toContain(`function ${name}`)
    }
    expect(page).toContain("<WithdrawalReviewCard")
    expect(page).toContain("<WithdrawalProgressCard")
    expect(page).toContain("<SharedWithdrawalResultCard")
  })

  it("uses one confirm label and a synchronous duplicate-operation lock", () => {
    expect(cards).toContain('"Confirm withdrawal"')
    expect(page).toContain("withdrawalSubmitLockRef.current")
    expect(page).toContain("submittingWithdrawal || withdrawalSubmitLockRef.current")
  })

  it("requires Base chain 8453 and persists evidence before polling", () => {
    expect(page).toContain("if (activeChainId !== 8453)")
    expect(page.indexOf("persistActiveWithdrawalMarker(merchantId")).toBeLessThan(page.indexOf("void pollWithdrawalRequest(withdrawalId"))
  })

  it("rechecks canonical identity and amount before invoking a signer", () => {
    expect(page).toContain("prepared.request.merchant_id !== context.merchantId")
    expect(page).toContain("prepared.request.amount_decimal !== context.amountDecimal")
    expect(page).toContain("prepared.request.id !== context.requestId")
  })

  it("uses the supported Dynamic transaction-confirmation configuration rather than CSS/DOM automation", () => {
    expect(provider).toContain("transactionConfirmation: { required: false }")
    expect(provider).not.toMatch(/querySelector|display\s*:\s*none.*dynamic-send-transaction/i)
  })

  it("keeps unknown outcomes in CHECKING_STATUS without an unsafe retry", () => {
    expect(cards).toContain('"CHECKING_STATUS"')
    expect(page).toContain("withdrawalOutcomePending ? \"CHECKING_STATUS\" : \"FAILED\"")
    expect(page).toContain("review && !withdrawalOutcomePending")
  })
})
