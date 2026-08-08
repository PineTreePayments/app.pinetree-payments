/**
 * PineTree Engine - merchant bank payout destinations.
 *
 * This module owns every transition of a merchant's bank destination. The
 * provider adapter talks to the settlement provider and normalizes its
 * vocabulary; API routes are thin wrappers; the UI displays.
 *
 * ── Sensitive data ───────────────────────────────────────────────────────────
 * The raw account number exists only for the duration of the create call. It
 * is never written to a database row, never logged, and never returned to a
 * browser. PineTree persists the provider's external-account identifier and the
 * masked last four the provider itself returns.
 *
 * ── Merchant vocabulary ──────────────────────────────────────────────────────
 * Merchants see "bank account". Provider identifiers and terminology stay
 * inside this boundary and in administrator diagnostics.
 */

import { randomUUID } from "node:crypto"

import {
  activateMerchantBankDestination,
  archiveMerchantBankDestination,
  applyProviderBankDestinationState,
  findBankDestinationByProviderId,
  getMerchantBankDestination,
  listMerchantBankDestinations,
  reserveMerchantBankDestination,
  type MerchantBankDestination,
} from "@/database/merchantBankDestinations"
import { archiveLiquidationRoutesForDestination } from "@/database/merchantBridgeLiquidationRoutes"
import { getMerchantBridgeConnection } from "@/database/merchantBridgeConnections"
import { insertMerchantAuditEvent } from "@/database/merchantAuditEvents"
import { getMerchantBusinessProfile } from "@/engine/businessProfile"
import { alpha3Country } from "@/engine/bridgeCustomerPayload"
import {
  createExternalAccount,
  deactivateExternalAccount,
  listExternalAccounts,
  bridgeListItems,
} from "@/providers/bridge/client"
import { isBridgeConfigured } from "@/providers/bridge/config"
import { describeBridgeError, isBridgeUnknownOutcomeError } from "@/providers/bridge/errors"
import { bridgeExternalAccountIdempotencyKey } from "@/providers/bridge/idempotency"
import { normalizeBridgeExternalAccount } from "@/providers/bridge/normalizeMoneyMovement"
import type { NormalizedBridgeConnectionEvent } from "@/providers/bridge/translateEvent"
import type { BridgeExternalAccount } from "@/providers/bridge/types"

/** The safe, merchant-facing projection of a saved bank destination. */
export type MerchantBankDestinationView = {
  id: string
  label: string
  bankName: string | null
  accountLast4: string | null
  accountKind: "checking" | "savings" | null
  /** PineTree status vocabulary only. Never a provider status string. */
  status: "Ready" | "Being verified" | "Action required"
  usable: boolean
  isDefault: boolean
  lastUsedAt: string | null
  createdAt: string
}

export function projectBankDestination(row: MerchantBankDestination): MerchantBankDestinationView {
  const status: MerchantBankDestinationView["status"] = row.status === "active"
    ? "Ready"
    : row.provider_deactivation_reason
      ? "Action required"
      : "Being verified"

  return {
    id: row.id,
    label: row.label || `${row.bank_name || "Bank account"}${row.account_last4 ? ` ····${row.account_last4}` : ""}`,
    bankName: row.bank_name,
    accountLast4: row.account_last4,
    accountKind: row.account_kind,
    status,
    usable: row.status === "active" && !row.archived_at,
    isDefault: row.is_default,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  }
}

export type BankDestinationFailure = {
  ok: false
  error: string
  retryable: boolean
  correlationId: string
}

function failure(error: string, correlationId: string, retryable = false): BankDestinationFailure {
  return { ok: false, error, retryable, correlationId }
}

export async function listBankDestinationsEngine(args: {
  merchantId: string
}): Promise<{ ok: true; destinations: MerchantBankDestinationView[] } | BankDestinationFailure> {
  const correlationId = randomUUID()
  try {
    const rows = await listMerchantBankDestinations(args.merchantId)
    return { ok: true, destinations: rows.map(projectBankDestination) }
  } catch (error) {
    console.error("[bank-destinations] list_failed", { correlationId, ...describeBridgeError(error) })
    return failure("Unable to load your bank accounts right now.", correlationId, true)
  }
}

export type LinkBankAccountInput = {
  merchantId: string
  actorId?: string | null
  label?: string | null
  bankName: string
  accountOwnerName: string
  routingNumber: string
  /** Raw account number. Request-scoped; never persisted or logged. */
  accountNumber: string
  accountKind: "checking" | "savings"
}

const US_ROUTING_NUMBER = /^\d{9}$/
const US_ACCOUNT_NUMBER = /^\d{4,17}$/

/**
 * Link a US bank account.
 *
 * Order of operations is deliberate:
 *   1. validate locally, so an obviously wrong number never leaves PineTree;
 *   2. reserve a PineTree row, whose id seeds the provider idempotency key;
 *   3. submit to the provider;
 *   4. persist only the identifier and the masked last four it returned.
 *
 * A timeout between 2 and 3 is UNKNOWN, not a failure: the same reserved row is
 * reused on retry, so the identical idempotency key is resent and the bank
 * account cannot be registered twice.
 */
