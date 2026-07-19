import { lookup as dnsLookup } from "node:dns/promises"
import { isIP } from "node:net"

type LookupAddress = { address: string; family: number }
type LookupAll = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAddress[]>

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
])

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home",
  ".lan",
  ".arpa",
  ".test",
  ".invalid",
  ".example",
]

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number)
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false
  }

  const [a, b, c] = octets
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && (b === 0 || b === 168)) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase()
  // Accept only global-unicast space (2000::/3), then exclude documentation.
  // This intentionally fails closed for special-purpose and future ranges.
  return /^[23]/.test(normalized) && !normalized.startsWith("2001:db8:")
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return isPublicIpv4(address)
  if (family === 6) return isPublicIpv6(address)
  return false
}

export function parseWebhookUrl(rawUrl: string): URL {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error("Webhook URL must be a valid URL")
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Webhook URL must use HTTPS")
  }
  if (parsed.username || parsed.password) {
    throw new Error("Webhook URL must not contain credentials")
  }
  if (parsed.hash) {
    throw new Error("Webhook URL must not contain a fragment")
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")
  if (
    !hostname ||
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new Error("Webhook URL must use a public hostname")
  }

  if (isIP(hostname) && !isPublicIpAddress(hostname)) {
    throw new Error("Webhook URL must not target a private or reserved address")
  }

  return parsed
}

export async function assertSafeWebhookUrl(
  rawUrl: string,
  lookup: LookupAll = dnsLookup as LookupAll,
): Promise<URL> {
  const parsed = parseWebhookUrl(rawUrl)
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")
  if (isIP(hostname)) return parsed

  let addresses: LookupAddress[]
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new Error("Webhook hostname could not be resolved")
  }

  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error("Webhook hostname must resolve only to public addresses")
  }

  return parsed
}
