import {
  createSweepRule,
  updateSweepRule,
  getSweepRule,
  listSweepRulesForMerchant,
  getEnabledSweepRuleForAsset,
  type WalletSweepRule,
  type SweepRail,
  type SweepAsset,
  type SweepMode,
} from "@/database/walletSweepRules"
import { getWithdrawalDestination } from "@/database/merchantWithdrawalDestinations"
import { insertMerchantAuditEvent } from "@/database/merchantAuditEvents"
import { sendWalletSecurityNotification } from "@/lib/email/sendWalletSecurityNotification"

/**
 * The exact phrase a merchant must type to enable an automatic sweep rule.
 * This is the server-enforced substitute for the reauth/email-code system
 * this repo does not have (see docs/environment/wallet-sweep-env-checklist.md)
 * - never trust client-only enforcement of this text.
 */
export const SWEEP_RULE_ACKNOWLEDGMENT_PHRASE = "I understand automatic transfers"

function validateAcknowledgment(acknowledgmentText: string): void {
  if (String(acknowledgmentText || "").trim() !== SWEEP_RULE_ACKNOWLEDGMENT_PHRASE) {
    throw Object.assign(
      new Error(`Type "${SWEEP_RULE_ACKNOWLEDGMENT_PHRASE}" exactly to enable automatic sweeps.`),
      { status: 400 }
    )
  }
}

function validateModeFields(mode: SweepMode, thresholdAmountDecimal?: string | null, scheduledTimeUtc?: string | null): void {
  if (mode === "threshold" && !thresholdAmountDecimal) {
    throw Object.assign(new Error("A threshold amount is required for threshold mode."), { status: 400 })
  }
  if (mode === "daily" && !scheduledTimeUtc) {
    throw Object.assign(new Error("A scheduled time is required for daily mode."), { status: 400 })
  }
}

async function assertDestinationReadyForSweep(
  merchantId: string,
  destinationId: string,
  rail: SweepRail,
  asset: SweepAsset
): Promise<void> {
  const destination = await getWithdrawalDestination(merchantId, destinationId)
  if (!destination || destination.archived_at) {
    throw Object.assign(new Error("Saved destination not found."), { status: 404 })
  }
  if (destination.rail !== rail || destination.asset !== asset) {
    throw Object.assign(new Error("Saved destination does not match the selected asset and network."), { status: 400 })
  }
  if (!destination.is_enabled) {
    throw Object.assign(new Error("This saved destination is disabled."), { status: 409 })
  }
  if (destination.confirmation_status !== "confirmed") {
    throw Object.assign(
      new Error("This destination must be confirmed before it can back an automatic sweep rule."),
      { status: 409 }
    )
  }
}

async function notifySweepRuleEnabled(merchantId: string, rule: WalletSweepRule): Promise<void> {
  try {
    const { getMerchantById } = await import("@/database/merchants")
    const merchant = await getMerchantById(merchantId).catch(() => null)
    const destination = await getWithdrawalDestination(merchantId, rule.destination_id).catch(() => null)
    await sendWalletSecurityNotification({
      merchantEmail: merchant?.email ?? null,
      kind: "sweep_rule_enabled",
      summary: "Automatic sweeps were enabled on your PineTree Wallet.",
      details: [
        { label: "Asset", value: `${rule.asset} · ${rule.rail}` },
        { label: "Mode", value: rule.mode },
        { label: "Destination", value: destination?.label || destination?.destination_address || "(unknown)" },
      ],
    })
  } catch (error) {
    console.warn("[walletSweepRules] security notification failed", error)
  }
}

export type CreateSweepRuleRequest = {
  rail: SweepRail
  asset: SweepAsset
  destinationId: string
  mode: SweepMode
  thresholdAmountDecimal?: string | null
  scheduledTimeUtc?: string | null
  minRemainingReserveDecimal?: string
  maxDailySweepUsd?: number | null
  isEnabled?: boolean
  acknowledgmentText: string
}

export async function createMerchantSweepRule(
  merchantId: string,
  input: CreateSweepRuleRequest
): Promise<WalletSweepRule> {
  validateModeFields(input.mode, input.thresholdAmountDecimal, input.scheduledTimeUtc)
  await assertDestinationReadyForSweep(merchantId, input.destinationId, input.rail, input.asset)

  if (input.isEnabled) {
    validateAcknowledgment(input.acknowledgmentText)
    const existing = await getEnabledSweepRuleForAsset(merchantId, input.rail, input.asset, input.mode)
    if (existing) {
      throw Object.assign(
        new Error("An enabled automatic sweep rule already exists for this asset and network."),
        { status: 409 }
      )
    }
  }

  const rule = await createSweepRule({
    merchantId,
    rail: input.rail,
    asset: input.asset,
    destinationId: input.destinationId,
    mode: input.mode,
    thresholdAmountDecimal: input.thresholdAmountDecimal ?? null,
    scheduledTimeUtc: input.scheduledTimeUtc ?? null,
    minRemainingReserveDecimal: input.minRemainingReserveDecimal,
    maxDailySweepUsd: input.maxDailySweepUsd ?? null,
    acknowledgmentText: input.isEnabled ? input.acknowledgmentText.trim() : "",
    isEnabled: Boolean(input.isEnabled),
  })

  void insertMerchantAuditEvent({
    merchantId,
    eventType: "sweep_rule.created",
    metadata: { rule_id: rule.id, rail: rule.rail, asset: rule.asset, mode: rule.mode, is_enabled: rule.is_enabled },
  })
  if (rule.is_enabled) {
    void insertMerchantAuditEvent({
      merchantId,
      eventType: "sweep_rule.enabled",
      metadata: { rule_id: rule.id },
    })
    void notifySweepRuleEnabled(merchantId, rule)
  }

  return rule
}

