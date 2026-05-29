import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import {
  isBaseV7Configured,
  isBaseV7DelegatedEnabled,
  RPC_URLS,
} from "@/engine/config"

type CheckStatus = "healthy" | "warning" | "missing"
type RailName = "base" | "solana" | "lightning" | "all"

type EnvCheck = {
  name: string
  status: CheckStatus
  rails: RailName[]
  detail: string
  fallback?: string
}

function checkEnv(names: string[]): { present: boolean; source: string } {
  for (const name of names) {
    if (String(process.env[name] || "").trim()) return { present: true, source: name }
  }
  return { present: false, source: "" }
}

async function probeRpc(url: string): Promise<{ reachable: boolean; latencyMs?: number }> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth", params: [] }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    return { reachable: res.ok || res.status < 500, latencyMs: Date.now() - start }
  } catch {
    return { reachable: false, latencyMs: Date.now() - start }
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)

    const checks: EnvCheck[] = []

    // ── WalletConnect ─────────────────────────────────────────────────────────
    const wc = checkEnv(["NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID"])
    checks.push({
      name: "WalletConnect Project ID",
      status: wc.present ? "healthy" : "missing",
      rails: ["base"],
      detail: wc.present
        ? `Configured via ${wc.source}`
        : "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID not set — WalletConnect modal will not open",
      fallback: wc.present ? undefined : "Base ETH and Base USDC payments will fail on connect",
    })

    // ── Base V7 contract + relayer ────────────────────────────────────────────
    const v7Ready = isBaseV7Configured()
    const v7Contract = checkEnv(["PINETREE_BASE_V7_CONTRACT"])
    const v7RelayerAddr = checkEnv(["PINETREE_BASE_V7_RELAYER_ADDRESS"])
    const v7RelayerKey = checkEnv(["PINETREE_BASE_V7_RELAYER_PRIVATE_KEY"])
    const v7GasCap = checkEnv(["PINETREE_BASE_V7_MAX_GAS_USD"])
    checks.push({
      name: "Base V7 Contract",
      status: v7Contract.present ? "healthy" : "missing",
      rails: ["base"],
      detail: v7Contract.present
        ? `PINETREE_BASE_V7_CONTRACT set`
        : "PINETREE_BASE_V7_CONTRACT not set — Base payments will fail",
      fallback: v7Contract.present ? undefined : "All Base payments will fail at payment creation",
    })
    checks.push({
      name: "Base V7 Relayer (EIP-3009)",
      status: v7Ready ? "healthy" : v7RelayerAddr.present ? "warning" : "missing",
      rails: ["base"],
      detail: v7Ready
        ? "V7 relayer fully configured"
        : !v7RelayerAddr.present
          ? "PINETREE_BASE_V7_RELAYER_ADDRESS not set"
          : !v7RelayerKey.present
            ? "PINETREE_BASE_V7_RELAYER_PRIVATE_KEY not set"
            : !v7GasCap.present
              ? "PINETREE_BASE_V7_MAX_GAS_USD not set"
              : "V7 relayer configuration incomplete",
      fallback: v7Ready ? undefined : "USDC EIP-3009 path unavailable; allowance_two_step will be used",
    })

    // ── Base V7 Delegated (wallet_sendCalls) ──────────────────────────────────
    const v7DelegatedEnabled = isBaseV7DelegatedEnabled()
    checks.push({
      name: "Base V7 Delegated (wallet_sendCalls)",
      status: v7DelegatedEnabled ? "healthy" : "warning",
      rails: ["base"],
      detail: v7DelegatedEnabled
        ? "PINETREE_BASE_V7_DELEGATED_ENABLED=true — Coinbase Smart Wallet batch path active"
        : "PINETREE_BASE_V7_DELEGATED_ENABLED not set or false — batch path disabled",
      fallback: v7DelegatedEnabled ? undefined : "Coinbase Smart Wallet falls to EIP-3009 or allowance path",
    })

    // ── Solana RPC ────────────────────────────────────────────────────────────
    const solanaRpcUrl = String(
      process.env.RPC_URL_SOLANA || process.env.SOLANA_RPC_URL || RPC_URLS.solana || ""
    )
    const solanaRpcCustom = Boolean(process.env.RPC_URL_SOLANA || process.env.SOLANA_RPC_URL)
    const solanaProbe = await probeRpc(solanaRpcUrl)
    checks.push({
      name: "Solana RPC",
      status: solanaProbe.reachable ? (solanaRpcCustom ? "healthy" : "warning") : "missing",
      rails: ["solana"],
      detail: solanaProbe.reachable
        ? `${solanaRpcCustom ? "Custom" : "Public fallback"} RPC reachable at ${solanaRpcUrl.split("?")[0]} (${solanaProbe.latencyMs}ms)`
        : `Solana RPC unreachable at ${solanaRpcUrl.split("?")[0]} (${solanaProbe.latencyMs}ms)`,
      fallback: solanaProbe.reachable && !solanaRpcCustom
        ? "Using public mainnet-beta RPC — set RPC_URL_SOLANA for a dedicated endpoint"
        : solanaProbe.reachable ? undefined : "Solana payment watcher and transaction builds will fail",
    })

    // ── Base RPC ──────────────────────────────────────────────────────────────
    const baseRpcUrl = String(process.env.BASE_RPC_URL || RPC_URLS.base || "")
    const baseRpcCustom = Boolean(process.env.BASE_RPC_URL)
    const baseProbe = await probeRpc(baseRpcUrl)
    checks.push({
      name: "Base RPC",
      status: baseProbe.reachable ? (baseRpcCustom ? "healthy" : "warning") : "missing",
      rails: ["base"],
      detail: baseProbe.reachable
        ? `${baseRpcCustom ? "Custom" : "Public fallback"} RPC reachable at ${baseRpcUrl} (${baseProbe.latencyMs}ms)`
        : `Base RPC unreachable at ${baseRpcUrl} (${baseProbe.latencyMs}ms)`,
      fallback: baseProbe.reachable && !baseRpcCustom
        ? "Using public mainnet.base.org RPC — set BASE_RPC_URL for a dedicated endpoint"
        : baseProbe.reachable ? undefined : "Base payment watcher will fail",
    })

    // ── NWC Lightning treasury ────────────────────────────────────────────────
    const nwcTreasury = checkEnv(["PINETREE_TREASURY_NWC_URI"])
    checks.push({
      name: "Lightning Treasury (NWC URI)",
      status: nwcTreasury.present ? "healthy" : "warning",
      rails: ["lightning"],
      detail: nwcTreasury.present
        ? `Configured via ${nwcTreasury.source}`
        : "PINETREE_TREASURY_NWC_URI not set — PineTree fee collection after Lightning payments will be skipped",
      fallback: nwcTreasury.present ? undefined : "Lightning payments will process but PineTree cannot collect fees",
    })

    // ── Supabase ──────────────────────────────────────────────────────────────
    const supabaseUrl = checkEnv(["NEXT_PUBLIC_SUPABASE_URL"])
    const supabaseKey = checkEnv(["NEXT_PUBLIC_SUPABASE_ANON_KEY"])
    const supabaseService = checkEnv(["SUPABASE_SERVICE_ROLE_KEY"])
    checks.push({
      name: "Supabase",
      status: supabaseUrl.present && supabaseKey.present && supabaseService.present ? "healthy" : "missing",
      rails: ["all"],
      detail: supabaseUrl.present && supabaseKey.present && supabaseService.present
        ? "URL, anon key, and service role key all present"
        : [
            !supabaseUrl.present && "NEXT_PUBLIC_SUPABASE_URL missing",
            !supabaseKey.present && "NEXT_PUBLIC_SUPABASE_ANON_KEY missing",
            !supabaseService.present && "SUPABASE_SERVICE_ROLE_KEY missing",
          ].filter(Boolean).join("; "),
      fallback: supabaseUrl.present && supabaseKey.present ? undefined : "All payments will fail — database unreachable",
    })

    // ── Alchemy webhook keys (Base + Solana) ──────────────────────────────────
    const alchemyBase = checkEnv(["ALCHEMY_WEBHOOK_SIGNING_KEY_BASE", "ALCHEMY_WEBHOOK_SIGNING_KEY"])
    const alchemySolana = checkEnv(["ALCHEMY_WEBHOOK_SIGNING_KEY_SOLANA", "ALCHEMY_WEBHOOK_SIGNING_KEY"])
    checks.push({
      name: "Alchemy Webhook Key (Base)",
      status: alchemyBase.present ? "healthy" : "warning",
      rails: ["base"],
      detail: alchemyBase.present
        ? `Configured via ${alchemyBase.source}`
        : "ALCHEMY_WEBHOOK_SIGNING_KEY_BASE not set — Base Alchemy webhooks will be rejected (401)",
      fallback: alchemyBase.present ? undefined : "Base address-activity webhooks will not confirm payments; detect route will still work",
    })
    checks.push({
      name: "Alchemy Webhook Key (Solana)",
      status: alchemySolana.present ? "healthy" : "warning",
      rails: ["solana"],
      detail: alchemySolana.present
        ? `Configured via ${alchemySolana.source}`
        : "ALCHEMY_WEBHOOK_SIGNING_KEY_SOLANA not set — Solana Alchemy webhooks will be rejected (401)",
      fallback: alchemySolana.present ? undefined : "Solana address-activity webhooks will not confirm payments; detect route will still work",
    })

    const healthy = checks.filter((c) => c.status === "healthy").length
    const warnings = checks.filter((c) => c.status === "warning").length
    const missing = checks.filter((c) => c.status === "missing").length
    const overallStatus: CheckStatus = missing > 0 ? "missing" : warnings > 0 ? "warning" : "healthy"

    return NextResponse.json({
      ok: true,
      overallStatus,
      summary: { total: checks.length, healthy, warnings, missing },
      checks,
    })
  } catch (err) {
    const status = getRouteErrorStatus(err)
    const message = err instanceof Error ? err.message : "Environment check failed"
    return NextResponse.json({ error: message }, { status })
  }
}
