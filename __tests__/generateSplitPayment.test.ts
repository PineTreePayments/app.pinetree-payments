import { Interface } from "ethers"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,test")
  }
}))

vi.mock("@/engine/marketPrices", () => ({
  getMarketPricesUSD: vi.fn().mockResolvedValue({
    ETH: 1665.82,
    SOL: 150
  })
}))

vi.mock("@/engine/config", () => ({
  getBaseV7Contract: vi.fn(
    () => "0x96484a59b0Aa16E4F95F0899B592F76a6A192c29"
  )
}))

import { generateSplitPayment } from "@/engine/generateSplitPayment"

const splitEthInterface = new Interface([
  "function splitEth(address merchant, address treasury, uint256 merchantAmountWei, uint256 feeAmountWei, string paymentRef) payable"
])

describe("generateSplitPayment Base ETH", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.pinetree-payments.com"
  })

  it("sets msg.value to the exact sum of the encoded V7 split legs", async () => {
    const result = await generateSplitPayment({
      merchantWallet: "0xa9a6651e6fe65f3fe28e6467741e79d5c574b7a0",
      merchantAmount: 0.109,
      pinetreeWallet: "0xDfB2EB3FccB76B8C7f7e352d5421654add5a7903",
      pinetreeFee: 0.15,
      network: "base",
      asset: "eth-base",
      paymentId: "786fedef-24d9-430d-a290-aca0103b9402"
    })

    const query = result.paymentUrl.split("?")[1]
    const params = new URLSearchParams(query)
    const decoded = splitEthInterface.decodeFunctionData(
      "splitEth",
      String(params.get("data"))
    )

    expect(BigInt(String(params.get("value")))).toBe(
      BigInt(decoded.merchantAmountWei) + BigInt(decoded.feeAmountWei)
    )
  })
})
