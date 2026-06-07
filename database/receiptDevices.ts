import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const db = supabaseAdmin || supabaseAnon

export type ReceiptDevice = {
  id?: string
  merchant_id: string
  label: string
  type: "BROWSER_PRINT" | "TERMINAL_PRINT" | "NETWORK_PRINTER" | "PROVIDER_PRINTER"
  provider: string | null
  status: "AVAILABLE" | "REQUIRES_CONFIGURATION" | "CONNECTED" | "ERROR" | "DISABLED"
  metadata: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

export async function listReceiptDevices(merchantId: string) {
  const { data, error } = await db
    .from("merchant_receipt_devices")
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at")

  if (error) {
    const normalized = error.message.toLowerCase()
    if (normalized.includes("schema cache") || normalized.includes("does not exist")) {
      return { available: false, devices: [] as ReceiptDevice[] }
    }
    throw new Error(`Failed to load receipt devices: ${error.message}`)
  }
  return { available: true, devices: (data || []) as ReceiptDevice[] }
}

export async function ensureDefaultReceiptDevices(merchantId: string) {
  const defaults = [
    {
      merchant_id: merchantId,
      label: "Browser Print / PDF",
      type: "BROWSER_PRINT",
      provider: "browser",
      status: "AVAILABLE"
    },
    {
      merchant_id: merchantId,
      label: "Shift4 / SkyTab Terminal Print",
      type: "PROVIDER_PRINTER",
      provider: "shift4",
      status: "REQUIRES_CONFIGURATION"
    },
    {
      merchant_id: merchantId,
      label: "Clover Terminal Print",
      type: "PROVIDER_PRINTER",
      provider: "clover",
      status: "REQUIRES_CONFIGURATION"
    },
    {
      merchant_id: merchantId,
      label: "Square Terminal Print",
      type: "PROVIDER_PRINTER",
      provider: "square",
      status: "REQUIRES_CONFIGURATION"
    }
  ] satisfies Array<Pick<ReceiptDevice, "merchant_id" | "label" | "type" | "provider" | "status">>

  const { error } = await db
    .from("merchant_receipt_devices")
    .upsert(defaults.map((device) => ({
      ...device,
      metadata: {},
      updated_at: new Date().toISOString()
    })), { onConflict: "merchant_id,type,provider" })

  if (error) throw new Error(`Failed to initialize receipt devices: ${error.message}`)
}
