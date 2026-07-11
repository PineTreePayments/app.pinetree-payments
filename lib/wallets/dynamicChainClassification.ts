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

export function classifyWaasWalletChain(wallet: unknown): "EVM" | "SOL" | "unknown" {
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

// A chain needs an explicit create only when neither a restorable credential nor a
// live runtime wallet already exists for it - otherwise it needs a restore (rebuild),
// never a duplicate create.
export function needsExplicitBaseCreate(state: RequiredChainState): boolean {
  return !state.hasBaseCredential && !state.hasBaseRuntimeWallet
}

export function needsExplicitSolanaCreate(state: RequiredChainState): boolean {
  return !state.hasSolanaCredential && !state.hasSolanaRuntimeWallet
}

export function needsBaseRestore(state: RequiredChainState): boolean {
  return state.hasBaseCredential && !state.hasBaseRuntimeWallet
}

export function needsSolanaRestore(state: RequiredChainState): boolean {
  return state.hasSolanaCredential && !state.hasSolanaRuntimeWallet
}