export type UpdateSweepRuleRequest = {
  isEnabled?: boolean
  mode?: SweepMode
  thresholdAmountDecimal?: string | null
  scheduledTimeUtc?: string | null
  minRemainingReserveDecimal?: string
  maxDailySweepUsd?: number | null
  acknowledgmentText?: string
}

export async function updateMerchantSweepRule(
  merchantId: string,
  id: string,
  input: UpdateSweepRuleRequest
): Promise<WalletSweepRule> {
  const existing = await getSweepRule(merchantId, id)
  if (!existing) throw Object.assign(new Error("Sweep rule not found."), { status: 404 })

  const nextMode = input.mode ?? existing.mode
  const nextThreshold = input.thresholdAmountDecimal !== undefined ? input.thresholdAmountDecimal : existing.threshold_amount_decimal
  const nextScheduled = input.scheduledTimeUtc !== undefined ? input.scheduledTimeUtc : existing.scheduled_time_utc
  validateModeFields(nextMode, nextThreshold, nextScheduled)

  const transitioningToEnabled = input.isEnabled === true && !existing.is_enabled
  let acknowledgedAt: string | undefined
  let acknowledgmentText: string | undefined

  if (transitioningToEnabled) {
    validateAcknowledgment(input.acknowledgmentText || "")
    await assertDestinationReadyForSweep(merchantId, existing.destination_id, existing.rail, existing.asset)
    const conflict = await getEnabledSweepRuleForAsset(merchantId, existing.rail, existing.asset, nextMode)
    if (conflict && conflict.id !== existing.id) {
      throw Object.assign(
        new Error("An enabled automatic sweep rule already exists for this asset and network."),
        { status: 409 }
      )
    }
    acknowledgedAt = new Date().toISOString()
    acknowledgmentText = input.acknowledgmentText!.trim()
  }

  const rule = await updateSweepRule(merchantId, id, {
    isEnabled: input.isEnabled,
    mode: input.mode,
    thresholdAmountDecimal: input.thresholdAmountDecimal,
    scheduledTimeUtc: input.scheduledTimeUtc,
    minRemainingReserveDecimal: input.minRemainingReserveDecimal,
    maxDailySweepUsd: input.maxDailySweepUsd,
    acknowledgmentText,
    acknowledgedAt,
  })

  void insertMerchantAuditEvent({
    merchantId,
    eventType: "sweep_rule.updated",
    metadata: { rule_id: rule.id, changes: input },
  })
  if (transitioningToEnabled) {
    void insertMerchantAuditEvent({ merchantId, eventType: "sweep_rule.enabled", metadata: { rule_id: rule.id } })
    void notifySweepRuleEnabled(merchantId, rule)
  } else if (input.isEnabled === false && existing.is_enabled) {
    void insertMerchantAuditEvent({ merchantId, eventType: "sweep_rule.disabled", metadata: { rule_id: rule.id } })
  }

  return rule
}

/**
 * Immediately pauses a rule - the "pause all automatic sweeps" safety
 * control the task requires. Idempotent (pausing an already-disabled rule
 * is a harmless no-op).
 */
export async function pauseMerchantSweepRule(merchantId: string, id: string): Promise<WalletSweepRule> {
  const existing = await getSweepRule(merchantId, id)
  if (!existing) throw Object.assign(new Error("Sweep rule not found."), { status: 404 })
  const rule = await updateSweepRule(merchantId, id, { isEnabled: false })
  if (existing.is_enabled) {
    void insertMerchantAuditEvent({ merchantId, eventType: "sweep_rule.disabled", metadata: { rule_id: id, reason: "paused" } })
  }
  return rule
}

export async function listMerchantSweepRules(merchantId: string): Promise<WalletSweepRule[]> {
  return listSweepRulesForMerchant(merchantId)
}

/**
 * Immediately pauses every enabled sweep rule for a merchant - the "pause
 * all automatic sweeps" panic-button control the task requires. Always
 * available with no confirmation friction.
 */
export async function pauseAllMerchantSweepRules(merchantId: string): Promise<{ paused: number }> {
  const rules = await listSweepRulesForMerchant(merchantId)
  const enabled = rules.filter((rule) => rule.is_enabled)
  await Promise.all(enabled.map((rule) => updateSweepRule(merchantId, rule.id, { isEnabled: false })))
  if (enabled.length) {
    void insertMerchantAuditEvent({
      merchantId,
      eventType: "sweep_rule.disabled",
      metadata: { reason: "pause_all", rule_ids: enabled.map((rule) => rule.id) },
    })
  }
  return { paused: enabled.length }
}
