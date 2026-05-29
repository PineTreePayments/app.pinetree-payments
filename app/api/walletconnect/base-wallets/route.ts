import { NextRequest, NextResponse } from "next/server"
import {
  BASE_WALLET_TARGETS,
  createBaseWalletEntry,
  walletSupportsBase,
  type BaseWalletApiEntry,
  type BaseWalletTarget,
  type WalletConnectExplorerWallet,
} from "@/lib/payment/baseWallets"

export const dynamic = "force-dynamic"

type ExplorerResponse = {
  listings?: Record<string, WalletConnectExplorerWallet>
}

function isValidPairingUri(value: string): boolean {
  return value.startsWith("wc:") && value.includes("@2")
}

async function fetchExplorerWallet(
  target: BaseWalletTarget,
  projectId: string
): Promise<WalletConnectExplorerWallet | null> {
  const url = new URL("https://explorer-api.walletconnect.com/v3/wallets")
  url.searchParams.set("projectId", projectId)
  url.searchParams.set("search", target.explorerSearch)
  url.searchParams.set("entries", "8")
  url.searchParams.set("page", "1")

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 60 * 60 * 12 },
  })

  if (!res.ok) return null

  const data = (await res.json()) as ExplorerResponse
  const listings = Object.values(data.listings || {})
  return (
    listings.find((wallet) => wallet.id === target.explorerId) ||
    listings.find((wallet) => wallet.name.toLowerCase() === target.label.toLowerCase()) ||
    null
  )
}

function toApiEntry(
  target: BaseWalletTarget,
  wallet: WalletConnectExplorerWallet | null,
  pairingUri: string
): BaseWalletApiEntry {
  const entry = createBaseWalletEntry(target, wallet)
  return {
    ...entry,
    href: entry.href(pairingUri),
    enabled:
      entry.enabled &&
      Boolean(entry.href(pairingUri)) &&
      (wallet ? walletSupportsBase(wallet) : true),
  }
}

export async function GET(req: NextRequest) {
  const pairingUri = req.nextUrl.searchParams.get("pairingUri") || ""
  if (!isValidPairingUri(pairingUri)) {
    return NextResponse.json({ error: "Invalid pairingUri" }, { status: 400 })
  }

  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || ""
  if (!projectId) {
    return NextResponse.json(
      {
        source: "walletconnect-explorer-cache",
        wallets: BASE_WALLET_TARGETS.map((target) => toApiEntry(target, null, pairingUri)),
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  }

  const wallets = await Promise.all(
    BASE_WALLET_TARGETS.map(async (target) => {
      try {
        const wallet = await fetchExplorerWallet(target, projectId)
        return toApiEntry(target, wallet, pairingUri)
      } catch {
        return toApiEntry(target, null, pairingUri)
      }
    })
  )

  return NextResponse.json(
    {
      source: "walletconnect-explorer",
      wallets,
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}
