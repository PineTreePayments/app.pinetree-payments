import { NextRequest } from "next/server"
import { beginShift4HostedCheckout } from "@/engine/shift4/hostedCheckout"
import { requireMerchantIdFromRequest } from "@/lib/api/merchantAuth"
import { readJsonObject, requiredString, shift4Error, shift4Success } from "@/lib/api/shift4Routes"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(request, "checkout.sessions:create")
    const body = await readJsonObject(request)
    const result = await beginShift4HostedCheckout({
      merchantId,
      paymentId: requiredString(body, "paymentId"),
      merchantProviderConnectionId: requiredString(body, "merchantProviderConnectionId"),
    })
    return shift4Success(result, 201)
  } catch (error) {
    return shift4Error(error, "Unable to start Shift4 tokenization")
  }
}
