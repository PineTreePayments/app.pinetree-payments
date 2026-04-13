import { supabase } from './supabase'

export interface Location {
  id: string
  merchant_id: string
  name: string
  address?: string
  city?: string
  state?: string
  created_at?: Date
}

export async function getLocationById(id: string): Promise<Location | null> {
  const { data, error } = await supabase
    .from('locations')
    .select()
    .eq('id', id)
    .single()

  if (error) return null
  return data
}

export async function getLocationsByMerchantId(merchantId: string): Promise<Location[]> {
  const { data, error } = await supabase
    .from('locations')
    .select()
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to fetch locations: ${error.message}`)
  return data || []
}

export async function createLocation(input: Omit<Location, 'id' | 'created_at'>): Promise<Location> {
  const { data, error } = await supabase
    .from('locations')
    .insert(input)
    .select()
    .single()

  if (error) throw new Error(`Failed to create location: ${error.message}`)
  return data
}

export async function updateLocation(id: string, input: Partial<Location>): Promise<Location> {
  const { data, error } = await supabase
    .from('locations')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to update location: ${error.message}`)
  return data
}

export async function deleteLocation(id: string): Promise<void> {
  const { error } = await supabase
    .from('locations')
    .delete()
    .eq('id', id)

  if (error) throw new Error(`Failed to delete location: ${error.message}`)
}