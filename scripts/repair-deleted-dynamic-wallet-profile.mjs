import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createClient } from "@supabase/supabase-js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const merchantId = process.argv.find((arg) => arg.startsWith("--merchant-id="))?.split("=")[1] ||
  "ca4168eb-6e8d-4c47-9d9d-7c371b046368"
const shouldReset = process.argv.includes("--reset")

function loadDotenv(file, options = {}) {
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (process.env[key] && !options.override) continue
    let value = rawValue.trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

loadDotenv(path.join(repoRoot, ".env"))
loadDotenv(path.join(repoRoot, ".env.local"), { override: true })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
}

const db = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function safeDbError(label, error) {
  const code = typeof error?.code === "string" ? error.code : "unknown"
  const message = typeof error?.message === "string"
    ? error.message.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    : "unknown"
  return new Error(`${label}: ${code}: ${message}`)
}

async function maybeSingle(table, column, value) {
  if (!value) return null
  const { data, error } = await db.from(table).select("*").eq(column, value).limit(1)
  if (error) throw safeDbError(`${table}.${column} lookup failed`, error)
  return Array.isArray(data) ? data[0] ?? null : null
}

async function count(table, apply) {
  const query = db.from(table).select("id", { count: "exact", head: true })
  const { count, error } = await apply(query)
  if (error) throw safeDbError(`${table} count failed`, error)
  return Number(count || 0)
}

async function countByMerchant(table) {
  return count(table, (query) => query.eq("merchant_id", merchantId))
}

async function countByMerchantAndAddresses(table, column, addresses) {
  if (!addresses.length) return 0
  return count(table, (query) => query.eq("merchant_id", merchantId).in(column, addresses))
}

const { data: profiles, error: profileError } = await db
  .from("pinetree_wallet_profiles")
  .select("*")
  .eq("merchant_id", merchantId)
  .limit(1)
if (profileError) throw safeDbError("pinetree_wallet_profiles lookup failed", profileError)

const profile = Array.isArray(profiles) ? profiles[0] ?? null : null
const profileId = profile?.id ? String(profile.id) : null
const addresses = [
  profile?.base_address ? String(profile.base_address).trim() : "",
  profile?.solana_address ? String(profile.solana_address).trim() : "",
].filter(Boolean)

const [baseOwner, solanaOwner] = await Promise.all([
  maybeSingle("pinetree_wallet_profiles", "base_address", addresses[0]),
  maybeSingle("pinetree_wallet_profiles", "solana_address", addresses[1]),
])

const [
  walletOperationsCount,
  walletOperationEventsCount,
  withdrawalCount,
  profileWithdrawalCount,
  ledgerAddressCount,
  paymentAddressCount,
] = await Promise.all([
  countByMerchant("wallet_operations"),
  countByMerchant("wallet_operation_events"),
  countByMerchant("wallet_withdrawal_requests"),
  profileId ? count("wallet_withdrawal_requests", (query) => query.eq("wallet_profile_id", profileId)) : 0,
  countByMerchantAndAddresses("ledger_entries", "wallet_address", addresses),
  countByMerchantAndAddresses("payments", "payment_url", addresses),
])

const hasWalletOperations = walletOperationsCount > 0 || walletOperationEventsCount > 0
const hasWithdrawals = withdrawalCount > 0 || profileWithdrawalCount > 0
const hasLedgerHistory = ledgerAddressCount > 0
const hasPaymentHistory = paymentAddressCount > 0
const hasFinancialHistory = hasWalletOperations || hasWithdrawals || hasLedgerHistory || hasPaymentHistory
const profileStatus = profile?.status ? String(profile.status) : null
const nonReadyStatus = !profileStatus || !["ready"].includes(profileStatus)
const safeToReset = Boolean(profile && !hasFinancialHistory)

const report = {
  profileExists: Boolean(profile),
  profileStatus,
  hasDynamicUserId: Boolean(profile?.dynamic_user_id),
  hasBaseAddress: Boolean(profile?.base_address),
  hasSolanaAddress: Boolean(profile?.solana_address),
  hasWalletOperations,
  hasWithdrawals,
  hasLedgerHistory,
  hasPaymentHistory,
  safeToReset,
}

if (shouldReset && safeToReset) {
  const { error } = await db
    .from("pinetree_wallet_profiles")
    .update({
      dynamic_user_id: null,
      dynamic_email: null,
      base_address: null,
      solana_address: null,
      status: "not_created",
      updated_at: new Date().toISOString(),
    })
    .eq("merchant_id", merchantId)
  if (error) throw new Error("pinetree_wallet_profiles reset failed")
  report.resetApplied = true
} else {
  report.resetApplied = false
}

report.protectedExistingProfile = Boolean(profile && !safeToReset)
report.baseAddressOwnedBySameMerchant = Boolean(baseOwner?.merchant_id === merchantId)
report.solanaAddressOwnedBySameMerchant = Boolean(solanaOwner?.merchant_id === merchantId)
report.baseAddressOwnedByAnotherMerchant = Boolean(baseOwner && baseOwner.merchant_id !== merchantId)
report.solanaAddressOwnedByAnotherMerchant = Boolean(solanaOwner && solanaOwner.merchant_id !== merchantId)
report.profileWasReady = profileStatus === "ready"
report.profileWasNonReady = nonReadyStatus

console.log(JSON.stringify(report, null, 2))
