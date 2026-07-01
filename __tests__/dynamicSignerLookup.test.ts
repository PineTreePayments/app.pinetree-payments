import { describe, expect, it, vi } from "vitest"
import {
  dynamicWalletSupportsRail,
  findDynamicApprovalWalletForSource,
  findDynamicWalletForSource,
  getDynamicWalletSearchList,
} from "@/lib/wallets/dynamicSignerLookup"

describe("Dynamic signer lookup", () => {
  it("searches primaryWallet before all Dynamic wallets", () => {
    const primary = { address: "primary", getWalletClient: vi.fn() }
    const secondary = { address: "secondary", getWalletClient: vi.fn() }

    expect(getDynamicWalletSearchList([secondary, primary], primary)).toEqual([primary, secondary])
  })

  it("matches Solana wallets by exact address after reconnect", () => {
    const solanaWallet = {
      address: "SoLExact111111111111111111111111111111111",
      signAndSendTransaction: vi.fn(),
    }

    expect(findDynamicApprovalWalletForSource(
      [],
      solanaWallet,
      "solana",
      "SoLExact111111111111111111111111111111111"
    )).toBe(solanaWallet)
    expect(findDynamicWalletForSource(
      [solanaWallet],
      null,
      "solexact111111111111111111111111111111111",
      "solana"
    )).toBeNull()
  })

  it("matches Base/EVM wallets case-insensitively after reconnect", () => {
    const baseWallet = {
      address: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
      getWalletClient: vi.fn(),
    }

    expect(findDynamicApprovalWalletForSource(
      [baseWallet],
      null,
      "base",
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
    )).toBe(baseWallet)
  })

  it("searches embedded additional addresses for Solana and Base signers", () => {
    const embeddedWallet = {
      address: "0xprimary000000000000000000000000000000000",
      additionalAddresses: [
        { address: "SolanaEmbedded1111111111111111111111111111" },
        { address: "0x9999999999999999999999999999999999999999" },
      ],
      signAndSendTransaction: vi.fn(),
      getWalletClient: vi.fn(),
    }

    expect(findDynamicApprovalWalletForSource(
      [],
      embeddedWallet,
      "solana",
      "SolanaEmbedded1111111111111111111111111111"
    )).toBe(embeddedWallet)
    expect(findDynamicApprovalWalletForSource(
      [],
      embeddedWallet,
      "base",
      "0x9999999999999999999999999999999999999999"
    )).toBe(embeddedWallet)
  })

  it("requires the matching wallet to expose the rail signer method", () => {
    const addressOnly = { address: "0x1234567890abcdef1234567890abcdef12345678" }

    expect(dynamicWalletSupportsRail(addressOnly, "base")).toBe(false)
    expect(findDynamicApprovalWalletForSource(
      [addressOnly],
      null,
      "base",
      "0x1234567890abcdef1234567890abcdef12345678"
    )).toBeNull()
  })
})