export async function linkBankDestinationEngine(
  input: LinkBankAccountInput
): Promise<{ ok: true; destination: MerchantBankDestinationView } | BankDestinationFailure> {
  const correlationId = randomUUID()

  if (!isBridgeConfigured()) {
    return failure("Bank withdrawals are not available yet.", correlationId)
  }

  const routingNumber = String(input.routingNumber || "").replace(/\D/g, "")
  const accountNumber = String(input.accountNumber || "").replace(/\D/g, "")
  const bankName = String(input.bankName || "").trim()
  const accountOwnerName = String(input.accountOwnerName || "").trim()

  if (!US_ROUTING_NUMBER.test(routingNumber)) {
    return failure("Enter a valid 9-digit routing number.", correlationId)
  }
  if (!US_ACCOUNT_NUMBER.test(accountNumber)) {
    return failure("Enter a valid bank account number.", correlationId)
  }
  if (!bankName) return failure("Enter the name of your bank.", correlationId)
  if (accountOwnerName.length < 3) {
    return failure("Enter the name on the bank account.", correlationId)
  }

  const connectionRow = await getMerchantBridgeConnection(input.merchantId).catch(() => null)
  const customerId = String(connectionRow?.credentials?.bridge_customer_id || "").trim()
  if (!customerId) {
    return failure(
      "Finish your Business Profile verification before adding a bank account.",
      correlationId
    )
  }

  let profile: Awaited<ReturnType<typeof getMerchantBusinessProfile>>
  try {
    profile = await getMerchantBusinessProfile(input.merchantId)
  } catch (error) {
    console.error("[bank-destinations] profile_read_failed", {
      correlationId,
      ...describeBridgeError(error),
    })
    return failure("Unable to add this bank account right now.", correlationId, true)
  }

  const country = alpha3Country(profile.business_country)
  const street = String(profile.business_address_line1 || "").trim()
  const city = String(profile.business_city || "").trim()
  if (country !== "USA" || !street || !city) {
    return failure(
      "Add your US business address to your Business Profile before adding a bank account.",
      correlationId
    )
  }

  let reserved: MerchantBankDestination
  try {
    reserved = await reserveMerchantBankDestination({
      merchantId: input.merchantId,
      label: String(input.label || bankName).trim().slice(0, 80),
      bankName,
      accountOwnerName,
      accountKind: input.accountKind,
    })
  } catch (error) {
    console.error("[bank-destinations] reserve_failed", { correlationId, ...describeBridgeError(error) })
    return failure("Unable to add this bank account right now.", correlationId, true)
  }

  try {
    const result = await createExternalAccount({
      customerId,
      bankName,
      accountName: reserved.label || undefined,
      accountOwnerName,
      accountOwnerType: "business",
      businessName: String(profile.legal_business_name || accountOwnerName).trim(),
      routingNumber,
      accountNumber,
      checkingOrSavings: input.accountKind,
      address: {
        street_line_1: street.slice(0, 35),
        ...(profile.business_address_line2
          ? { street_line_2: String(profile.business_address_line2).slice(0, 35) }
          : {}),
        city,
        ...(profile.business_state ? { state: String(profile.business_state) } : {}),
        ...(profile.business_postal_code ? { postal_code: String(profile.business_postal_code) } : {}),
        country,
      },
      idempotencyKey: bridgeExternalAccountIdempotencyKey({
        merchantId: input.merchantId,
        destinationId: reserved.id,
      }),
      context: { correlationId, merchantId: input.merchantId },
    })

    const normalized = normalizeBridgeExternalAccount(result.data)
    const activated = await activateMerchantBankDestination({
      merchantId: input.merchantId,
      id: reserved.id,
      providerExternalAccountId: normalized.externalAccountId,
      bankName: normalized.bankName,
      accountOwnerName: normalized.accountOwnerName,
      accountLast4: normalized.last4,
      accountKind: normalized.checkingOrSavings ?? input.accountKind,
      active: normalized.active,
    })

    await insertMerchantAuditEvent({
      merchantId: input.merchantId,
      eventType: "wallet.bank_destination_linked",
      actorId: input.actorId ?? null,
      metadata: {
        destination_id: activated.id,
        // Identifier and mask only - never the account number.
        account_last4: activated.account_last4,
        correlation_id: correlationId,
      },
    })

    return { ok: true, destination: projectBankDestination(activated) }
  } catch (error) {
    const unknown = isBridgeUnknownOutcomeError(error)
    console.error("[bank-destinations] provider_create_failed", {
      correlationId,
      merchantId: input.merchantId,
      destinationId: reserved.id,
      ...describeBridgeError(error),
    })

    if (!unknown) {
      // A verified rejection leaves no provider object, so the reserved row is
      // retired rather than left as a permanently unusable destination.
      await archiveMerchantBankDestination(input.merchantId, reserved.id, "provider_rejected").catch(
        () => undefined
      )
      return failure(
        "Your bank could not be verified with those details. Check the routing and account numbers and try again.",
        correlationId
      )
    }

    return failure(
      "That request did not complete in time. Nothing was lost - try again in a moment.",
      correlationId,
      true
    )
  }
}

