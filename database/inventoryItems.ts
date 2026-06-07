import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const db = supabaseAdmin || supabaseAnon

export type InventoryItemStatus = "ACTIVE" | "ARCHIVED"
export type InventoryMovementType =
  | "CREATE"
  | "ADJUST"
  | "SALE"
  | "RETURN"
  | "ARCHIVE"
  | "RESTORE"
  | "IMPORT"
  | "SYNC"
export type InventoryIntegrationStatus =
  | "PLANNED"
  | "AVAILABLE"
  | "CONNECTED"
  | "ERROR"
  | "DISABLED"

export type InventoryItem = {
  id: string
  merchant_id: string
  name: string
  sku: string | null
  category: string | null
  price: number
  cost: number | null
  quantity: number
  low_stock_threshold: number
  status: InventoryItemStatus
  image_url: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type InventoryItemInput = {
  name: string
  sku?: string | null
  category?: string | null
  price: number
  cost?: number | null
  quantity: number
  low_stock_threshold: number
}

export type InventoryMovement = {
  id: string
  merchant_id: string
  item_id: string
  type: InventoryMovementType
  quantity_delta: number
  reason: string | null
  metadata: Record<string, unknown>
  created_at: string
}

export type InventoryIntegration = {
  id?: string
  merchant_id: string
  provider: string
  status: InventoryIntegrationStatus
  last_sync_at: string | null
  metadata: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

function isMissingInventoryTable(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes("inventory_items") &&
    (normalized.includes("schema cache") || normalized.includes("does not exist"))
}

export async function listInventoryItems(merchantId: string): Promise<{
  available: boolean
  items: InventoryItem[]
}> {
  const { data, error } = await db
    .from("inventory_items")
    .select("*")
    .eq("merchant_id", merchantId)
    .order("updated_at", { ascending: false })

  if (error) {
    if (isMissingInventoryTable(error.message)) return { available: false, items: [] }
    throw new Error(`Failed to load inventory: ${error.message}`)
  }

  return { available: true, items: (data || []) as InventoryItem[] }
}

export async function createInventoryItem(
  merchantId: string,
  input: InventoryItemInput
): Promise<InventoryItem> {
  const { data, error } = await db
    .from("inventory_items")
    .insert({
      merchant_id: merchantId,
      name: input.name,
      sku: input.sku || null,
      category: input.category || null,
      price: input.price,
      cost: input.cost ?? null,
      quantity: input.quantity,
      low_stock_threshold: input.low_stock_threshold,
      status: "ACTIVE"
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create inventory item: ${error.message}`)
  return data as InventoryItem
}

export async function updateInventoryItem(
  merchantId: string,
  itemId: string,
  input: Partial<InventoryItemInput> & { status?: InventoryItemStatus }
): Promise<InventoryItem> {
  const { data, error } = await db
    .from("inventory_items")
    .update({
      ...input,
      updated_at: new Date().toISOString()
    })
    .eq("id", itemId)
    .eq("merchant_id", merchantId)
    .select()
    .single()

  if (error) throw new Error(`Failed to update inventory item: ${error.message}`)
  return data as InventoryItem
}

export async function createInventoryMovement(
  merchantId: string,
  itemId: string,
  type: InventoryMovementType,
  quantityDelta: number,
  reason?: string | null,
  metadata: Record<string, unknown> = {}
): Promise<InventoryMovement> {
  const { data, error } = await db
    .from("inventory_movements")
    .insert({
      merchant_id: merchantId,
      item_id: itemId,
      type,
      quantity_delta: quantityDelta,
      reason: reason || null,
      metadata
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to record inventory movement: ${error.message}`)
  return data as InventoryMovement
}

export async function listInventoryMovements(
  merchantId: string,
  limit = 50
): Promise<{ available: boolean; movements: InventoryMovement[] }> {
  const { data, error } = await db
    .from("inventory_movements")
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    const normalized = error.message.toLowerCase()
    if (normalized.includes("inventory_movements") &&
      (normalized.includes("schema cache") || normalized.includes("does not exist"))) {
      return { available: false, movements: [] }
    }
    throw new Error(`Failed to load inventory movements: ${error.message}`)
  }

  return { available: true, movements: (data || []) as InventoryMovement[] }
}

export async function listInventoryIntegrations(
  merchantId: string
): Promise<{ available: boolean; integrations: InventoryIntegration[] }> {
  const { data, error } = await db
    .from("inventory_integrations")
    .select("*")
    .eq("merchant_id", merchantId)
    .order("provider")

  if (error) {
    const normalized = error.message.toLowerCase()
    if (normalized.includes("inventory_integrations") &&
      (normalized.includes("schema cache") || normalized.includes("does not exist"))) {
      return { available: false, integrations: [] }
    }
    throw new Error(`Failed to load inventory integrations: ${error.message}`)
  }

  return { available: true, integrations: (data || []) as InventoryIntegration[] }
}
