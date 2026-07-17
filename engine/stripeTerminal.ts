import {
  createStripeTerminalLocation,
  listStripeTerminalLocations,
  listStripeTerminalReaders,
  registerStripeTerminalReader,
  registerSimulatedStripeReader,
  isStripeTestMode,
  createStripeTerminalConnectionToken,
  resolveStripeConnectChargeContext,
  createCardPresentPaymentIntent,
  createManualEntryPaymentIntent,
  retrieveCardPaymentIntent,
  cancelCardPaymentIntent,
  processPaymentIntentOnReader,
  cancelReaderAction,
  getReaderActionState,
  presentSimulatedCard,
  type StripeTerminalAddress,
  type StripeTerminalReader
} from "@/providers/stripe"
import {
  getStripeCardProviderContext,
  getStripeTerminalReadiness,
  type StripeCardRoutingPreference
} from "./stripeConnect"
import {
  listMerchantTerminalLocations,
  getMerchantTerminalLocationById,
  upsertMerchantTerminalLocation,
  type MerchantTerminalLocation
} from "@/database/merchantTerminalLocations"
import {
  listMerchantTerminalReaders,
  getMerchantTerminalReaderById,
  upsertMerchantTerminalReader,
  setMerchantDefaultTerminalReader,
  type MerchantTerminalReader
} from "@/database/merchantTerminalReaders"
import {
  claimTerminalReaderForPayment,
  getTerminalReaderByActivePayment,
  releaseTerminalReaderClaim
} from "@/database/merchantTerminalReaders"
import { createPayment as createPaymentRecord, getPaymentById, updatePaymentMetadata, updatePaymentProviderReference } from "@/database/payments"
import { calculatePosTotalsForTerminal } from "./posPayments"
import { advancePaymentToTargetStatus } from "./eventProcessor"
import { randomUUID } from "crypto"
import { resolveRecommendedCardMethod } from "./cardCaptureRouting"
export { resolveRecommendedCardMethod } from "./cardCaptureRouting"

/**
 * Stripe Terminal management engine: locations, readers, simulated readers,
 * connection tokens, and the provider-neutral card capture availability
 * resolver. The database is the source of truth for what PineTree shows;
 * Stripe is the source of truth for live reader status (synchronized here).
 */

function statusError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status })
}

// ─── Safe shapes returned to routes/UI ───────────────────────────────────────

export type SafeTerminalLocation = {
  id: string
  displayName: string
  address: Record<string, unknown>
  status: string
  createdAt: string | null
}

export type SafeTerminalReader = {
  id: string
  label: string
  deviceType: string
  serialNumber: string | null
  status: "online" | "offline" | "busy" | "unknown"
  simulated: boolean
  isDefault: boolean
  locationId: string | null
  lastSeenAt: string | null
}

function toSafeLocation(row: MerchantTerminalLocation): SafeTerminalLocation {
  return {
    id: row.id,
    displayName: row.display_name,
    address: row.address || {},
    status: row.status,
    createdAt: row.created_at || null
  }
}

function toSafeReader(row: MerchantTerminalReader): SafeTerminalReader {
  const baseStatus = String(row.status || "unknown").toLowerCase()
  return {
    id: row.id,
    label: row.label,
    deviceType: row.device_type,
    serialNumber: row.serial_number,
    status: row.active_payment_id
      ? "busy"
      : baseStatus === "online" || baseStatus === "offline"
        ? (baseStatus as "online" | "offline")
        : "unknown",
    simulated: row.simulated === true,
    isDefault: row.is_default === true,
    locationId: row.terminal_location_id,
    lastSeenAt: row.last_seen_at
  }
}

async function requireTerminalReady(merchantId: string): Promise<string> {
  if (resolveStripeConnectChargeContext().chargeModel !== "direct") {
    throw statusError("Stripe destination-charge Terminal routing is not enabled. Use the validated direct-charge model.", 409)
  }
  const readiness = await getStripeTerminalReadiness(merchantId)
  if (!readiness.ready) throw statusError(readiness.reason, 409)
  return readiness.accountId
}

// ─── Locations ───────────────────────────────────────────────────────────────

