export type Shift4OnboardingConfig = Readonly<{
  configured: boolean
  hostedApplicationUrl: string | null
  senderDomainAllowlist: readonly string[]
  reason: string | null
}>

function safeHttpsUrl(value: string | undefined): string | null {
  try {
    const url = new URL(String(value || ""))
    return url.protocol === "https:" ? url.toString() : null
  } catch { return null }
}

export function getShift4OnboardingConfig(env: Readonly<Record<string, string | undefined>> = process.env): Shift4OnboardingConfig {
  const hostedApplicationUrl = safeHttpsUrl(env.SHIFT4_ONBOARDING_HOSTED_URL)
  const senderDomainAllowlist = String(env.SHIFT4_ONBOARDING_SENDER_DOMAINS || "")
    .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean)
  return Object.freeze({
    configured: Boolean(hostedApplicationUrl),
    hostedApplicationUrl,
    senderDomainAllowlist: Object.freeze(senderDomainAllowlist),
    reason: hostedApplicationUrl ? null : "Official Shift4 hosted onboarding contract is not configured",
  })
}
