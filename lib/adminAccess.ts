export const OFFICIAL_ADMIN_EMAILS = [
  "jordanduskin@gmail.com",
] as const

const OFFICIAL_ADMIN_EMAIL_SET = new Set<string>(OFFICIAL_ADMIN_EMAILS)

export function normalizeAdminEmail(email: string | null | undefined): string {
  return String(email || "").trim().toLowerCase()
}

export function isOfficialAdminEmail(email: string | null | undefined): boolean {
  return OFFICIAL_ADMIN_EMAIL_SET.has(normalizeAdminEmail(email))
}

export function normalizeAdminRole(role: string | null | undefined): string | null {
  const normalized = String(role || "").trim().toLowerCase()
  return normalized || null
}

export function isAdminRole(role: string | null | undefined): boolean {
  return normalizeAdminRole(role) === "admin"
}
