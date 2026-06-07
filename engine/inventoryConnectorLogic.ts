import type { InventoryConnectionStatus } from "./inventory/providers/types"

export function statusForCredentialConfiguration(input: {
  requiredValues: Array<string | undefined | null>
  connected?: boolean
}): InventoryConnectionStatus {
  if (input.connected) return "CONNECTED"
  return input.requiredValues.every((value) => String(value || "").trim().length > 0)
    ? "AVAILABLE"
    : "REQUIRES_CONFIGURATION"
}

export function canRunProviderSync(status: InventoryConnectionStatus) {
  return status === "CONNECTED"
}
