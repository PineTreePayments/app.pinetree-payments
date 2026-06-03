export type SpeedDashboardLinkKey =
  | "dashboard"
  | "associatedAccounts"
  | "accountId"
  | "autoPayout"
  | "login"
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
    url: publicEnv("NEXT_PUBLIC_SPEED_DASHBOARD_URL", "NEXT_PUBLIC_SPEED_LOGIN_URL") || "https://app.tryspeed.com/dashboard"
  },
  associatedAccounts: {
    key: "associatedAccounts",
    label: "Open Associated Accounts",
    url:
      publicEnv(
        "NEXT_PUBLIC_SPEED_ACCOUNT_ID_URL",
        "NEXT_PUBLIC_SPEED_ASSOCIATED_ACCOUNTS_URL"
      ) || "https://app.tryspeed.com/settings/associated-accounts"
  },
  accountId: {
    key: "accountId",
    label: "Find Account ID",
    url:
      publicEnv(
        "NEXT_PUBLIC_SPEED_ACCOUNT_ID_URL",
        "NEXT_PUBLIC_SPEED_ASSOCIATED_ACCOUNTS_URL"
      ) || "https://app.tryspeed.com/settings/associated-accounts"
  },
  autoPayout: {
    key: "autoPayout",
    label: "Open Auto Payout",
    url:
      publicEnv("NEXT_PUBLIC_SPEED_AUTO_PAYOUT_URL") || "https://app.tryspeed.com/auto-payout"
  },
  login: {
    key: "login",
    label: "Open Speed Login",
    url: publicEnv("NEXT_PUBLIC_SPEED_LOGIN_URL") || "https://app.tryspeed.com"
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
    label: "Open Auto Swap",
    url: publicEnv("NEXT_PUBLIC_SPEED_AUTO_SWAP_URL", "NEXT_PUBLIC_SPEED_AUTOSWAP_URL") || "https://app.tryspeed.com/auto-swap"
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

// Named URL constants for merchant-facing setup UI (client-safe NEXT_PUBLIC_ vars only)

export const speedLoginUrl =
  publicEnv("NEXT_PUBLIC_SPEED_LOGIN_URL") ||
  "https://app.tryspeed.com"

export const speedSignupUrl =
  publicEnv("NEXT_PUBLIC_SPEED_SIGNUP_URL") ||
  "https://www.tryspeed.com"

export const speedDashboardUrl =
  publicEnv("NEXT_PUBLIC_SPEED_DASHBOARD_URL", "NEXT_PUBLIC_SPEED_LOGIN_URL") ||
  "https://app.tryspeed.com/dashboard"

// Legacy alias preserved for existing imports
export const speedDashboardHref = speedDashboardUrl

export const speedAssociatedAccountsUrl =
  publicEnv(
    "NEXT_PUBLIC_SPEED_ACCOUNT_ID_URL",
    "NEXT_PUBLIC_SPEED_ASSOCIATED_ACCOUNTS_URL"
  ) || "https://app.tryspeed.com/settings/associated-accounts"

// Legacy alias preserved for existing imports
export const speedAssociatedAccountsHref = speedAssociatedAccountsUrl

export const speedAccountSetupUrl =
  publicEnv(
    "NEXT_PUBLIC_SPEED_ACCOUNT_ID_URL",
    "NEXT_PUBLIC_SPEED_ASSOCIATED_ACCOUNTS_URL"
  ) || "https://app.tryspeed.com/settings/associated-accounts"

export const speedAutoPayoutUrl =
  publicEnv("NEXT_PUBLIC_SPEED_AUTO_PAYOUT_URL") ||
  "https://app.tryspeed.com/auto-payout"

export const speedAutoSwapUrl =
  publicEnv("NEXT_PUBLIC_SPEED_AUTO_SWAP_URL", "NEXT_PUBLIC_SPEED_AUTOSWAP_URL") ||
  "https://app.tryspeed.com/auto-swap"