/**
 * Remove a bank destination.
 *
 * Deactivate-not-delete, matching the provider's own semantics: payout history
 * already references this destination, and every settlement route bound to it
 * is archived in the same operation so a later withdrawal cannot reuse a route
 * pointing at a removed bank account.
 */
export async function removeBankDestinationEngine(args: {
  merchantId: string
  destinationId: string
  actorId?: string | null
}): Promise<{ ok: true } | BankDestinationFailure> {
  const correlationId = randomUUID()

  let destination: MerchantBankDestination | null
  try {
    destination = await getMerchantBankDestination(args.merchantId, args.destinationId)
  } catch (error) {
    console.error("[bank-destinations] read_failed", { correlationId, ...describeBridgeError(error) })
    return failure("Unable to remove this bank account right now.", correlationId, true)
  }
  if (!destination || destination.archived_at) {
    return failure("Bank account not found.", correlationId)
  }

  const connectionRow = await getMerchantBridgeConnection(args.merchantId).catch(() => null)
  const customerId = String(connectionRow?.credentials?.bridge_customer_id || "").trim()

  if (customerId && destination.provider_external_account_id) {
    try {
      await deactivateExternalAccount({
        customerId,
        externalAccountId: destination.provider_external_account_id,
        idempotencyKey: `${bridgeExternalAccountIdempotencyKey({
          merchantId: args.merchantId,
          destinationId: destination.id,
        })}.deactivate`,
        context: { correlationId, merchantId: args.merchantId },
      })
    } catch (error) {
      // The merchant asked PineTree to stop using this account. Archiving
      // locally already guarantees that, so a provider-side failure is logged
      // for reconciliation rather than blocking the merchant.
      console.warn("[bank-destinations] provider_deactivate_failed", {
        correlationId,
        ...describeBridgeError(error),
      })
    }
  }

  try {
    await archiveLiquidationRoutesForDestination(args.merchantId, destination.id)
    await archiveMerchantBankDestination(args.merchantId, destination.id, "removed_by_merchant")
  } catch (error) {
    console.error("[bank-destinations] archive_failed", { correlationId, ...describeBridgeError(error) })
    return failure("Unable to remove this bank account right now.", correlationId, true)
  }

  await insertMerchantAuditEvent({
    merchantId: args.merchantId,
    eventType: "wallet.bank_destination_removed",
    actorId: args.actorId ?? null,
    metadata: { destination_id: destination.id, correlation_id: correlationId },
  })

  return { ok: true }
}

/**
 * Apply a verified `external_account` webhook.
 *
 * The payload is only a signal that something changed; the state PineTree
 * stores comes from re-reading the provider. A destination the merchant already
 * archived is never resurrected.
 */
export async function applyBridgeExternalAccountEventEngine(input: {
  merchantId: string
  event: NormalizedBridgeConnectionEvent
  payload: unknown
  correlationId: string
}): Promise<{ applied: boolean; reason: string }> {
  const externalAccountId = String(input.event.externalAccountId || "").trim()
  if (!externalAccountId) return { applied: false, reason: "unresolved_merchant" }

  const destination = await findBankDestinationByProviderId(externalAccountId).catch(() => null)
  if (!destination || destination.merchant_id !== input.merchantId) {
    return { applied: false, reason: "unresolved_merchant" }
  }
  if (destination.archived_at) return { applied: false, reason: "no_matching_withdrawal" }

  const connectionRow = await getMerchantBridgeConnection(input.merchantId).catch(() => null)
  const customerId = String(connectionRow?.credentials?.bridge_customer_id || "").trim()
  if (!customerId) return { applied: false, reason: "state_reread_failed" }

  let account: BridgeExternalAccount | null = null
  try {
    const result = await listExternalAccounts({
      customerId,
      context: { correlationId: input.correlationId, merchantId: input.merchantId },
    })
    account =
      bridgeListItems<BridgeExternalAccount>(result.data).find(
        (entry) => String(entry.id || "").trim() === externalAccountId
      ) || null
  } catch (error) {
    console.error("[bank-destinations] webhook_state_reread_failed", {
      correlationId: input.correlationId,
      ...describeBridgeError(error),
    })
    return { applied: false, reason: "state_reread_failed" }
  }

  if (!account) return { applied: false, reason: "state_reread_failed" }

  const normalized = normalizeBridgeExternalAccount(account)
  await applyProviderBankDestinationState({
    id: destination.id,
    active: normalized.active,
    deactivationReason: normalized.deactivationReason,
    accountLast4: normalized.last4,
  })

  await insertMerchantAuditEvent({
    merchantId: input.merchantId,
    eventType: "wallet.bank_destination_state_synced",
    metadata: {
      destination_id: destination.id,
      active: normalized.active,
      correlation_id: input.correlationId,
    },
  })

  return { applied: true, reason: "applied" }
}
