import { NextRequest } from "next/server"
import { verifyMerchantApiKey, type ApiKeyPermission } from "@/engine/merchantApiKeys"
import { V1ApiError } from "./errors"

/**
 * Public v1 routes intentionally accept merchant API keys only. Dashboard JWTs
 * continue to use the existing unversioned dashboard routes.
 */
export async function requireV1MerchantApiKey(
  req: NextRequest,
  requiredPermission: ApiKeyPermission
) {
  return requireV1MerchantApiKeyWithAnyPermission(req, [requiredPermission])
}

export async function requireV1MerchantApiKeyWithAnyPermission(
  req: NextRequest,
  acceptedPermissions: ApiKeyPermission[]
) {
  const authHeader = req.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""

  if (!token) {
    throw new V1ApiError({
      status: 401,
      type: "authentication_error",
      code: "missing_api_key",
      message: "A PineTree API key is required.",
    })
  }

  // PineTree issues one key format: pt_live_<64-hex>. No pt_test_* variant exists.
  if (!token.startsWith("pt_live_")) {
    throw new V1ApiError({
      status: 401,
      type: "authentication_error",
      code: "invalid_api_key",
      message: "The provided API key is invalid.",
    })
  }

  const verified = await verifyMerchantApiKey(token)
  if (!verified) {
    throw new V1ApiError({
      status: 401,
      type: "authentication_error",
      code: "invalid_api_key",
      message: "The provided API key is invalid or revoked.",
    })
  }

  if (!acceptedPermissions.some((permission) => verified.permissions.includes(permission))) {
    const required = acceptedPermissions.join(" or ")
    throw new V1ApiError({
      status: 403,
      type: "authorization_error",
      code: "missing_permission",
      message: `The API key requires the ${required} permission.`,
    })
  }

  return verified
}
