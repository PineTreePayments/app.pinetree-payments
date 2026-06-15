import {
  insertCheckoutLink,
  getCheckoutLinksByMerchant,
  getCheckoutLinkByPublicToken,
  updateCheckoutLinkStatus,
  type CheckoutLink,
  type CheckoutLinkStatus,
} from "@/database/checkoutLinks"
import { createPaymentIntentEngine } from "./paymentIntents"
import {
  getCheckoutSessionLifecycle,
  getRequestedCheckoutSessionRails,
} from "./checkoutSessionMetadata"

const APP_URL = (() => {
  const u = process.env.NEXT_PUBLIC_APP_URL || ""
  return u && !u.includes("localhost") && !u.includes("127.0.0.1")
    ? u
    : "https://app.pinetree-payments.com"
})()

export type CheckoutLinkExpiration = "never" | "24h" | "7d" | "30d"

export type CreateCheckoutLinkInput = {
  merchantId: string
  name: string
  description?: string
  amount: number
  currency?: string
  customerEmail?: string
  reference?: string
  expiration: CheckoutLinkExpiration
  successUrl?: string
  cancelUrl?: string
  metadata?: Record<string, unknown>
}

export type CheckoutLinkWithUrl = CheckoutLink & {
  checkoutUrl: string
  resolvedStatus: CheckoutLinkStatus
}

function calculateExpiresAt(expiration: CheckoutLinkExpiration): string | null {
  if (expiration === "never") return null
  const hours = expiration === "24h" ? 24 : expiration === "7d" ? 7 * 24 : 30 * 24
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

function generatePublicToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 16)
}

function resolveStatus(link: CheckoutLink): CheckoutLinkStatus {
  if (link.status === "archived") return "archived"
  const lifecycle = getCheckoutSessionLifecycle(link.link_metadata)
  if (lifecycle === "expired") return "expired"
  if (lifecycle === "canceled") return "disabled"
  if (link.status === "disabled") return "disabled"
  if (link.expires_at && new Date(link.expires_at) < new Date()) return "expired"
  return "active"
}

function buildCheckoutUrl(token: string): string {
  return `${APP_URL}/checkout/${encodeURIComponent(token)}`
}

function withUrl(link: CheckoutLink): CheckoutLinkWithUrl {
  return {
    ...link,
    checkoutUrl: buildCheckoutUrl(link.public_token),
    resolvedStatus: resolveStatus(link),
  }
}

export async function createCheckoutLinkEngine(input: CreateCheckoutLinkInput): Promise<CheckoutLinkWithUrl> {
  const amount = Number(input.amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invalid amount")
  if (!input.name.trim()) throw new Error("Link name is required")
  if (!input.merchantId.trim()) throw new Error("Missing merchant ID")

  const currency = String(input.currency || "USD").trim().toUpperCase() || "USD"
  const expiresAt = calculateExpiresAt(input.expiration)
  const publicToken = generatePublicToken()
  const id = crypto.randomUUID()

  const link = await insertCheckoutLink({
    id,
    merchant_id: input.merchantId,
    public_token: publicToken,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    amount,
    currency,
    customer_email: input.customerEmail?.trim() || null,
    reference: input.reference?.trim() || null,
    status: "active",
    expires_at: expiresAt,
    success_url: input.successUrl?.trim() || null,
    cancel_url: input.cancelUrl?.trim() || null,
    link_metadata: input.metadata || null,
  })

  return withUrl(link)
}

export async function listCheckoutLinksEngine(merchantId: string): Promise<CheckoutLinkWithUrl[]> {
  const links = await getCheckoutLinksByMerchant(merchantId)
  return links.map(withUrl)
}

export async function disableCheckoutLinkEngine(
  id: string,
  merchantId: string
): Promise<CheckoutLinkWithUrl> {
  const updated = await updateCheckoutLinkStatus(id, merchantId, "disabled")
  return withUrl(updated)
}

export async function archiveCheckoutLinkEngine(
  id: string,
  merchantId: string
): Promise<CheckoutLinkWithUrl> {
  const updated = await updateCheckoutLinkStatus(id, merchantId, "archived")
  return withUrl(updated)
}

export type ResolvedCheckoutLink =
  | { link: CheckoutLink; resolvedStatus: "active"; intentId: string; successUrl: string | null; cancelUrl: string | null }
  | { link: CheckoutLink; resolvedStatus: "disabled" | "expired" | "archived"; intentId: null; successUrl: string | null; cancelUrl: string | null }

export async function resolveCheckoutLinkForCustomer(token: string): Promise<ResolvedCheckoutLink | null> {
  const link = await getCheckoutLinkByPublicToken(token)
  if (!link) return null

  const resolvedStatus = resolveStatus(link)

  const successUrl = link.success_url || null
  const cancelUrl = link.cancel_url || null
  const linkMetadata = (link.link_metadata || {}) as Record<string, unknown>
  const requestedRails = getRequestedCheckoutSessionRails(linkMetadata)

  if (resolvedStatus !== "active") {
    return { link, resolvedStatus: resolvedStatus as "disabled" | "expired" | "archived", intentId: null, successUrl, cancelUrl }
  }

  const intent = await createPaymentIntentEngine({
    merchantId: link.merchant_id,
    amount: link.amount,
    currency: link.currency,
    metadata: {
      ...linkMetadata,
      checkoutLinkId: link.id,
      checkoutLinkName: link.name,
      customerEmail: link.customer_email || undefined,
      reference: link.reference || undefined,
      channel: "online",
      successUrl: successUrl || undefined,
      cancelUrl: cancelUrl || undefined,
    },
    allowedNetworks: requestedRails,
  })

  return { link, resolvedStatus: "active", intentId: intent.intentId, successUrl, cancelUrl }
}
