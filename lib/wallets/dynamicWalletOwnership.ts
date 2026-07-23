export type DynamicWalletOwnershipFailureReason =
  | "DYNAMIC_NOT_AUTHENTICATED"
  | "DYNAMIC_USER_NOT_FOUND"
  | "DYNAMIC_IDENTITY_MISMATCH"
  | "DYNAMIC_WALLETS_MISSING"
  | "DYNAMIC_WALLETS_HYDRATING"
  | "DYNAMIC_ENVIRONMENT_MISMATCH"

export type DynamicWalletOwnershipResolution = {
  pineTreeMerchantId: string | null
  currentDynamicUserIdSuffix: string | null
  storedDynamicUserIdSuffix: string | null
  walletCount: number
  storedWalletAddresses: string[]
  hydratedWalletAddresses: string[]
  identityMatch: boolean
  failureReason: DynamicWalletOwnershipFailureReason | null
}

function normalized(value: unknown) {
  return String(value || "").trim()
}

function suffix(value: unknown) {
  const text = normalized(value)
  return text ? text.slice(-6) : null
}

function maskAddress(value: unknown) {
  const text = normalized(value)
  if (!text) return null
  if (text.length <= 12) return text
  return `${text.slice(0, 6)}...${text.slice(-6)}`
}

function sameAddress(a: string, b: string) {
  const left = normalized(a)
  const right = normalized(b)
  if (!left || !right) return false
  return left.startsWith("0x") || right.startsWith("0x")
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

export function resolveDynamicWalletOwnership(input: {
  pineTreeMerchantId?: string | null
  currentDynamicUserId?: string | null
  storedDynamicUserId?: string | null
  externalUserId?: string | null
  authenticated?: boolean
  sdkLoaded?: boolean
  walletCount?: number
  storedWalletAddresses?: Array<string | null | undefined>
  hydratedWalletAddresses?: Array<string | null | undefined>
  expectedEnvironmentId?: string | null
  currentEnvironmentId?: string | null
}): DynamicWalletOwnershipResolution {
  const currentDynamicUserId = normalized(input.currentDynamicUserId)
  const storedDynamicUserId = normalized(input.storedDynamicUserId)
  const externalUserId = normalized(input.externalUserId)
  const walletCount = Math.max(0, Math.trunc(Number(input.walletCount || 0)))
  const storedAddresses = (input.storedWalletAddresses || []).map(normalized).filter(Boolean)
  const hydratedAddresses = (input.hydratedWalletAddresses || []).map(normalized).filter(Boolean)
  const storedDynamicIdIsExternalSubject = Boolean(storedDynamicUserId && externalUserId && storedDynamicUserId === externalUserId)
  const storedDynamicIdMatchesCurrent = Boolean(storedDynamicUserId && currentDynamicUserId && storedDynamicUserId === currentDynamicUserId)
  const storedAddressesMatchHydrated = storedAddresses.length === 0 || storedAddresses.every((stored) =>
    hydratedAddresses.some((hydrated) => sameAddress(stored, hydrated))
  )
  const expectedEnvironmentId = normalized(input.expectedEnvironmentId)
  const currentEnvironmentId = normalized(input.currentEnvironmentId)

  let failureReason: DynamicWalletOwnershipFailureReason | null = null
  if (!input.authenticated) {
    failureReason = "DYNAMIC_NOT_AUTHENTICATED"
  } else if (!currentDynamicUserId) {
    failureReason = "DYNAMIC_USER_NOT_FOUND"
  } else if (expectedEnvironmentId && currentEnvironmentId && expectedEnvironmentId !== currentEnvironmentId) {
    failureReason = "DYNAMIC_ENVIRONMENT_MISMATCH"
  } else if (storedDynamicUserId && !storedDynamicIdIsExternalSubject && !storedDynamicIdMatchesCurrent) {
    failureReason = "DYNAMIC_IDENTITY_MISMATCH"
  } else if (walletCount === 0 && (input.sdkLoaded === false || storedAddresses.length > 0)) {
    // An empty wallet list right after auth restoration is a hydration-timing
    // signal, not proof of a different owner - the SDK has not necessarily
    // finished loading this session's wallets yet. Callers should retry
    // (bounded) rather than treat this the same as a real identity mismatch.
    failureReason = "DYNAMIC_WALLETS_HYDRATING"
  } else if (storedAddresses.length > 0 && !storedAddressesMatchHydrated) {
    failureReason = "DYNAMIC_IDENTITY_MISMATCH"
  } else if (walletCount === 0) {
    failureReason = "DYNAMIC_WALLETS_MISSING"
  }

  return {
    pineTreeMerchantId: normalized(input.pineTreeMerchantId) || null,
    currentDynamicUserIdSuffix: suffix(currentDynamicUserId),
    storedDynamicUserIdSuffix: suffix(storedDynamicUserId),
    walletCount,
    storedWalletAddresses: storedAddresses.map(maskAddress).filter(Boolean) as string[],
    hydratedWalletAddresses: hydratedAddresses.map(maskAddress).filter(Boolean) as string[],
    identityMatch: failureReason === null,
    failureReason,
  }
}
