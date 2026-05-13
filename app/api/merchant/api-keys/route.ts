import { NextRequest, NextResponse } from "next/server"
import { requireMerchantIdFromRequest, getRouteErrorStatus } from "@/lib/api/merchantAuth"
import { createMerchantApiKey, listMerchantApiKeys, type ApiKeyPermission } from "@/engine/merchantApiKeys"

export async function GET(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const keys = await listMerchantApiKeys(merchantId)
    return NextResponse.json({ keys })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch API keys" },
      { status: getRouteErrorStatus(error) }
    )
  }
}

type CreateKeyBody = {
  name?: string
  permissions?: string[]
}

export async function POST(req: NextRequest) {
  try {
    const merchantId = await requireMerchantIdFromRequest(req)
    const body = (await req.json()) as CreateKeyBody

    const validPermissions: ApiKeyPermission[] = [
      "checkout.sessions:create",
      "checkout.links:create",
      "webhooks:read",
      "webhooks:write",
    ]

    const permissions =
      Array.isArray(body.permissions)
        ? (body.permissions.filter((p) =>
            validPermissions.includes(p as ApiKeyPermission)
          ) as ApiKeyPermission[])
        : undefined

    const key = await createMerchantApiKey({
      merchantId,
      name: body.name,
      permissions,
    })

    return NextResponse.json({ key }, { status: 201 })
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create API key" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
