import { describe, expect, it } from "vitest"
import {
  classifyWaasWalletChain,
  computeRequiredChainState,
  needsBaseRestore,
  needsExplicitBaseCreate,
  needsExplicitSolanaCreate,
  needsSolanaRestore,
} from "@/lib/wallets/dynamicChainClassification"

const evmWallet = { chain: "EVM", address: "0x1111111111111111111111111111111111111111" }
const solWallet = { chain: "SOL", address: "8pM6WgH6mYs2f6nQvC1zK8b6D3nZq1u9m8h4b3v2w1x" }
const untaggedEvmAddress = { address: "0x2222222222222222222222222222222222222222" }
const untaggedSolAddress = { address: "9pM6WgH6mYs2f6nQvC1zK8b6D3nZq1u9m8h4b3v2w1x" }

describe("classifyWaasWalletChain", () => {
  it("classifies by explicit chain field first", () => {
    expect(classifyWaasWalletChain(evmWallet)).toBe("EVM")
    expect(classifyWaasWalletChain(solWallet)).toBe("SOL")
  })

  it("falls back to address shape when chain is absent", () => {
    expect(classifyWaasWalletChain(untaggedEvmAddress)).toBe("EVM")
    expect(classifyWaasWalletChain(untaggedSolAddress)).toBe("SOL")
  })

  it("returns unknown for a wallet that matches neither shape", () => {
    expect(classifyWaasWalletChain({ chain: "BTC", address: "not-a-real-address" })).toBe("unknown")
    expect(classifyWaasWalletChain(null)).toBe("unknown")
    expect(classifyWaasWalletChain(undefined)).toBe("unknown")
  })
})

describe("computeRequiredChainState + per-chain decisions", () => {
  it("zero runtime wallets and zero credentials requires creating both chains", () => {
    const state = computeRequiredChainState({
      runtimeWallets: [],
      runtimeCredentials: [],
      hasBaseAddress: false,
      hasSolanaAddress: false,
    })
    expect(needsExplicitBaseCreate(state)).toBe(true)
    expect(needsExplicitSolanaCreate(state)).toBe(true)
    expect(needsBaseRestore(state)).toBe(false)
    expect(needsSolanaRestore(state)).toBe(false)
  })

  it("one Base runtime wallet present triggers only the Solana create - not a redundant Base create", () => {
    const state = computeRequiredChainState({
      runtimeWallets: [evmWallet],
      runtimeCredentials: [],
      hasBaseAddress: true,
      hasSolanaAddress: false,
    })
    expect(needsExplicitBaseCreate(state)).toBe(false)
    expect(needsExplicitSolanaCreate(state)).toBe(true)
  })

  it("one Solana runtime wallet present triggers only the Base create - not a redundant Solana create", () => {
    const state = computeRequiredChainState({
      runtimeWallets: [solWallet],
      runtimeCredentials: [],
      hasBaseAddress: false,
      hasSolanaAddress: true,
    })
    expect(needsExplicitBaseCreate(state)).toBe(true)
    expect(needsExplicitSolanaCreate(state)).toBe(false)
  })

  it("existing credentials with no matching runtime wallet requires a restore, never a duplicate create", () => {
    const state = computeRequiredChainState({
      runtimeWallets: [],
      runtimeCredentials: [evmWallet, solWallet],
      hasBaseAddress: false,
      hasSolanaAddress: false,
    })
    expect(needsExplicitBaseCreate(state)).toBe(false)
    expect(needsExplicitSolanaCreate(state)).toBe(false)
    expect(needsBaseRestore(state)).toBe(true)
    expect(needsSolanaRestore(state)).toBe(true)
  })

  it("both chains already present needs neither a create nor a restore", () => {
    const state = computeRequiredChainState({
      runtimeWallets: [evmWallet, solWallet],
      runtimeCredentials: [evmWallet, solWallet],
      hasBaseAddress: true,
      hasSolanaAddress: true,
    })
    expect(needsExplicitBaseCreate(state)).toBe(false)
    expect(needsExplicitSolanaCreate(state)).toBe(false)
    expect(needsBaseRestore(state)).toBe(false)
    expect(needsSolanaRestore(state)).toBe(false)
  })
})

describe("Base wallet classification does not require a connector literally named Base (Part D)", () => {
  it("accepts a generic EVM smart-wallet signer (e.g. ZeroDev-keyed) as the Base wallet, not just a connector named 'dynamicwaas'", () => {
    const zerodevSignerWallet = {
      connector: { key: "zerodev", name: "ZeroDev Smart Wallet" },
      address: "0x3333333333333333333333333333333333333333",
    }
    expect(classifyWaasWalletChain(zerodevSignerWallet)).toBe("EVM")
  })

  it("accepts Base chain ID 8453 network context without requiring the network slug to equal 'base'", () => {
    const baseNetworkWallet = {
      chain: "EVM",
      network: "eip155:8453",
      address: "0x4444444444444444444444444444444444444444",
    }
    expect(classifyWaasWalletChain(baseNetworkWallet)).toBe("EVM")
  })

  it("accepts an Ethereum-labelled EVM wallet (connector name 'Ethereum') as usable for Base", () => {
    const ethereumLabelledWallet = {
      connector: { key: "turnkeyhd", name: "Ethereum" },
      address: "0x5555555555555555555555555555555555555555",
    }
    expect(classifyWaasWalletChain(ethereumLabelledWallet)).toBe("EVM")
  })

  it("never mistakes a Solana wallet for Base", () => {
    const solanaSmartWallet = {
      connector: { key: "dynamicwaas", name: "Solana Wallet", connectedChain: "SOL" },
      address: "6pM6WgH6mYs2f6nQvC1zK8b6D3nZq1u9m8h4b3v2w1x",
    }
    expect(classifyWaasWalletChain(solanaSmartWallet)).toBe("SOL")
    expect(classifyWaasWalletChain(solanaSmartWallet)).not.toBe("EVM")
  })

  it("does not accept an unrelated external wallet with no EVM/Solana hint at all", () => {
    const unrelatedWallet = {
      connector: { key: "walletconnect", name: "Generic External Wallet" },
      address: "not-a-recognizable-address",
    }
    expect(classifyWaasWalletChain(unrelatedWallet)).toBe("unknown")
  })

  it("rejects an invalid/malformed EVM address instead of accepting it by shape alone", () => {
    const invalidAddressWallet = { address: "0xnotarealaddress" }
    expect(classifyWaasWalletChain(invalidAddressWallet)).toBe("unknown")
    const tooShort = { address: "0x1234" }
    expect(classifyWaasWalletChain(tooShort)).toBe("unknown")
  })
})

describe("needsExplicit*Create respects a broadly-detected address, not just the narrow runtime-wallet list (Part C/D)", () => {
  it("does not request another Base create when a Base address was already detected via a broader wallet search, even if the narrow runtime-wallet check missed it", () => {
    const state = computeRequiredChainState({
      runtimeWallets: [], // narrow list missed the zerodev-keyed EVM signer
      runtimeCredentials: [],
      hasBaseAddress: true, // broader dynamicNetworkAddresses search found it
      hasSolanaAddress: false,
    })
    expect(needsExplicitBaseCreate(state)).toBe(false)
  })

  it("still requests a Base create when neither credential, runtime wallet, nor address exist", () => {
    const state = computeRequiredChainState({
      runtimeWallets: [],
      runtimeCredentials: [],
      hasBaseAddress: false,
      hasSolanaAddress: false,
    })
    expect(needsExplicitBaseCreate(state)).toBe(true)
  })
})
