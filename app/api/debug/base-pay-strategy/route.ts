import { NextRequest, NextResponse } from "next/server"
import { requireAdminFromRequest, getRouteErrorStatus } from "@/lib/api/adminAuth"
import {
  orchestrateBasePayStrategy,
  classifyWalletFamily,
  type BasePayStrategy,
  type BasePayWalletCapabilities,
  type BasePayOrchestrationInput,
} from "@/lib/basePay/strategyOrchestrator"
import { isBaseV5Configured, isBaseDelegatedEoaEnabled } from "@/engine/config"

/**
 * Independently derive the expected primary strategy from raw inputs.
 * Written as a parallel implementation (not calling the orchestrator) so that
 * the GET handler can assert orchestrator correctness by comparing the two.
 */
function deriveExpectedStrategy(
  asset: "ETH" | "USDC",
  caps: BasePayWalletCapabilities,
  delegatedEnabled: boolean,
  relayerAvailable: boolean,
  allowanceSufficient: boolean,
): BasePayStrategy {
  if (asset === "ETH") return "base_eth_direct"
  const canDelegated = delegatedEnabled && !caps.skipDelegatedBatch && caps.supportsSendCalls
  const canEip3009 = relayerAvailable && !caps.skipEip3009
  if (canDelegated) return "usdc_delegated_batch_wallet_sendCalls"
  if (canEip3009) return "usdc_eip3009_relayer"
  if (allowanceSufficient) return "usdc_allowance_direct"
  return "usdc_allowance_two_step"
}

// ─── Wallet profiles for simulation ──────────────────────────────────────────

type SimProfile = {
  label: string
  description: string
  peerName: string
  capabilities: BasePayWalletCapabilities
}

function makeProfiles(): SimProfile[] {
  return [
    {
      label: "coinbase_smart_wallet",
      description: "Coinbase Smart Wallet — supports wallet_sendCalls batch",
      peerName: "Coinbase Wallet",
      capabilities: {
        walletFamily: "coinbase",
        supportsSendCalls: true,
        supportsTypedData: true,
        skipEip3009: false,
        skipDelegatedBatch: false,
      },
    },
    {
      label: "coinbase_eoa",
      description: "Coinbase Wallet (EOA mode) — no wallet_sendCalls, supports typed data",
      peerName: "Coinbase Wallet",
      capabilities: {
        walletFamily: "coinbase",
        supportsSendCalls: false,
        supportsTypedData: true,
        skipEip3009: false,
        // Coinbase is never skipped for delegated — skipDelegatedBatch stays false
        // so prepare is still attempted, but supportsSendCalls=false means canDelegated=false
        skipDelegatedBatch: false,
      },
    },
    {
      label: "metamask",
      description: "MetaMask / Rainbow / Kraken — no wallet_sendCalls, typed data supported",
      peerName: "MetaMask",
      capabilities: {
        walletFamily: "metamask",
        supportsSendCalls: false,
        supportsTypedData: true,
        skipEip3009: false,
        skipDelegatedBatch: true,
      },
    },
    {
      label: "trust_wallet",
      description: "Trust Wallet — no wallet_sendCalls, no reliable typed data (no EIP-3009)",
      peerName: "Trust Wallet",
      capabilities: {
        walletFamily: "trust",
        supportsSendCalls: false,
        supportsTypedData: false,
        skipEip3009: true,
        skipDelegatedBatch: true,
      },
    },
    {
      label: "unknown_wallet",
      description: "Unknown wallet — namespace data unavailable, optimistic defaults",
      peerName: "Unknown Wallet",
      capabilities: {
        walletFamily: "unknown",
        supportsSendCalls: true, // optimistic: no namespace data
        supportsTypedData: true,
        skipEip3009: false,
        skipDelegatedBatch: false,
      },
    },
    {
      label: "relayer_unavailable",
      description: "MetaMask with relayer unavailable — must fall back to allowance paths",
      peerName: "MetaMask",
      capabilities: {
        walletFamily: "metamask",
        supportsSendCalls: false,
        supportsTypedData: true,
        skipEip3009: false,
        skipDelegatedBatch: true,
      },
    },
    {
      label: "sufficient_allowance",
      description: "Trust Wallet with sufficient existing USDC allowance — allowance_direct",
      peerName: "Trust Wallet",
      capabilities: {
        walletFamily: "trust",
        supportsSendCalls: false,
        supportsTypedData: false,
        skipEip3009: true,
        skipDelegatedBatch: true,
      },
    },
    {
      label: "insufficient_allowance",
      description:
        "Trust Wallet with insufficient USDC allowance — allowance_two_step required",
      peerName: "Trust Wallet",
      capabilities: {
        walletFamily: "trust",
        supportsSendCalls: false,
        supportsTypedData: false,
        skipEip3009: true,
        skipDelegatedBatch: true,
      },
    },
  ]
}

type SimScenario = {
  profileLabel: string
  asset: "ETH" | "USDC"
  delegatedEnabled: boolean
  relayerAvailable: boolean
  allowanceSufficient: boolean
}

