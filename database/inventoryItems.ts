import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const db = supabaseAdmin || supabaseAnon

export type InventoryItemStatus = "ACTIVE" | "ARCHIVED"

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
