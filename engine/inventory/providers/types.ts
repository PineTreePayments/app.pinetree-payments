export type InventoryConnectionStatus =
  | "AVAILABLE"
  | "REQUIRES_CONFIGURATION"
  | "CONNECTING"
  | "CONNECTED"
  | "SYNCING"
  | "ERROR"
  | "DISABLED"
  | "PLANNED"

export type ConnectionStatusResult = {
  status: InventoryConnectionStatus
  label: string
  detail: string
  canConnect: boolean
  canSync: boolean
  canDisconnect: boolean
  lastSyncAt?: string | null
}

export type ConnectionStartResult = {
  status: InventoryConnectionStatus
  authorizationUrl?: string
  message: string
}

export type InventorySyncResult = {
  created: number
  updated: number
  skipped: number
  errors: string[]
}

export type InventoryProviderAdapter = {
  provider: string
  label: string
  getConnectionStatus(merchantId: string): Promise<ConnectionStatusResult>
  startConnection?(merchantId: string): Promise<ConnectionStartResult>
  syncInventory?(merchantId: string): Promise<InventorySyncResult>
  disconnect?(merchantId: string): Promise<void>
}
