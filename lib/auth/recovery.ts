export const RECOVERY_COOKIE_NAME = "pinetree-password-recovery"

type RecoveryDiagnosticDetails = Record<string, boolean | number | string | null>

export function logRecoveryDiagnostic(
  stage: string,
  details: RecoveryDiagnosticDetails = {}
) {
  if (process.env.NODE_ENV !== "development") return

  // Keep recovery diagnostics deliberately metadata-only. Never add URLs,
  // codes, tokens, sessions, cookies, email addresses, or passwords here.
  console.info("[auth-recovery]", { stage, ...details })
}
