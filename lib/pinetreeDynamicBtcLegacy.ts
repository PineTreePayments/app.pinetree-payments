export function isDynamicBtcLegacyEnabled(): boolean {
  return String(process.env.PINETREE_ENABLE_DYNAMIC_BTC_LEGACY || "").trim() === "true"
}