function makeScenarios(serverDelegated: boolean, serverRelayer: boolean): SimScenario[] {
  return [
    // USDC profiles
    { profileLabel: "coinbase_smart_wallet", asset: "USDC", delegatedEnabled: serverDelegated, relayerAvailable: serverRelayer, allowanceSufficient: false },
    { profileLabel: "coinbase_eoa", asset: "USDC", delegatedEnabled: serverDelegated, relayerAvailable: serverRelayer, allowanceSufficient: false },
    { profileLabel: "metamask", asset: "USDC", delegatedEnabled: serverDelegated, relayerAvailable: serverRelayer, allowanceSufficient: false },
    { profileLabel: "trust_wallet", asset: "USDC", delegatedEnabled: serverDelegated, relayerAvailable: serverRelayer, allowanceSufficient: false },
    { profileLabel: "unknown_wallet", asset: "USDC", delegatedEnabled: serverDelegated, relayerAvailable: serverRelayer, allowanceSufficient: false },
    // Special scenarios
    { profileLabel: "relayer_unavailable", asset: "USDC", delegatedEnabled: false, relayerAvailable: false, allowanceSufficient: false },
    { profileLabel: "sufficient_allowance", asset: "USDC", delegatedEnabled: serverDelegated, relayerAvailable: serverRelayer, allowanceSufficient: true },
    { profileLabel: "insufficient_allowance", asset: "USDC", delegatedEnabled: serverDelegated, relayerAvailable: serverRelayer, allowanceSufficient: false },
    // ETH
    { profileLabel: "metamask", asset: "ETH", delegatedEnabled: serverDelegated, relayerAvailable: serverRelayer, allowanceSufficient: false },
  ]
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)

    const serverDelegated = isBaseDelegatedEoaEnabled()
    const serverRelayer = isBaseV5Configured()

    const profiles = makeProfiles()
    const profileMap = new Map(profiles.map((p) => [p.label, p]))
    const scenarios = makeScenarios(serverDelegated, serverRelayer)

    const results = scenarios.map((scenario) => {
      const profile = profileMap.get(scenario.profileLabel)
      if (!profile) return null

      const input: BasePayOrchestrationInput = {
        asset: scenario.asset,
        walletCapabilities: profile.capabilities,
        delegatedEnabled: scenario.delegatedEnabled,
        relayerAvailable: scenario.relayerAvailable,
        allowanceSufficient: scenario.allowanceSufficient,
      }

      const orchestration = orchestrateBasePayStrategy(input)
      const expected = deriveExpectedStrategy(
        scenario.asset,
        profile.capabilities,
        scenario.delegatedEnabled,
        scenario.relayerAvailable,
        scenario.allowanceSufficient,
      )
      const pass = orchestration.primaryStrategy === expected

      return {
        scenario: {
          profile: scenario.profileLabel,
          asset: scenario.asset,
          delegatedEnabled: scenario.delegatedEnabled,
          relayerAvailable: scenario.relayerAvailable,
          allowanceSufficient: scenario.allowanceSufficient,
        },
        walletProfile: {
          label: profile.label,
          description: profile.description,
          peerName: profile.peerName,
          capabilities: profile.capabilities,
        },
        orchestration,
        validation: {
          expected,
          actual: orchestration.primaryStrategy,
          pass,
        },
      }
    }).filter(Boolean)

    const passed = results.filter((r) => r && r.validation.pass).length
    const failed = results.filter((r) => r && !r.validation.pass).length

    return NextResponse.json({
      ok: true,
      serverConfig: {
        delegatedEnabled: serverDelegated,
        relayerAvailable: serverRelayer,
      },
      summary: { total: results.length, passed, failed },
      note: "Relayer unavailable mid-flow (after user signed EIP-3009) stops cleanly — BASE_USDC_TEMPORARILY_UNAVAILABLE_MESSAGE is re-thrown without falling to allowance path.",
      results,
    })
  } catch (err) {
    const status = getRouteErrorStatus(err)
    const message = err instanceof Error ? err.message : "Simulator error"
    return NextResponse.json({ error: message }, { status })
  }
}

// Also accept POST so callers can pass custom capability profiles
export async function POST(req: NextRequest) {
  try {
    await requireAdminFromRequest(req)

    const body = (await req.json()) as Partial<BasePayOrchestrationInput & { peerName?: string }>

    const asset = body.asset === "ETH" ? "ETH" : "USDC"
    const peerName = typeof body.peerName === "string" ? body.peerName : null

    const caps: BasePayWalletCapabilities = body.walletCapabilities ?? {
      walletFamily: classifyWalletFamily(peerName),
      supportsSendCalls: false,
      supportsTypedData: true,
      skipEip3009: false,
      skipDelegatedBatch: true,
    }

    const input: BasePayOrchestrationInput = {
      asset,
      walletCapabilities: caps,
      delegatedEnabled: body.delegatedEnabled ?? isBaseDelegatedEoaEnabled(),
      relayerAvailable: body.relayerAvailable ?? isBaseV5Configured(),
      allowanceSufficient: body.allowanceSufficient ?? false,
    }

    const result = orchestrateBasePayStrategy(input)

    return NextResponse.json({ ok: true, input, result })
  } catch (err) {
    const status = getRouteErrorStatus(err)
    const message = err instanceof Error ? err.message : "Simulator error"
    return NextResponse.json({ error: message }, { status })
  }
}
