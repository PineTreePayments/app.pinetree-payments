import fs from "node:fs"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"

const OFFICIAL_ADMIN_EMAIL = "joshuaduskin@outlook.com"
const ADMIN_LIKE_ROLES = ["admin", "super_admin", "developer", "staff", "support"]

function loadEnvFile(fileName) {
  const filePath = path.join(process.cwd(), fileName)
  if (!fs.existsSync(filePath)) return

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const separator = trimmed.indexOf("=")
    if (separator < 0) continue

    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase()
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

async function findAuthUserByEmail(admin, email) {
  for (let page = 1; page <= 20; page += 1) {
    let result
    const originalConsoleError = console.error
    try {
      console.error = () => {}
      result = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    } catch {
      throw new Error("Failed to list Supabase auth users")
    } finally {
      console.error = originalConsoleError
    }

    const { data, error } = result
    if (error) throw new Error("Failed to list Supabase auth users")

    const match = data.users.find((user) => normalizeEmail(user.email) === email)
    if (match) return match
    if (data.users.length < 1000) return null
  }

  throw new Error("Supabase auth user lookup exceeded the expected page limit")
}

async function main() {
  loadEnvFile(".env")
  loadEnvFile(".env.local")

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL")
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY")
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  const authUser = await findAuthUserByEmail(admin, OFFICIAL_ADMIN_EMAIL)
  if (!authUser) {
    console.log("Official auth user not found. Recreate it through the normal signup or invitation flow, then rerun this script.")
    process.exitCode = 2
    return
  }

  const { data: existingMerchant, error: existingError } = await admin
    .from("merchants")
    .select("business_name,status")
    .eq("id", authUser.id)
    .maybeSingle()

  if (existingError) {
    throw new Error("Failed to inspect the official merchant row")
  }

  const now = new Date().toISOString()
  const { error: upsertError } = await admin
    .from("merchants")
    .upsert(
      {
        id: authUser.id,
        email: OFFICIAL_ADMIN_EMAIL,
        business_name: existingMerchant?.business_name || "PineTree Administration",
        status: existingMerchant?.status || "active",
        role: "admin",
        updated_at: now,
        ...(!existingMerchant ? { created_at: now } : {}),
      },
      { onConflict: "id" }
    )

  if (upsertError) {
    throw new Error("Failed to restore the official admin merchant row")
  }

  const { error: demoteError, count: demotedCount } = await admin
    .from("merchants")
    .update({ role: "merchant", updated_at: now }, { count: "exact" })
    .in("role", ADMIN_LIKE_ROLES)
    .neq("id", authUser.id)

  if (demoteError) {
    throw new Error("Failed to remove non-official admin-like merchant roles")
  }

  const { count: remainingAdminLike, error: verifyError } = await admin
    .from("merchants")
    .select("id", { count: "exact", head: true })
    .in("role", ADMIN_LIKE_ROLES)
    .neq("id", authUser.id)

  if (verifyError) {
    throw new Error("Failed to verify admin exclusivity")
  }

  console.log(JSON.stringify({
    officialAuthUserFound: true,
    officialMerchantRowRestored: true,
    nonOfficialAdminLikeRowsDemoted: demotedCount ?? 0,
    remainingNonOfficialAdminLikeRows: remainingAdminLike ?? 0,
  }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Admin restoration failed")
  process.exit(1)
})
