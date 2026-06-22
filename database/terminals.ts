import { supabase, supabaseAdmin } from './supabase'

const db = supabaseAdmin || supabase

export interface Terminal {
  id: string
  merchant_id: string
  name: string
  pin: string
  autolock?: string
  status?: string
  tax_mode?: "none" | "merchant_default" | "custom"
  tax_rate?: number | null
  tax_label?: string
  created_at?: Date
}

export async function getTerminalById(id: string): Promise<Terminal | null> {
  const { data, error } = await db
    .from('terminals')
    .select()
    .eq('id', id)
    .single()

  if (error) return null
  return data
}

export async function getTerminalsByMerchantId(merchantId: string): Promise<Terminal[]> {
  const { data, error } = await db
    .from('terminals')
    .select()
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to fetch terminals: ${error.message}`)
  return data || []
}

export async function createTerminal(input: Omit<Terminal, 'id' | 'created_at'>): Promise<Terminal> {
  const { data, error } = await db
    .from('terminals')
    .insert(input)
    .select()
    .single()

  if (error) throw new Error(`Failed to create terminal: ${error.message}`)
  return data
}

export async function updateTerminal(id: string, input: Partial<Terminal>): Promise<Terminal> {
  const { data, error } = await db
    .from('terminals')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to update terminal: ${error.message}`)
  return data
}

export async function verifyTerminalPin(id: string, pin: string): Promise<boolean> {
  const { data, error } = await db
    .from('terminals')
    .select('pin')
    .eq('id', id)
    .single()

  if (error) return false
  return data.pin === pin
}

export async function deleteTerminal(id: string): Promise<void> {
  const { error } = await db
    .from('terminals')
    .delete()
    .eq('id', id)

  if (error) throw new Error(`Failed to delete terminal: ${error.message}`)
}
