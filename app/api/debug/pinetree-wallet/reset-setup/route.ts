import { type NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { supabase, supabaseAdmin } from "@/database/supabase"

const db = supabaseAdmin || supabase
const cryptoProviderRows = ["base", "solana", "lightning_speed"]

function resetEnabled() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.PINETREE_WALLET_DEBUG_RESET_ENABLED === "true" ||
    process.env.NEXT_PUBLIC_PINE_TREE_WALLET_DEBUG === "true" ||
    process.env.NEXT_PUBLIC_PINETREE_WALLET_DEBUG === "true"
  )
}

async function deleteForMerchant(table: string, merchantId: string) {
  const { error } = await db
    .from(table)
    .delete()
    .eq("merchant_id", merchantId)

  if (error) {
    throw new Error(`Failed clearing ${table}: ${error.message}`)
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!resetEnabled()) {
      return NextResponse.json({ error: "Wallet setup reset is disabled" }, { status: 404 })
    }

    const adminId = await requireAdminFromRequest(req)
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const merchantId = typeof body.merchant_id === "string" && body.merchant_id.trim()
      ? body.merchant_id.trim()
      : adminId

    await deleteForMerchant("pinetree_wallet_profiles", merchantId)

    const { error: providersError } = await db
      .from("merchant_providers")
      .delete()
      .eq("merchant_id", merchantId)
      .in("provider", cryptoProviderRows)

    if (providersError) {
      throw new Error(`Failed clearing merchant_providers: ${providersError.message}`)
    }

    await deleteForMerchant("wallet_balances", merchantId)

    console.warn("[pinetree-wallets] setup_reset", {
      adminId,
      merchantId,
      cleared: {
        pinetree_wallet_profiles: true,
        merchant_providers: cryptoProviderRows,
        wallet_balances: true,
      },
      untouched: ["payments", "ledger", "transactions"],
    })

    return NextResponse.json({
      ok: true,
      merchantId,
      cleared: {
        pinetree_wallet_profiles: true,
        merchant_providers: cryptoProviderRows,
        wallet_balances: true,
      },
      untouched: ["payments", "ledger", "transactions"],
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reset PineTree Wallet setup" },
      { status: getRouteErrorStatus(error) }
    )
  }
}
