import { supabase } from './supabase'
import type { Database } from '@/types/database'

type LedgerEntry = Database['public']['Tables']['ledger_entries']['Row']
type LedgerEntryInsert = Database['public']['Tables']['ledger_entries']['Insert']
type LedgerEntryUpdate = Database['public']['Tables']['ledger_entries']['Update']

export async function createLedgerEntry(input: LedgerEntryInsert): Promise<LedgerEntry> {
  const { data, error } = await supabase
    .from('ledger_entries')
    .insert(input)
    .select()
    .single()

  if (error) throw new Error(`Failed to create ledger entry: ${error.message}`)
  return data
}

export async function getLedgerEntryById(id: string): Promise<LedgerEntry | null> {
  const { data, error } = await supabase
    .from('ledger_entries')
    .select()
    .eq('id', id)
    .single()

  if (error) return null
  return data
}

export async function getLedgerEntriesByPaymentId(paymentId: string): Promise<LedgerEntry[]> {
  const { data, error } = await supabase
    .from('ledger_entries')
    .select()
    .eq('payment_id', paymentId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to fetch ledger entries: ${error.message}`)
  return data || []
}

export async function getLedgerEntriesByMerchantId(merchantId: string, limit = 100): Promise<LedgerEntry[]> {
  const { data, error } = await supabase
    .from('ledger_entries')
    .select()
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Failed to fetch merchant ledger entries: ${error.message}`)
  return data || []
}

export async function updateLedgerEntryStatus(id: string, status: string): Promise<LedgerEntry> {
  const { data, error } = await supabase
    .from('ledger_entries')
    .update({ status })
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to update ledger entry status: ${error.message}`)
  return data
}