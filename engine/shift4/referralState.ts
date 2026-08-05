/**
 * Is a Shift4 Retail payment sitting on an unresolved voice referral?
 *
 * A referral is `transaction.responseCode = R`: the issuer will not approve
 * without a phone call. This is the single place that decides, from persisted
 * attempt lineage alone, whether a clerk still has work to do on a payment.
 *
 * ── Why it lives in the Engine ───────────────────────────────────────────────
 * The POS route that answers this question is a thin authenticated adapter. The
 * lifecycle rules — what counts as a referral, what resolves one, and in what
 * order — are Shift4 lifecycle logic and belong next to the rest of it, where
 * they can be executed in tests without a database.
 *
 * ── Order is the whole point ─────────────────────────────────────────────────
 * "Does a referral row exist?" is the wrong question. A payment can be referred,
 * manually authorized, captured, and then referred AGAIN on a later tender. What
 * matters is whether anything resolved the payment *after* the most recent
 * unsettled referral, so attempts are ordered chronologically and read as a
 * lineage rather than as a set.
 *
 * This module is pure: no database, no network, no clock.
 */

import { SHIFT4_REFERRAL_RESPONSE_CODE } from "./manualAuthorization"

/**
 * The only attempt fields this decision reads. Deliberately a structural subset
 * of `Shift4PaymentAttemptRow` so the route can pass stored rows straight in.
 */
export type Shift4ReferralLineageRow = Readonly<{
  channel: string
  attempt_role: string
  response_code: string | null
  state: string
  created_at?: string | null
  id?: string | number | null
}>

export type Shift4ReferralClassification = Readonly<{
  /**
   * Does this payment have Shift4 Retail attempt lineage at all?
   *
   * False for a Stripe, FluidPay or crypto sale, which have no rows here. The
   * POS uses this to stop asking about a payment that can never be referred.
   */
  shift4Retail: boolean
  /** Does a clerk need to telephone the issuer and enter a code right now? */
  referralRequired: boolean
}>

/** A referral in one of these states is finished and needs no clerk action. */
const SETTLED_STATES: ReadonlySet<string> = new Set(["approved", "declined", "abandoned"])

const NOT_SHIFT4_RETAIL: Shift4ReferralClassification = Object.freeze({
  shift4Retail: false,
  referralRequired: false,
})

const RETAIL_NO_REFERRAL: Shift4ReferralClassification = Object.freeze({
  shift4Retail: true,
  referralRequired: false,
})

const RETAIL_REFERRAL_REQUIRED: Shift4ReferralClassification = Object.freeze({
  shift4Retail: true,
  referralRequired: true,
})

/** The documented referral test, identical to `assertShift4ReferralLineage`. */
function isReferralAttempt(row: Shift4ReferralLineageRow): boolean {
  return (
    row.attempt_role === "referral_authorization" ||
    row.response_code === SHIFT4_REFERRAL_RESPONSE_CODE
  )
}

/**
 * Oldest first. `created_at` is authoritative; `id` only breaks ties so two
 * attempts written in the same instant still order deterministically.
 */
function chronologically(
  a: Shift4ReferralLineageRow,
  b: Shift4ReferralLineageRow
): number {
  const left = String(a.created_at ?? "")
  const right = String(b.created_at ?? "")
  if (left !== right) return left < right ? -1 : 1
  return String(a.id ?? "").localeCompare(String(b.id ?? ""))
}

/**
 * Decide whether a clerk must act on this payment.
 *
 * `referralRequired` is true only when the most recent unsettled Retail referral
 * has nothing approved after it. An approved manual authorization, capture, void
 * or replacement sale therefore closes the workflow, while a *declined* manual
 * authorization deliberately does not — a wrong code has to be re-enterable.
 *
 * E-commerce referrals are excluded outright: they are not a clerk's job.
 */
export function classifyShift4ReferralState(
  rows: readonly Shift4ReferralLineageRow[]
): Shift4ReferralClassification {
  const retail = rows.filter((row) => row.channel === "retail")
  if (retail.length === 0) return NOT_SHIFT4_RETAIL

  const ordered = [...retail].sort(chronologically)

  let latestOpenReferral = -1
  for (let index = 0; index < ordered.length; index += 1) {
    const row = ordered[index]
    if (isReferralAttempt(row) && !SETTLED_STATES.has(row.state)) {
      latestOpenReferral = index
    }
  }
  if (latestOpenReferral === -1) return RETAIL_NO_REFERRAL

  // Anything approved after the referral means the payment already moved on.
  for (let index = latestOpenReferral + 1; index < ordered.length; index += 1) {
    if (ordered[index].state === "approved") return RETAIL_NO_REFERRAL
  }

  return RETAIL_REFERRAL_REQUIRED
}
