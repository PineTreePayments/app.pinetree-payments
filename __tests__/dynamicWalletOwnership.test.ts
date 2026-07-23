import { describe, expect, it } from "vitest"
import { resolveDynamicWalletOwnership } from "@/lib/wallets/dynamicWalletOwnership"

describe("resolveDynamicWalletOwnership", () => {
  it("reports a stored Dynamic owner mismatch without exposing full ids or addresses", () => {
    const result = resolveDynamicWalletOwnership({
      pineTreeMerchantId: "merchant-1",
      currentDynamicUserId: "dynamic-current-509436",
      storedDynamicUserId: "dynamic-original-123456",
      externalUserId: "merchant-1",
      authenticated: true,
      walletCount: 1,
      storedWalletAddresses: ["0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD"],
      hydratedWalletAddresses: ["0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD"],
    })

    expect(result).toMatchObject({
      currentDynamicUserIdSuffix: "509436",
      storedDynamicUserIdSuffix: "123456",
      identityMatch: false,
      failureReason: "DYNAMIC_IDENTITY_MISMATCH",
      storedWalletAddresses: ["0xABCD...efABCD"],
      hydratedWalletAddresses: ["0xABCD...efABCD"],
    })
  })

  it("treats zero hydrated wallets with stored addresses as a hydration-timing signal, not an identity mismatch", () => {
    const result = resolveDynamicWalletOwnership({
      pineTreeMerchantId: "merchant-1",
      currentDynamicUserId: "dynamic-current-509436",
      storedDynamicUserId: null,
      externalUserId: "merchant-1",
      authenticated: true,
      sdkLoaded: true,
      walletCount: 0,
      storedWalletAddresses: ["StoredSolana111111111111111111111111111111"],
      hydratedWalletAddresses: [],
    })

    expect(result.identityMatch).toBe(false)
    expect(result.failureReason).toBe("DYNAMIC_WALLETS_HYDRATING")
  })

  it("reproduces the production incident: stored dynamic_user_id equal to merchant_id + walletCount 0 is hydration-pending, not a mismatch", () => {
    // Matches the observed production log: resolved/current Dynamic user id
    // suffix 509436, stored dynamic_user_id suffix cb81fc (== merchant_id
    // suffix), walletCount: 0 at DYNAMIC_AUTH_RESTORED/DYNAMIC_USER_RESOLVED.
    const result = resolveDynamicWalletOwnership({
      pineTreeMerchantId: "18215ad9-c587-4be5-baf4-6bef03cb81fc",
      currentDynamicUserId: "dynamic-user-509436",
      storedDynamicUserId: "18215ad9-c587-4be5-baf4-6bef03cb81fc",
      externalUserId: "18215ad9-c587-4be5-baf4-6bef03cb81fc",
      authenticated: true,
      sdkLoaded: true,
      walletCount: 0,
      storedWalletAddresses: ["StoredSolana111111111111111111111111111111"],
      hydratedWalletAddresses: [],
    })

    expect(result.failureReason).toBe("DYNAMIC_WALLETS_HYDRATING")
    expect(result.failureReason).not.toBe("DYNAMIC_IDENTITY_MISMATCH")
  })

  it("treats an SDK that has not finished loading as hydration-pending even with walletCount 0 and no stored addresses", () => {
    const result = resolveDynamicWalletOwnership({
      pineTreeMerchantId: "merchant-1",
      currentDynamicUserId: "dynamic-current-509436",
      storedDynamicUserId: null,
      externalUserId: "merchant-1",
      authenticated: true,
      sdkLoaded: false,
      walletCount: 0,
      storedWalletAddresses: [],
      hydratedWalletAddresses: [],
    })

    expect(result.failureReason).toBe("DYNAMIC_WALLETS_HYDRATING")
  })

  it("still reports a genuine identity mismatch when a different stored owner's addresses don't match hydrated wallets", () => {
    const result = resolveDynamicWalletOwnership({
      pineTreeMerchantId: "merchant-1",
      currentDynamicUserId: "dynamic-current-509436",
      storedDynamicUserId: null,
      externalUserId: "merchant-1",
      authenticated: true,
      sdkLoaded: true,
      walletCount: 1,
      storedWalletAddresses: ["StoredSolana111111111111111111111111111111"],
      hydratedWalletAddresses: ["DifferentSolanaAddress2222222222222222222222"],
    })

    expect(result.identityMatch).toBe(false)
    expect(result.failureReason).toBe("DYNAMIC_IDENTITY_MISMATCH")
  })

  it("allows profiles where dynamic_user_id temporarily stored the PineTree external subject if hydrated wallets match", () => {
    const result = resolveDynamicWalletOwnership({
      pineTreeMerchantId: "merchant-1",
      currentDynamicUserId: "dynamic-owner-123456",
      storedDynamicUserId: "merchant-1",
      externalUserId: "merchant-1",
      authenticated: true,
      walletCount: 2,
      storedWalletAddresses: [
        "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
        "StoredSolana111111111111111111111111111111",
      ],
      hydratedWalletAddresses: [
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        "StoredSolana111111111111111111111111111111",
      ],
    })

    expect(result.identityMatch).toBe(true)
    expect(result.failureReason).toBeNull()
  })
})
