import { supabase } from './supabase'

export interface RoutingRule {
  id: string
  merchant_id: string
  payment_type?: string
  provider?: string
  priority?: number
  enabled?: boolean
  created_at?: Date
}

export async function getRoutingRulesForMerchant(merchantId: string): Promise<RoutingRule[]> {
  const { data, error } = await supabase
    .from('routing_rules')
    .select()
    .eq('merchant_id', merchantId)
    .eq('enabled', true)
    .order('priority', { ascending: true })

  if (error) throw new Error(`Failed to fetch routing rules: ${error.message}`)
  return data || []
}

export async function createRoutingRule(input: Omit<RoutingRule, 'id' | 'created_at'>): Promise<RoutingRule> {
  const { data, error } = await supabase
    .from('routing_rules')
    .insert(input)
    .select()
    .single()

  if (error) throw new Error(`Failed to create routing rule: ${error.message}`)
  return data
}

export async function updateRoutingRule(id: string, input: Partial<RoutingRule>): Promise<RoutingRule> {
  const { data, error } = await supabase
    .from('routing_rules')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to update routing rule: ${error.message}`)
  return data
}

export async function deleteRoutingRule(id: string): Promise<void> {
  const { error } = await supabase
    .from('routing_rules')
    .delete()
    .eq('id', id)

  if (error) throw new Error(`Failed to delete routing rule: ${error.message}`)
}