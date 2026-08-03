/**
 * Canonical Admin display naming.
 *
 * Every Admin surface — Overview, Transaction Explorer, Platform Reports, the
 * shared Transaction Detail panel — renders provider, rail, network and
 * payment-source text through these four functions. No Admin page may keep a
 * label map of its own.
 *
 * Presentation only. Stored provider/rail/network/channel values, filter query
 * values, API contracts and reconciliation identifiers are untouched: these
 * functions are applied at the render boundary, never before a comparison.
 *
 * Where a naming table already existed it is reused rather than copied:
 *  - provider and network names come from components/dashboard/displayHelpers,
 *    the repo's existing shared presentation layer (also used by merchant
 *    screens), so Admin and merchant surfaces cannot drift.
 *  - payment source comes from lib/utils/paymentSource, the same module the
 *    engine uses to project `paymentSource` onto the canonical record.
 *
 * Rail is the one genuinely new vocabulary here, because PineTree had no rail
 * formatter and rails must stay distinct from providers.
 *
 * ── Four separate concepts ───────────────────────────────────────────────────
 *   provider  the commercial product that processed the payment  Base Pay
 *   rail      how the money settled                              Base
 *   network   the settlement network                             Base
 *   source    how the payment originated                         Terminal
 *
 * They are never interchangeable and no function reads another's vocabulary:
 *   - `formatProviderName` is the only one that may produce a product name.
 *   - `formatRailName` is a CLOSED vocabulary. A provider identifier in a rail
 *     field is bad data and renders "Unknown"; it is never title-cased into
 *     something that reads like a rail.
 *   - `formatNetworkName` is OPEN (new chains are legitimate), with documented
 *     legacy card-processor values normalized to "Card Network".
 *   - `formatPaymentSource` reads the stored channel and nothing else — never
 *     a provider, rail, or network — and leaves untagged rows unknown.
 *
 * "Payment Source" is the user-facing label for origin everywhere. "Stored
 * Source" is reserved for the raw `channel` value in Admin diagnostics.
 */

import {
  formatDashboardNetwork,
  formatDashboardProvider,
} from "@/components/dashboard/displayHelpers"
import { formatPaymentSource as formatCanonicalPaymentSource } from "@/lib/utils/paymentSource"

/** Empty/missing values render as an em dash in Admin tables. */
const EMPTY = "—"

function displayKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "")
}

/**
 * Provider — the commercial product that processed the payment.
 *
 * `lightning_speed` → "Bitcoin Lightning", `stripe` → "Stripe",
 * `base_pay` → "Base Pay". Unknown identifiers are title-cased rather than
 * shown raw, so a new provider key never leaks snake_case into the UI.
 */
export function formatProviderName(provider: string | null | undefined): string {
  if (!displayKey(provider)) return EMPTY
  return formatDashboardProvider(provider)
}

/** Shown when a rail field holds something that is not a rail. */
export const UNKNOWN_RAIL = "Unknown"

/**
 * Rail — how the money settled. A closed vocabulary, and deliberately NOT the
 * provider vocabulary: rail "Base" is settled by provider "Base Pay", and rail
 * "Card" is settled by Stripe, Shift4 or FluidPay.
 *
 * Every key below is a settlement identifier PineTree actually stores in a
 * rail/network column:
 *  - `base`, `solana`, `ethereum`, `cash`, `card` — the canonical rails
 *    `resolveRail` emits. `base` and `solana` happen to spell the same string
 *    as a provider key, but here they are chain names and resolve to the chain
 *    ("Base"), never to the product ("Base Pay").
 *  - `lightning`, `bitcoin_lightning`, `btc_lightning`, `lightning_btc` —
 *    documented legacy `payments.network` values; the same four are carried by
 *    NETWORK_DISPLAY_NAMES, which is what makes them stored rail data rather
 *    than provider keys.
 *  - `crypto`, `other`, `unknown` — the projector's unresolved rails.
 *
 * NO provider-only identifier appears here. A provider value that lands in a
 * rail field is bad data, so it renders as "Unknown" rather than being
 * title-cased into something that reads like a legitimate rail — a raw
 * `stripe` must never surface as "Stripe" in a rail column.
 */
const RAIL_DISPLAY_NAMES: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  base: "Base",
  solana: "Solana",
  ethereum: "Ethereum",
  crypto: "Crypto",
  bitcoinlightning: "Bitcoin Lightning",
  btclightning: "Bitcoin Lightning",
  lightningbtc: "Bitcoin Lightning",
  lightning: "Bitcoin Lightning",
  other: UNKNOWN_RAIL,
  unknown: UNKNOWN_RAIL,
}

export function formatRailName(rail: string | null | undefined): string {
  const key = displayKey(rail)
  // An absent rail and an unrecognized one are different: nothing to show
  // versus something that is not a rail.
  if (!key) return EMPTY
  return RAIL_DISPLAY_NAMES[key] ?? UNKNOWN_RAIL
}

/** True when the value belongs to the rail vocabulary at all. */
export function isKnownRail(rail: string | null | undefined): boolean {
  return Boolean(RAIL_DISPLAY_NAMES[displayKey(rail)])
}

/**
 * Network — the settlement network. Matches rail for chains, but a card
 * payment settles on the card networks rather than on a chain, so `card`
 * reads "Card Network" here and plain "Card" as a rail.
 *
 * `stripe`/`shift4`/`fluidpay` are here as a DOCUMENTED legacy normalization,
 * not as provider naming: card payments historically wrote the processor name
 * into `payments.network`, which is why `resolveRail` in
 * engine/canonicalTransactions.ts branches on `CARD_PROVIDERS.has(networkKey)`
 * and resolves that row to the Card rail. Raw-network surfaces (the stale
 * diagnostic reads `payments.network` directly) therefore render the card
 * network rather than leaking a processor name into a Network column.
 */
const NETWORK_OVERRIDES: Record<string, string> = {
  card: "Card Network",
  stripe: "Card Network",
  shift4: "Card Network",
  fluidpay: "Card Network",
}

/**
 * Unlike rail, the network vocabulary stays open: new chains are legitimate
 * stored values, so an unrecognized network is title-cased rather than
 * collapsed to "Unknown". The overrides above are what stop a known card
 * processor from being title-cased into a network name.
 */
export function formatNetworkName(network: string | null | undefined): string {
  const key = displayKey(network)
  if (!key) return EMPTY
  return NETWORK_OVERRIDES[key] ?? formatDashboardNetwork(network)
}

/**
 * Payment source — how the payment originated, from the canonical
 * transaction/payment channel field only. Never inferred from a provider.
 * Untagged historical rows read "Unknown source"; they are not defaulted into
 * Terminal or Online Checkout.
 */
export function formatPaymentSource(channel: string | null | undefined): string {
  return formatCanonicalPaymentSource(channel)
}

/**
 * Label a filter option or active filter pill without touching the value sent
 * to the API. `kind` picks the vocabulary so a network filter can never be
 * labelled with a provider name.
 */
export function formatFilterLabel(
  kind: "provider" | "rail" | "network" | "source",
  value: string | null | undefined
): string {
  switch (kind) {
    case "provider": return formatProviderName(value)
    case "rail": return formatRailName(value)
    case "network": return formatNetworkName(value)
    case "source": return formatPaymentSource(value)
  }
}
