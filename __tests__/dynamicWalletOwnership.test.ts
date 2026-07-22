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

  it("treats zero hydrated wallets with stored addresses as an identity mismatch, not a signable state", () => {
    const result = resolveDynamicWalletOwnership({
      pineTreeMerchantId: "merchant-1",
      currentDynamicUserId: "dynamic-current-509436",
      storedDynamicUserId: null,
      externalUserId: "merchant-1",
      authenticated: true,
      walletCount: 0,
      storedWalletAddresses: ["StoredSolana111111111111111111111111111111"],
      hydratedWalletAddresses: [],
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
