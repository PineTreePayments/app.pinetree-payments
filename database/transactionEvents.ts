import { supabase } from './supabase'

export interface TransactionEvent {
  id: string
  transaction_id: string
  provider?: string
  event_type?: string
  payload?: any
  created_at?: Date
}

export async function createTransactionEvent(input: Omit<TransactionEvent, 'id' | 'created_at'>): Promise<TransactionEvent> {
  const { data, error } = await supabase
    .from('transaction_events')
    .insert(input)
    .select()
    .single()

  if (error) throw new Error(`Failed to create transaction event: ${error.message}`)
  return data
}

export async function getTransactionEvents(transactionId: string): Promise<TransactionEvent[]> {
  const { data, error } = await supabase
    .from('transaction_events')
    .select()
    .eq('transaction_id', transactionId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to fetch transaction events: ${error.message}`)
  return data || []
}

export async function getLatestTransactionEvent(transactionId: string): Promise<TransactionEvent | null> {
  const { data, error } = await supabase
    .from('transaction_events')
    .select()
    .eq('transaction_id', transactionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error) return null
  return data
}