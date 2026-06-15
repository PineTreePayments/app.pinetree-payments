import {
  getCheckoutLinkById,
  listCheckoutLinksForPublicApi,
  type CheckoutLink,
} from "@/database/checkoutLinks"
import { supabaseAdmin, supabase as supabaseAnon } from "@/database/supabase"
import { getMerchantAvailableNetworks } from "./paymentIntents"
import {
  getCheckoutSessionLifecycle,
  getRequestedCheckoutSessionRails,
  toPublicCheckoutSessionMetadata,
} from "./checkoutSessionMetadata"
import {
  mapInternalCheckoutSessionStatus,
  type PublicCheckoutSessionStatus,
} from "./publicCheckoutSessionStatus"

export { mapInternalCheckoutSessionStatus } from "./publicCheckoutSessionStatus"

const supabase = supabaseAdmin || supabaseAnon

export type PublicCheckoutSession = {
  id: string
  object: "checkout.session"
  status: PublicCheckoutSessionStatus
  amount: number
  currency: string
  reference: string | null
  customer: { email: string | null }
  metadata: Record<string, unknown>
  checkoutUrl: string
  paymentId: string | null
  supportedRails: string[]
  successUrl: string | null
  cancelUrl: string | null
  createdAt: string
  expiresAt: string | null
}

type IntentRow = {
  payment_id: string | null
  status: string
  available_networks: string[] | null
  created_at: string
}

type PaymentRow = {
  id: string
  status: string
  updated_at: string
}

function buildCheckoutUrl(token: string): string {
  const base =
    (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "") ||
    "https://app.pinetree-payments.com"
  return `${base}/checkout/${encodeURIComponent(token)}`
}

function resolveLinkStatus(link: CheckoutLink) {
  const lifecycle = getCheckoutSessionLifecycle(link.link_metadata)
  if (lifecycle) return lifecycle
  if (link.status === "archived") return "disabled"
  if (link.status === "disabled") return "disabled"
  if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) return "expired"
  return "active"
}

function resolveAggregateStatus(link: CheckoutLink, payments: PaymentRow[]) {
  if (payments.some((payment) => mapInternalCheckoutSessionStatus(payment.status) === "paid")) {
    return "paid" as const
  }
  if (payments.some((payment) => mapInternalCheckoutSessionStatus(payment.status) === "processing")) {
    return "processing" as const
  }
  const lifecycle = getCheckoutSessionLifecycle(link.link_metadata)
  if (lifecycle) {
    return lifecycle
  }
  if (payments.some((payment) => mapInternalCheckoutSessionStatus(payment.status) === "open")) {
    return "open" as const
  }
  if (payments.some((payment) => mapInternalCheckoutSessionStatus(payment.status) === "failed")) {
      return "failed" as const
  }
  return mapInternalCheckoutSessionStatus(resolveLinkStatus(link))
}

function selectPaymentId(payments: PaymentRow[]) {
  const priority: PublicCheckoutSessionStatus[] = ["paid", "processing", "open", "failed", "canceled"]
  for (const status of priority) {
    const payment = payments.find(
      (candidate) => mapInternalCheckoutSessionStatus(candidate.status) === status
    )
    if (payment) return payment.id
  }
  return null
}

export async function getPublicCheckoutSession(
  merchantId: string,
  sessionId: string
): Promise<PublicCheckoutSession | null> {
  const link = await getCheckoutLinkById(sessionId, merchantId)
  if (!link) return null

  const { data: intentData, error: intentError } = await supabase
    .from("payment_intents")
    .select("payment_id, status, available_networks, created_at")
    .eq("merchant_id", merchantId)
    .filter("metadata->>checkoutLinkId", "eq", sessionId)
    .order("created_at", { ascending: false })

  if (intentError) {
    throw new Error(`Failed to load checkout session intents: ${intentError.message}`)
  }

  const intents = (intentData ?? []) as IntentRow[]
  const paymentIds = intents
    .map((intent) => intent.payment_id)
    .filter((id): id is string => Boolean(id))

  let payments: PaymentRow[] = []
  if (paymentIds.length) {
    const { data: paymentData, error: paymentError } = await supabase
      .from("payments")
      .select("id, status, updated_at")
      .in("id", paymentIds)
      .order("updated_at", { ascending: false })

    if (paymentError) {
      throw new Error(`Failed to load checkout session payments: ${paymentError.message}`)
    }
    payments = (paymentData ?? []) as PaymentRow[]
  }

  const metadata = (link.link_metadata || {}) as Record<string, unknown>
  const requestedRails = getRequestedCheckoutSessionRails(metadata)
  const intentRails = intents.find((intent) => intent.available_networks?.length)?.available_networks
  const merchantRails = intentRails || await getMerchantAvailableNetworks(merchantId)
  const requestedRailSet = requestedRails
    ? new Set<string>(requestedRails)
    : null
  const supportedRails = requestedRailSet
    ? merchantRails.filter((rail) => requestedRailSet.has(rail))
    : merchantRails

  return {
    id: link.id,
    object: "checkout.session",
    status: resolveAggregateStatus(link, payments),
    amount: Number(link.amount),
    currency: link.currency,
    reference: link.reference,
    customer: { email: link.customer_email },
    metadata: toPublicCheckoutSessionMetadata(metadata),
    checkoutUrl: buildCheckoutUrl(link.public_token),
    paymentId: selectPaymentId(payments),
    supportedRails,
    successUrl: link.success_url,
    cancelUrl: link.cancel_url,
    createdAt: link.created_at,
    expiresAt: link.expires_at,
  }
}

export async function listPublicCheckoutSessions(input: {
  merchantId: string
  limit: number
  cursor?: { createdAt: string; id: string }
  status?: PublicCheckoutSessionStatus
  reference?: string
  createdAfter?: string
  createdBefore?: string
}) {
  const fetchLimit = input.status ? Math.min(input.limit * 4 + 1, 401) : input.limit + 1
  const links = await listCheckoutLinksForPublicApi({
    merchantId: input.merchantId,
    limit: fetchLimit,
    cursor: input.cursor,
    reference: input.reference,
    createdAfter: input.createdAfter,
    createdBefore: input.createdBefore,
  })
  const sessions = await Promise.all(
    links.map((link) => getPublicCheckoutSession(input.merchantId, link.id))
  )
  const filtered = sessions
    .filter((session): session is PublicCheckoutSession => Boolean(session))
    .filter((session) => !input.status || session.status === input.status)
  const data = filtered.slice(0, input.limit)
  const hasMore = filtered.length > input.limit || links.length === fetchLimit
  const lastScanned = links[Math.min(links.length, fetchLimit) - 1]

  return {
    data,
    hasMore,
    nextCursor: hasMore && lastScanned
      ? Buffer.from(
          JSON.stringify({ createdAt: lastScanned.created_at, id: lastScanned.id })
        ).toString("base64url")
      : null,
  }
}
