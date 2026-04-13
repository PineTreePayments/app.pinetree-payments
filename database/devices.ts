import { supabase } from './supabase'

export interface Device {
  id: string
  merchant_id: string
  location_id: string
  name: string
  device_key: string
  created_at?: Date
}

export async function getDeviceById(id: string): Promise<Device | null> {
  const { data, error } = await supabase
    .from('devices')
    .select()
    .eq('id', id)
    .single()

  if (error) return null
  return data
}

export async function getDevicesByMerchantId(merchantId: string): Promise<Device[]> {
  const { data, error } = await supabase
    .from('devices')
    .select()
    .eq('merchant_id', merchantId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to fetch devices: ${error.message}`)
  return data || []
}

export async function getDevicesByLocationId(locationId: string): Promise<Device[]> {
  const { data, error } = await supabase
    .from('devices')
    .select()
    .eq('location_id', locationId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to fetch location devices: ${error.message}`)
  return data || []
}

export async function createDevice(input: Omit<Device, 'id' | 'created_at'>): Promise<Device> {
  const { data, error } = await supabase
    .from('devices')
    .insert(input)
    .select()
    .single()

  if (error) throw new Error(`Failed to create device: ${error.message}`)
  return data
}

export async function updateDevice(id: string, input: Partial<Device>): Promise<Device> {
  const { data, error } = await supabase
    .from('devices')
    .update(input)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to update device: ${error.message}`)
  return data
}

export async function deleteDevice(id: string): Promise<void> {
  const { error } = await supabase
    .from('devices')
    .delete()
    .eq('id', id)

  if (error) throw new Error(`Failed to delete device: ${error.message}`)
}