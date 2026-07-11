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
