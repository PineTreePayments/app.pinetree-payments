import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import { getProviderMetadata } from "@/engine/providerRegistry"
import { loadProviders } from "@/engine/loadProviders"

export async function GET(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)
    await loadProviders()

    const secretKeyConfigured = Boolean(
      String(process.env.STRIPE_SECRET_KEY || "").trim()
    )
    const publishableKeyConfigured = Boolean(
      String(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "").trim()
    )
    const webhookSecretConfigured = Boolean(
      String(process.env.STRIPE_WEBHOOK_SECRET || "").trim()
    )
    const adapterRegistered = Boolean(getProviderMetadata("stripe"))

    return NextResponse.json({
      stripe: {
        secretKeyConfigured,
        publishableKeyConfigured,
        webhookSecretConfigured,
        adapterRegistered,
        webhookRoute: "/api/webhooks/stripe",
      },
    })
  } catch (err) {
    const status = getRouteErrorStatus(err)
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status })
  }
}