export async function listTerminalLocationsEngine(
  merchantId: string,
  options?: { refresh?: boolean }
): Promise<SafeTerminalLocation[]> {
  if (options?.refresh) {
    const readiness = await getStripeTerminalReadiness(merchantId)
    if (readiness.ready) {
      try {
        const live = await listStripeTerminalLocations({ connectedAccountId: readiness.accountId })
        for (const location of live) {
          await upsertMerchantTerminalLocation({
            merchantId,
            providerLocationId: location.id,
            displayName: location.displayName,
            address: location.address as unknown as Record<string, unknown>,
            status: "active"
          })
        }
      } catch (error) {
        console.warn("[stripeTerminal] location refresh failed", {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }
  const rows = await listMerchantTerminalLocations(merchantId)
  return rows.map(toSafeLocation)
}

export async function createTerminalLocationEngine(
  merchantId: string,
  input: { displayName: string; address: StripeTerminalAddress }
): Promise<SafeTerminalLocation> {
  const accountId = await requireTerminalReady(merchantId)

  // Reuse an existing location with the same display name instead of
  // creating a Stripe duplicate.
  const existing = await listMerchantTerminalLocations(merchantId)
  const duplicate = existing.find(
    (row) => row.display_name.trim().toLowerCase() === String(input.displayName || "").trim().toLowerCase()
  )
  if (duplicate) return toSafeLocation(duplicate)

  const location = await createStripeTerminalLocation({
    connectedAccountId: accountId,
    displayName: input.displayName,
    address: input.address
  })

  const row = await upsertMerchantTerminalLocation({
    merchantId,
    providerLocationId: location.id,
    displayName: location.displayName,
    address: location.address as unknown as Record<string, unknown>,
    status: "active"
  })

  return toSafeLocation(row)
}

// ─── Readers ─────────────────────────────────────────────────────────────────

async function persistReader(
  merchantId: string,
  reader: StripeTerminalReader,
  terminalLocationId: string | null
): Promise<MerchantTerminalReader> {
  const row = await upsertMerchantTerminalReader({
    merchantId,
    providerReaderId: reader.id,
    terminalLocationId,
    label: reader.label,
    deviceType: reader.deviceType,
    serialNumber: reader.serialNumber,
    status: reader.status,
    simulated: reader.simulated
  })

  // First reader becomes the merchant default automatically.
  const all = await listMerchantTerminalReaders(merchantId)
  if (all.length === 1 || !all.some((r) => r.is_default)) {
    await setMerchantDefaultTerminalReader(merchantId, row.id)
    row.is_default = true
  }

  return row
}

export async function listTerminalReadersEngine(
  merchantId: string,
  options?: { refresh?: boolean }
): Promise<SafeTerminalReader[]> {
  if (options?.refresh) {
    const readiness = await getStripeTerminalReadiness(merchantId)
    if (readiness.ready) {
      try {
        const live = await listStripeTerminalReaders({ connectedAccountId: readiness.accountId })
        const locations = await listMerchantTerminalLocations(merchantId)
        const locationByProviderId = new Map(locations.map((l) => [l.provider_location_id, l.id]))
        for (const reader of live) {
          await persistReader(
            merchantId,
            reader,
            reader.locationId ? locationByProviderId.get(reader.locationId) ?? null : null
          )
        }
      } catch (error) {
        console.warn("[stripeTerminal] reader refresh failed", {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  const rows = await listMerchantTerminalReaders(merchantId)
  return rows.map(toSafeReader)
}

export async function registerTerminalReaderEngine(
  merchantId: string,
  input: { registrationCode: string; label?: string; terminalLocationId: string }
): Promise<SafeTerminalReader> {
  const accountId = await requireTerminalReady(merchantId)

  if (!String(input.terminalLocationId || "").trim()) {
    throw statusError("Create a Stripe Terminal Location before registering a physical reader.", 409)
  }

  const location = await getMerchantTerminalLocationById(merchantId, String(input.terminalLocationId || ""))
  if (!location) throw statusError("Terminal location not found for this merchant", 404)

  // The registration code is used once and never persisted or logged.
  const reader = await registerStripeTerminalReader({
    connectedAccountId: accountId,
    registrationCode: input.registrationCode,
    label: input.label,
    stripeLocationId: location.provider_location_id
  })

  const row = await persistReader(merchantId, reader, location.id)
  return toSafeReader(row)
}

export async function createSimulatedTerminalReaderEngine(
  merchantId: string,
  input?: { terminalLocationId?: string }
): Promise<SafeTerminalReader> {
  if (!isStripeTestMode()) {
    throw statusError("Simulated readers are only available in test mode", 403)
  }

  const accountId = await requireTerminalReady(merchantId)

  // Reuse an existing simulated reader rather than accumulating test readers.
  const existing = await listMerchantTerminalReaders(merchantId)
  const existingSimulated = existing.find((row) => row.simulated)
  if (existingSimulated) return toSafeReader(existingSimulated)

  let location: MerchantTerminalLocation | null = null
  if (input?.terminalLocationId) {
    location = await getMerchantTerminalLocationById(merchantId, input.terminalLocationId)
    if (!location) throw statusError("Terminal location not found for this merchant", 404)
  } else {
    const locations = await listMerchantTerminalLocations(merchantId)
    location = locations[0] || null
  }

  if (!location) {
    throw statusError(
      "Create a Stripe Terminal Location before creating a Sandbox Reader.",
      409
    )
  }

  const reader = await registerSimulatedStripeReader({
    connectedAccountId: accountId,
    stripeLocationId: location.provider_location_id
  })

  const row = await persistReader(merchantId, reader, location.id)
  return toSafeReader(row)
}

export async function setDefaultTerminalReaderEngine(
  merchantId: string,
  readerId: string
): Promise<SafeTerminalReader[]> {
  const reader = await getMerchantTerminalReaderById(merchantId, String(readerId || ""))
  if (!reader) throw statusError("Reader not found for this merchant", 404)

  await setMerchantDefaultTerminalReader(merchantId, reader.id)
  return listTerminalReadersEngine(merchantId)
}

// ─── Native Terminal contract ────────────────────────────────────────────────

export async function createTerminalConnectionTokenEngine(
  merchantId: string
): Promise<{ secret: string }> {
  const accountId = await requireTerminalReady(merchantId)
  const context = resolveStripeConnectChargeContext()

  // Connection tokens follow the reader owner from the charge-model helper.
  // Secret is returned once — never persisted, never logged.
  return createStripeTerminalConnectionToken({
    connectedAccountId: context.connectionTokenAccount === "connected" ? accountId : "",
    stripeLocationId: undefined
  })
}

export async function getTerminalNativeConfigEngine(merchantId: string): Promise<{
  publishableKey: string | null
  pineTreeLocationId: string | null
  providerLocationId: string | null
  tapToPay: { available: boolean; reason: string }
  terminalReady: boolean
}> {
  const readiness = await getStripeTerminalReadiness(merchantId)
  const locations = await listMerchantTerminalLocations(merchantId)
  const first = locations[0] || null

  return {
    publishableKey: String(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "").trim() || null,
    pineTreeLocationId: first?.id || null,
    // The provider location ID is required by the native Terminal SDK for
    // reader discovery; it is scoped to the authenticated merchant's own
    // account and carries no secret material.
    providerLocationId: first?.provider_location_id || null,
    tapToPay: {
      available: false,
      reason: readiness.ready ? "native_app_required" : "provider_not_ready"
    },
    terminalReady: readiness.ready
  }
}

// ─── Card capture availability resolver ──────────────────────────────────────

export type PineTreeCardClientContext = {
  platform: "browser" | "native"
  /** Reserved for the future native client; browsers can never set this truthfully. */
  tapToPaySupportedDevice?: boolean
}

export type CardCaptureAvailability = {
  stripeConnected: boolean
  stripeReady: boolean
  onlineCardsEnabled: boolean
  inPersonEnabled: boolean
  manualEntryEnabled: boolean
  routingPreference: StripeCardRoutingPreference
  terminalReaders: Array<{
    id: string
    label: string
    status: "online" | "offline" | "busy" | "unknown"
    isDefault: boolean
    simulated: boolean
  }>
  terminalLocations: Array<{
    id: string
    displayName: string
  }>
  stripeTestMode: boolean
  tapToPay: {
    available: boolean
    reason: "available" | "native_app_required" | "unsupported_device" | "not_configured" | "provider_not_ready"
  }
  recommendedMethod: "terminal_reader" | "tap_to_pay" | "manual_entry" | "payment_link" | null
}

export async function getCardCaptureAvailabilityEngine(
  merchantId: string,
  clientContext: PineTreeCardClientContext
): Promise<CardCaptureAvailability> {
  const context = await getStripeCardProviderContext(merchantId)
  const stripeConnected = Boolean(context.accountId)
  const stripeReady = context.connection.chargesEnabled === true

  const readerRows = stripeReady ? await listTerminalReadersEngine(merchantId) : []
  const locationRows = stripeReady ? await listTerminalLocationsEngine(merchantId) : []
  const terminalReaders = readerRows.map((reader) => ({
    id: reader.id,
    label: reader.label,
    status: reader.status,
    isDefault: reader.isDefault,
    simulated: reader.simulated
  }))

  // Tap to Pay requires a native Stripe Terminal SDK integration. A normal
  // browser can NEVER offer it — the web app cannot use phone NFC hardware
  // as a Stripe reader.
  const tapToPay: CardCaptureAvailability["tapToPay"] =
    clientContext.platform !== "native"
      ? { available: false, reason: "native_app_required" }
      : !stripeReady
        ? { available: false, reason: "provider_not_ready" }
        : clientContext.tapToPaySupportedDevice === false
          ? { available: false, reason: "unsupported_device" }
          : { available: false, reason: "not_configured" } // no native app ships Tap to Pay yet

  const inPersonEnabled = stripeReady && context.settings.inPersonEnabled
  const manualEntryEnabled = stripeReady && context.settings.manualEntryEnabled
  const onlineCardsEnabled = stripeReady && context.onlineEnabled

  const hasUsableReader =
    inPersonEnabled && terminalReaders.some((reader) => reader.status === "online")

  return {
    stripeConnected,
    stripeReady,
    onlineCardsEnabled,
    inPersonEnabled,
    manualEntryEnabled,
    routingPreference: context.settings.routingPreference,
    terminalReaders,
    terminalLocations: locationRows.map((location) => ({
      id: location.id,
      displayName: location.displayName
    })),
    stripeTestMode: isStripeTestMode(),
    tapToPay,
    recommendedMethod: resolveRecommendedCardMethod({
      routingPreference: context.settings.routingPreference,
      hasUsableReader,
      tapToPayAvailable: tapToPay.available,
      manualEntryEnabled,
      paymentLinkAvailable: onlineCardsEnabled
    })
  }
}

type CardMetadata = {
  payment_channel: "in_person"
  capture_method: "terminal_reader" | "manual_entry"
  card_present: boolean
  provider_status: string
  terminal_reader_id?: string | null
  terminal_location_id?: string | null
  provider_payment_intent_id?: string
  attempts?: Array<Record<string, unknown>>
}

function cardMetadata(payment: { metadata?: unknown }): CardMetadata | null {
  const metadata = payment.metadata && typeof payment.metadata === "object"
    ? payment.metadata as Record<string, unknown>
    : {}
  return metadata.card && typeof metadata.card === "object" ? metadata.card as CardMetadata : null
}

async function requireOwnedPayablePayment(merchantId: string, paymentId: string) {
  const payment = await getPaymentById(paymentId)
  if (!payment || payment.merchant_id !== merchantId) throw statusError("Payment not found", 404)
  if (["CONFIRMED", "FAILED", "INCOMPLETE"].includes(payment.status)) {
    throw statusError("This payment is no longer payable", 409)
  }
  return payment
}

export async function createTerminalPaymentEngine(input: {
  merchantId: string
  posTerminalId: string
  subtotalAmount?: number
  paymentId?: string
  readerId: string
  currency?: string
}) {
  const accountId = await requireTerminalReady(input.merchantId)
  const context = await getStripeCardProviderContext(input.merchantId)
  if (!context.settings.inPersonEnabled) throw statusError("In-person card payments are disabled", 403)

  const reader = await getMerchantTerminalReaderById(input.merchantId, input.readerId)
  if (!reader) throw statusError("Reader not found for this merchant", 404)
  if (String(reader.status).toLowerCase() !== "online") throw statusError("The selected reader is offline", 409)

  let payment = input.paymentId
    ? await requireOwnedPayablePayment(input.merchantId, input.paymentId)
    : null
  if (!payment) {
    const totals = await calculatePosTotalsForTerminal(input.merchantId, input.posTerminalId, Number(input.subtotalAmount || 0))
    payment = await createPaymentRecord({
      id: randomUUID(),
      merchant_id: input.merchantId,
      merchant_amount: totals.subtotalAmount + totals.taxAmount,
      pinetree_fee: totals.serviceFee,
      gross_amount: totals.totalAmount,
      currency: input.currency || "USD",
      provider: "stripe",
      network: "stripe",
      status: "PENDING",
      metadata: {
        channel: "pos",
        terminalId: input.posTerminalId,
        subtotalAmount: totals.subtotalAmount,
        taxAmount: totals.taxAmount,
        card: {
          payment_channel: "in_person",
          capture_method: "terminal_reader",
          card_present: true,
          provider_status: "creating",
          terminal_reader_id: reader.id,
          terminal_location_id: reader.terminal_location_id
        }
      }
    })
  }

  const existingCard = cardMetadata(payment)
  let intentId = String(payment.provider_reference || "").trim()
  if (!intentId || existingCard?.capture_method !== "terminal_reader") {
    const intent = await createCardPresentPaymentIntent({
      connectedAccountId: accountId,
      paymentId: payment.id,
      merchantId: input.merchantId,
      grossAmount: payment.gross_amount,
      currency: payment.currency,
      captureMethod: "terminal_reader"
    })
    intentId = intent.id
    payment = await updatePaymentProviderReference(payment.id, intent.id)
  }

  const claimed = await claimTerminalReaderForPayment(input.merchantId, reader.id, payment.id)
  if (!claimed) throw statusError("The card reader is busy with another payment", 409)

  try {
    const action = await processPaymentIntentOnReader({
      connectedAccountId: accountId,
      stripeReaderId: reader.provider_reader_id,
      paymentIntentId: intentId
    })
    await updatePaymentMetadata(payment.id, {
      card: {
        payment_channel: "in_person",
        capture_method: "terminal_reader",
        card_present: true,
        provider_payment_intent_id: intentId,
        provider_status: action.action.status,
        terminal_reader_id: reader.id,
        terminal_location_id: reader.terminal_location_id
      }
    })
    return { paymentId: payment.id, state: payment.status, reader: toSafeReader(reader), action: action.action }
  } catch (error) {
    await releaseTerminalReaderClaim(payment.id).catch(() => undefined)
    throw error
  }
}

export async function getTerminalPaymentEngine(merchantId: string, paymentId: string) {
  const accountId = await requireTerminalReady(merchantId)
  const payment = await requireOwnedPayablePayment(merchantId, paymentId).catch(async (error) => {
    const terminal = await getPaymentById(paymentId)
    if (terminal && terminal.merchant_id === merchantId) return terminal
    throw error
  })
  const reader = await getTerminalReaderByActivePayment(paymentId)
  const action = reader
    ? await getReaderActionState({ connectedAccountId: accountId, stripeReaderId: reader.provider_reader_id })
        .then((value) => value.action)
        .catch(() => null)
    : null
  return {
    payment: { id: payment.id, status: payment.status, amount: payment.gross_amount, currency: payment.currency },
    reader: reader ? toSafeReader(reader) : null,
    action
  }
}

export async function cancelTerminalPaymentEngine(merchantId: string, paymentId: string) {
  const accountId = await requireTerminalReady(merchantId)
  const payment = await requireOwnedPayablePayment(merchantId, paymentId)
  const reader = await getTerminalReaderByActivePayment(payment.id)
  if (reader) {
    await cancelReaderAction({ connectedAccountId: accountId, stripeReaderId: reader.provider_reader_id }).catch(() => undefined)
  }
  if (payment.provider_reference) {
    await cancelCardPaymentIntent({ connectedAccountId: accountId, paymentIntentId: payment.provider_reference }).catch(() => undefined)
  }
  await advancePaymentToTargetStatus(payment.id, "INCOMPLETE", {
    providerEvent: "terminal.reader.action_canceled",
    rawPayload: { reason: "merchant_canceled", paymentIntentId: payment.provider_reference || null }
  })
  await releaseTerminalReaderClaim(payment.id)
  return { paymentId: payment.id, status: "INCOMPLETE" as const }
}

export async function createManualEntryPaymentEngine(input: {
  merchantId: string
  paymentId?: string
  posTerminalId?: string
  subtotalAmount?: number
  currency?: string
}) {
  const accountId = await requireTerminalReady(input.merchantId)
  const context = await getStripeCardProviderContext(input.merchantId)
  if (!context.settings.manualEntryEnabled) throw statusError("Manual card entry is disabled", 403)
  let payment = input.paymentId
    ? await requireOwnedPayablePayment(input.merchantId, input.paymentId)
    : null
  if (!payment) {
    const posTerminalId = String(input.posTerminalId || "").trim()
    if (!posTerminalId) throw statusError("Missing POS terminal id", 400)
    const totals = await calculatePosTotalsForTerminal(input.merchantId, posTerminalId, Number(input.subtotalAmount || 0))
    payment = await createPaymentRecord({
      id: randomUUID(),
      merchant_id: input.merchantId,
      merchant_amount: totals.subtotalAmount + totals.taxAmount,
      pinetree_fee: totals.serviceFee,
      gross_amount: totals.totalAmount,
      currency: input.currency || "USD",
      provider: "stripe",
      network: "stripe",
      status: "PENDING",
      metadata: {
        channel: "pos",
        terminalId: posTerminalId,
        subtotalAmount: totals.subtotalAmount,
        taxAmount: totals.taxAmount,
        card: {
          payment_channel: "in_person",
          capture_method: "manual_entry",
          card_present: false,
          provider_status: "creating",
          terminal_reader_id: null,
          terminal_location_id: null
        }
      }
    })
  }
  const existing = cardMetadata(payment)

  if (existing?.capture_method === "manual_entry" && existing.provider_payment_intent_id) {
    const intent = await retrieveCardPaymentIntent({ connectedAccountId: accountId, paymentIntentId: existing.provider_payment_intent_id })
    return { paymentId: payment.id, clientSecret: intent.clientSecret, stripeAccountId: accountId, status: payment.status }
  }

  const reader = await getTerminalReaderByActivePayment(payment.id)
  if (reader) await cancelReaderAction({ connectedAccountId: accountId, stripeReaderId: reader.provider_reader_id }).catch(() => undefined)
  if (payment.provider_reference) {
    await cancelCardPaymentIntent({ connectedAccountId: accountId, paymentIntentId: payment.provider_reference }).catch(() => undefined)
  }
  await releaseTerminalReaderClaim(payment.id)

  const intent = await createManualEntryPaymentIntent({
    connectedAccountId: accountId,
    paymentId: payment.id,
    merchantId: input.merchantId,
    grossAmount: payment.gross_amount,
    currency: payment.currency
  })
  await updatePaymentProviderReference(payment.id, intent.id)
  await updatePaymentMetadata(payment.id, {
    card: {
      payment_channel: "in_person",
      capture_method: "manual_entry",
      card_present: false,
      provider_payment_intent_id: intent.id,
      provider_status: intent.providerStatus,
      terminal_reader_id: null,
      terminal_location_id: null,
      attempts: [
        ...(existing?.attempts || []),
        ...(payment.provider_reference ? [{ payment_intent_id: payment.provider_reference, capture_method: "terminal_reader", status: "canceled" }] : [])
      ]
    }
  })
  return { paymentId: payment.id, clientSecret: intent.clientSecret, stripeAccountId: accountId, status: payment.status }
}

/** Test-mode-only deterministic hook used by the Terminal smoke harness. */
export async function presentSimulatedTerminalPaymentEngine(merchantId: string, paymentId: string) {
  if (!isStripeTestMode()) throw statusError("Simulated card presentation is only available in test mode", 403)
  const accountId = await requireTerminalReady(merchantId)
  await requireOwnedPayablePayment(merchantId, paymentId)
  const reader = await getTerminalReaderByActivePayment(paymentId)
  if (!reader || !reader.simulated) throw statusError("No simulated reader is processing this payment", 409)
  await presentSimulatedCard({ connectedAccountId: accountId, stripeReaderId: reader.provider_reader_id })
  return { paymentId, presented: true }
}
