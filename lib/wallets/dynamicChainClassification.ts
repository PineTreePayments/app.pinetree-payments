import { classifyDynamicWalletChain, type DynamicWalletLike } from "@/lib/wallets/dynamicSignerLookup"

// Pure helper for deciding whether a Dynamic WaaS wallet/credential belongs to the
// Base (EVM) or Solana (SOL) required chain. Extracted so the required-chain gap
// detection in app/dashboard/wallet-setup/page.tsx (which chain is missing after a
// hydration attempt) can be unit tested without rendering the page component.
export type DynamicWaasChainLike = {
  chain?: string | null
  address?: string | null
}

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/
const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

// A Base/EVM embedded wallet does not require its connector to be literally named
// "Base" or its `chain` field to equal the literal string "EVM" - a smart-wallet
// signer (e.g. a ZeroDev-keyed account) is still a genuine EVM wallet capable of
// operating on Base. classifyDynamicWalletChain (already used for withdrawal signer
// lookup elsewhere in the app) recognizes connector/network hints across many more
// shapes than a bare `chain`/`address` check, so it is tried first; the narrower
// address-shape check below is only a fallback for a bare credential row with no
// connector metadata at all (e.g. a raw verifiedCredential).
export function classifyWaasWalletChain(wallet: unknown): "EVM" | "SOL" | "unknown" {
  const broad = classifyDynamicWalletChain((wallet ?? {}) as DynamicWalletLike)
  if (broad === "evm") return "EVM"
  if (broad === "solana") return "SOL"

  const wl = wallet as DynamicWaasChainLike | null | undefined
  if (wl?.chain === "EVM" || EVM_ADDRESS_PATTERN.test(String(wl?.address ?? ""))) return "EVM"
  if (wl?.chain === "SOL" || SOLANA_ADDRESS_PATTERN.test(String(wl?.address ?? ""))) return "SOL"
  return "unknown"
}

export type RequiredChainState = {
  hasBaseCredential: boolean
  hasSolanaCredential: boolean
  hasBaseRuntimeWallet: boolean
  hasSolanaRuntimeWallet: boolean
  hasBaseAddress: boolean
  hasSolanaAddress: boolean
}

export function computeRequiredChainState(input: {
  runtimeWallets: unknown[]
  runtimeCredentials: unknown[]
  hasBaseAddress: boolean
  hasSolanaAddress: boolean
}): RequiredChainState {
  return {
    hasBaseCredential: input.runtimeCredentials.some((c) => classifyWaasWalletChain(c) === "EVM"),
    hasSolanaCredential: input.runtimeCredentials.some((c) => classifyWaasWalletChain(c) === "SOL"),
    hasBaseRuntimeWallet: input.runtimeWallets.some((w) => classifyWaasWalletChain(w) === "EVM"),
    hasSolanaRuntimeWallet: input.runtimeWallets.some((w) => classifyWaasWalletChain(w) === "SOL"),
    hasBaseAddress: input.hasBaseAddress,
    hasSolanaAddress: input.hasSolanaAddress,
  }
}

// A chain needs an explicit create only when neither a restorable credential, a live
// runtime wallet, nor an already-detected address exists for it - otherwise it needs a
// restore (rebuild) or nothing at all, never a duplicate create. hasBaseAddress in
// particular comes from a broader wallet search than hasBaseRuntimeWallet, so it can be
// true even when the narrower runtime-wallet check missed a genuine EVM signer wallet.
export function needsExplicitBaseCreate(state: RequiredChainState): boolean {
  return !state.hasBaseCredential && !state.hasBaseRuntimeWallet && !state.hasBaseAddress
}

export function needsExplicitSolanaCreate(state: RequiredChainState): boolean {
  return !state.hasSolanaCredential && !state.hasSolanaRuntimeWallet && !state.hasSolanaAddress
}

export function needsBaseRestore(state: RequiredChainState): boolean {
  return state.hasBaseCredential && !state.hasBaseRuntimeWallet
}

export function needsSolanaRestore(state: RequiredChainState): boolean {
  return state.hasSolanaCredential && !state.hasSolanaRuntimeWallet
}
