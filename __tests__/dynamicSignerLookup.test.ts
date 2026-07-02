import { describe, expect, it, vi } from "vitest"
import {
  dynamicWalletSupportsRail,
  findDynamicApprovalWalletForSource,
  findDynamicWalletForSource,
  getDynamicWalletSearchList,
  signDynamicSolanaTransactionWithActiveAccount,
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

  it("signs with a Solana wallet address and passes the active account", async () => {
    const signAndSendTransaction = vi.fn().mockResolvedValue({ signature: "sig-address" })
    const wallet = {
      address: "SolanaAddress111111111111111111111111111111",
      signAndSendTransaction,
    }

    await expect(signDynamicSolanaTransactionWithActiveAccount(
      wallet,
      "tx",
      "SolanaAddress111111111111111111111111111111"
    )).resolves.toMatchObject({ txHash: "sig-address" })
    expect(signAndSendTransaction).toHaveBeenCalledWith(
      "tx",
      expect.objectContaining({ accountAddress: "SolanaAddress111111111111111111111111111111" })
    )
  })

  it("signs with a Solana wallet publicKey", async () => {
    const signAndSendTransaction = vi.fn().mockResolvedValue({ signature: "sig-public-key" })
    const wallet = {
      publicKey: { toBase58: () => "SolanaPublicKey111111111111111111111111111" },
      signAndSendTransaction,
    }

    await expect(signDynamicSolanaTransactionWithActiveAccount(
      wallet,
      "tx",
      "SolanaPublicKey111111111111111111111111111"
    )).resolves.toMatchObject({ txHash: "sig-public-key" })
  })

  it("signs with a Solana connector activeAccount", async () => {
    const signAndSendTransaction = vi.fn().mockResolvedValue("sig-active-account")
    const wallet = {
      connector: {
        activeAccount: { address: "SolanaActive11111111111111111111111111111" },
        signAndSendTransaction,
      },
    }

    await expect(signDynamicSolanaTransactionWithActiveAccount(
      wallet,
      "tx",
      "SolanaActive11111111111111111111111111111"
    )).resolves.toMatchObject({ txHash: "sig-active-account" })
    expect(signAndSendTransaction).toHaveBeenCalledWith(
      "tx",
      expect.objectContaining({ accountAddress: "SolanaActive11111111111111111111111111111" })
    )
  })

  it("signs with a Solana connector getPublicKey", async () => {
    const signAndSendTransaction = vi.fn().mockResolvedValue({ signature: "sig-get-public-key" })
    const wallet = {
      connector: {
        getPublicKey: vi.fn().mockResolvedValue({ toBase58: () => "SolanaGetPublicKey11111111111111111111111" }),
        signAndSendTransaction,
      },
    }

    await expect(signDynamicSolanaTransactionWithActiveAccount(
      wallet,
      "tx",
      "SolanaGetPublicKey11111111111111111111111"
    )).resolves.toMatchObject({ txHash: "sig-get-public-key" })
  })

  it("blocks Solana signing when the active account does not match the prepared source", async () => {
    const signAndSendTransaction = vi.fn().mockResolvedValue({ signature: "sig" })
    const wallet = {
      address: "SolanaActual111111111111111111111111111111",
      signAndSendTransaction,
    }

    await expect(signDynamicSolanaTransactionWithActiveAccount(
      wallet,
      "tx",
      "SolanaSource111111111111111111111111111111"
    )).rejects.toThrow("Dynamic Solana wallet active account does not match the PineTree Wallet source address.")
    expect(signAndSendTransaction).not.toHaveBeenCalled()
  })

  it("returns a clear error when no Solana active account address is available", async () => {
    const signAndSendTransaction = vi.fn().mockResolvedValue({ signature: "sig" })

    await expect(signDynamicSolanaTransactionWithActiveAccount(
      { signAndSendTransaction },
      "tx",
      "SolanaSource111111111111111111111111111111"
    )).rejects.toThrow("Dynamic Solana wallet is connected, but no active Solana account address was available.")
    expect(signAndSendTransaction).not.toHaveBeenCalled()
  })

  it("activates Dynamic WaaS SVM by account address before signing", async () => {
    const getWalletClientByAddress = vi.fn()
    const signAndSendTransaction = vi.fn().mockResolvedValue("sig-waas")
    const wallet = {
      address: "SolanaWaas11111111111111111111111111111111",
      connector: {
        getWalletClientByAddress,
        signAndSendTransaction,
      },
    }

    await expect(signDynamicSolanaTransactionWithActiveAccount(
      wallet,
      "tx",
      "SolanaWaas11111111111111111111111111111111"
    )).resolves.toMatchObject({ txHash: "sig-waas" })
    expect(getWalletClientByAddress).toHaveBeenCalledWith({
      accountAddress: "SolanaWaas11111111111111111111111111111111",
    })
  })
})
