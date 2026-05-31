export type SpeedDashboardLinkKey =
  | "dashboard"
  | "accountId"
  | "apiKeys"
  | "webhooks"
  | "autoSwap"
  | "payouts"
  | "settlements"
  | "docs"

export type SpeedDashboardLink = {
  key: SpeedDashboardLinkKey
  label: string
  url: string
}

function publicEnv(...names: string[]): string {
  for (const name of names) {
    const value = String(process.env[name] || "").trim()
    if (value) return value
  }
  return ""
}

export const speedDashboardLinks: Record<SpeedDashboardLinkKey, SpeedDashboardLink> = {
  dashboard: {
    key: "dashboard",
    label: "Open Speed Dashboard",
    url: publicEnv("NEXT_PUBLIC_SPEED_DASHBOARD_URL", "NEXT_PUBLIC_SPEED_LOGIN_URL")
  },
  accountId: {
    key: "accountId",
    label: "Find Account ID",
    url: publicEnv("NEXT_PUBLIC_SPEED_ACCOUNT_ID_URL", "NEXT_PUBLIC_SPEED_ASSOCIATED_ACCOUNTS_URL")
  },
  apiKeys: {
    key: "apiKeys",
    label: "API Keys",
    url: publicEnv("NEXT_PUBLIC_SPEED_API_KEYS_URL")
  },
  webhooks: {
    key: "webhooks",
    label: "Webhooks",
    url: publicEnv("NEXT_PUBLIC_SPEED_WEBHOOKS_URL")
  },
  autoSwap: {
    key: "autoSwap",
    label: "Auto-Swap Settings",
    url: publicEnv("NEXT_PUBLIC_SPEED_AUTOSWAP_URL", "NEXT_PUBLIC_SPEED_AUTO_SWAP_URL")
  },
  payouts: {
    key: "payouts",
    label: "Payout Settings",
    url: publicEnv("NEXT_PUBLIC_SPEED_PAYOUTS_URL", "NEXT_PUBLIC_SPEED_AUTO_PAYOUT_URL")
  },
  settlements: {
    key: "settlements",
    label: "Settlement Settings",
    url: publicEnv("NEXT_PUBLIC_SPEED_SETTLEMENTS_URL")
  },
  docs: {
    key: "docs",
    label: "Docs",
    url: publicEnv("NEXT_PUBLIC_SPEED_DOCS_URL")
  }
}

export function getSpeedDashboardLinks(keys: SpeedDashboardLinkKey[]): SpeedDashboardLink[] {
  return keys
    .map((key) => speedDashboardLinks[key])
    .filter((link) => Boolean(link.url))
}
