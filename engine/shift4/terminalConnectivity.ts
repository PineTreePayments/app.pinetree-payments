/**
 * The evidence resolver for Shift4 terminal connectivity.
 *
 * `terminalReadiness.ts` is the pure state machine and stays that way; this
 * module is the one place that reads persisted evidence out of the database and
 * hands it to that machine. Keeping them apart is what lets the projector and
 * its tests be exercised without a database at all.
 *
 * It performs NO provider request. Sending `/devices/getstatus` is an explicit
 * operator action handled by `deviceStatus.ts`; this module only reads what
 * such a check previously recorded, and applies the freshness window so an
 * expired answer cannot be reported as current connectivity.
 */

import { listMerchantTerminalReaders } from "@/database/merchantTerminalReaders"

import {
  readShift4ReaderConnectivity,
  SHIFT4_TERMINAL_CONNECTIVITY_UNVERIFIED,
  type Shift4TerminalConnectivityEvidence,
} from "./terminalReadiness"

const SHIFT4_PROVIDER_KEY = "shift4"

/**
 * Resolve merchant-level terminal connectivity.
 *
 * A merchant may own several readers, so "the merchant's connectivity" needs a
 * rule. The rule is the merchant default when one is marked, otherwise the
 * first reader in creation order — the same deterministic choice the rest of
 * the Retail surface makes. Per-reader truth is available through
 * `readShift4ReaderConnectivity`, and the admin check is always per reader.
 *
 * A database failure yields `unverified` rather than propagating: readiness
 * must be able to report "not verified" without the whole surface erroring, and
 * `unverified` is never mistaken for available.
 */
export async function resolveShift4TerminalConnectivity(
  merchantId: string,
  now: Date = new Date()
): Promise<Shift4TerminalConnectivityEvidence> {
  let readers
  try {
    readers = await listMerchantTerminalReaders(merchantId, SHIFT4_PROVIDER_KEY)
  } catch {
    return SHIFT4_TERMINAL_CONNECTIVITY_UNVERIFIED
  }

  if (!readers || readers.length === 0) return SHIFT4_TERMINAL_CONNECTIVITY_UNVERIFIED

  const chosen = readers.find((reader) => reader.is_default) ?? readers[0]
  return readShift4ReaderConnectivity(chosen, now)
}
