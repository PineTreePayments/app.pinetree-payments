import { supabaseAdmin, supabase as supabaseAnon } from "./supabase"

const supabase = supabaseAdmin || supabaseAnon

export type CheckoutLinkStatus = "active" | "disabled" | "expired" | "archived"

export type CheckoutLink = {
  id: string
  merchant_id: string
  public_token: string
  name: string
  description: string | null
  amount: number
  currency: string
  customer_email: string | null
  reference: string | null
  status: CheckoutLinkStatus
  expires_at: string | null
  success_url: string | null
  cancel_url: string | null
  link_metadata: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export type CreateCheckoutLinkInput = {
  id: string
  merchant_id: string
  public_token: string
  name: string
  description?: string | null
  amount: number
  currency: string
  customer_email?: string | null
  reference?: string | null
  status?: CheckoutLinkStatus
  expires_at?: string | null
  success_url?: string | null
  cancel_url?: string | null
  link_metadata?: Record<string, unknown> | null
}

export async function insertCheckoutLink(input: CreateCheckoutLinkInput): Promise<CheckoutLink> {
  const { data, error } = await supabase
    .from("checkout_links")
    .insert({
      id: input.id,
      merchant_id: input.merchant_id,
      public_token: input.public_token,
      name: input.name,
      description: input.description ?? null,
      amount: input.amount,
      currency: input.currency,
      customer_email: input.customer_email ?? null,
      reference: input.reference ?? null,
      status: input.status ?? "active",
      expires_at: input.expires_at ?? null,
      success_url: input.success_url ?? null,
      cancel_url: input.cancel_url ?? null,
      link_metadata: input.link_metadata ?? null,
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to create checkout link: ${error.message}`)
  return data as CheckoutLink
}

export async function getCheckoutLinksByMerchant(merchantId: string): Promise<CheckoutLink[]> {
  const { data, error } = await supabase
    .from("checkout_links")
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })

  if (error) throw new Error(`Failed to fetch checkout links: ${error.message}`)
  return (data ?? []) as CheckoutLink[]
}

export async function getCheckoutLinkByPublicToken(token: string): Promise<CheckoutLink | null> {
  const { data, error } = await supabase
    .from("checkout_links")
    .select("*")
    .eq("public_token", token)
    .single()

  if (error) return null
  return data as CheckoutLink
}

export async function updateCheckoutLinkStatus(
  id: string,
  merchantId: string,
  status: CheckoutLinkStatus
): Promise<CheckoutLink> {
  const { data, error } = await supabase
    .from("checkout_links")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("merchant_id", merchantId)
    .select()
    .single()

  if (error) throw new Error(`Failed to update checkout link: ${error.message}`)
  return data as CheckoutLink
}

export async function updateActiveCheckoutLinkLifecycle(
  id: string,
  merchantId: string,
  input: {
    expiresAt?: string | null
    metadata: Record<string, unknown>
  }
): Promise<CheckoutLink | null> {
  const update: Record<string, unknown> = {
    status: "disabled",
    link_metadata: input.metadata,
    updated_at: new Date().toISOString(),
  }
  if (input.expiresAt !== undefined) update.expires_at = input.expiresAt

  const { data, error } = await supabase
    .from("checkout_links")
    .update(update)
    .eq("id", id)
    .eq("merchant_id", merchantId)
    .eq("status", "active")
    .select()
    .maybeSingle()

  if (error) throw new Error(`Failed to update checkout session lifecycle: ${error.message}`)
  return (data ?? null) as CheckoutLink | null
}

export async function getCheckoutLinkById(
  id: string,
  merchantId: string
): Promise<CheckoutLink | null> {
  const { data, error } = await supabase
    .from("checkout_links")
    .select("*")
    .eq("id", id)
    .eq("merchant_id", merchantId)
    .single()

  if (error) return null
  return data as CheckoutLink
}

export async function listCheckoutLinksForPublicApi(input: {
  merchantId: string
  limit: number
  cursor?: { createdAt: string; id: string }
  reference?: string
  createdAfter?: string
  createdBefore?: string
}): Promise<CheckoutLink[]> {
  let query = supabase
    .from("checkout_links")
    .select("*")
    .eq("merchant_id", input.merchantId)
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(input.limit)

  if (input.reference) query = query.eq("reference", input.reference)
  if (input.createdAfter) query = query.gte("created_at", input.createdAfter)
  if (input.createdBefore) query = query.lte("created_at", input.createdBefore)
  if (input.cursor) {
    query = query.or(
      `created_at.lt.${input.cursor.createdAt},and(created_at.eq.${input.cursor.createdAt},id.lt.${input.cursor.id})`
    )
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to list checkout sessions: ${error.message}`)
  return (data ?? []) as CheckoutLink[]
}
