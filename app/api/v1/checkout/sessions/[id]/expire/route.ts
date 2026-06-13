import { NextRequest } from "next/server"
import { handleCheckoutSessionLifecycle } from "@/lib/api/v1/checkoutSessionLifecycle"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleCheckoutSessionLifecycle(req, params, "expired")
}
