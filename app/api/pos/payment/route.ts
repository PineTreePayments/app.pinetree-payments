import { NextRequest, NextResponse } from "next/server"
import QRCode from "qrcode"
import { createPosPaymentIntentEngine, createPosPaymentEngine } from "@/engine/posPayments"
import { requireTerminalSession } from "@/lib/api/terminalAuth"
import { getRouteErrorStatus } from "@/lib/api/merchantAuth"

export async function POST(req: NextRequest) {
  try {
    const { mid: merchantId, tid: terminalId } = requireTerminalSession(req)

    const body = await req.json()
    const { amount, currency, network, asset } = body

    if (!amount) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // POS-terminal-controlled Base payment: terminal owns the WalletConnect session.
    // Customer wallet only approves; customer's mobile browser shows a status-only page.
    const normalizedNetwork = String(network || "").toLowerCase().trim()
    const normalizedAsset = String(asset || "").toUpperCase().trim()
    if (normalizedNetwork === "stripe") {
      return NextResponse.json(
        { error: "Use the explicit POS card payment-link fallback." },
        { status: 400 }
      )
    }
    if (normalizedNetwork === "base" && (normalizedAsset === "ETH" || normalizedAsset === "USDC")) {
      const result = await createPosPaymentEngine({
        amount: Number(amount),
        currency: String(currency || "USD"),
        asset: normalizedAsset,
        terminal: { merchantId, terminalId, preferredNetwork: "base" },
      })

      const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "")
      const statusUrl = `${appUrl}/pay?paymentId=${encodeURIComponent(result.paymentId)}&mode=status&asset=${normalizedAsset}`
      const statusQrCodeUrl = await QRCode.toDataURL(statusUrl)

      console.info("[api/pos/payment] base terminal-controlled payment created", {
        paymentId: result.paymentId,
        network: "base",
        asset: normalizedAsset,
        statusUrl,
      })

      return NextResponse.json({
        paymentId: result.paymentId,
        paymentUrl: result.paymentUrl,
        qrCodeUrl: result.qrCodeUrl,
        nativeAmount: result.nativeAmount,
        nativeSymbol: result.nativeSymbol,
        asset: normalizedAsset,
        network: "base",
        posTerminalOwned: true,
        statusUrl,
        statusQrCodeUrl,
        breakdown: result.breakdown,
      })
    }

    // Default: intent-based flow — customer selects network on their device.
    const result = await createPosPaymentIntentEngine({
      amount: Number(amount),
      currency: String(currency || "USD"),
      terminal: {
        merchantId,
        terminalId,
        preferredNetwork: undefined,
      },
    })

    console.info("[api/pos/payment] returning paymentUrl", {
      paymentId: result.paymentId,
      intentId: result.intentId,
      paymentUrl: result.paymentUrl,
    })

    return NextResponse.json({
      paymentId: result.paymentId,
      intentId: result.intentId,
      paymentUrl: result.paymentUrl,
      qrCodeUrl: result.qrCodeUrl,
      breakdown: result.breakdown,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error"
    return NextResponse.json({ error: message }, { status: getRouteErrorStatus(err) })
  }
}
