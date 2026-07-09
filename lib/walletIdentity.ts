export type WalletIdentityResolution =
  | { ok: true; canonicalEmail: string; shouldBackfillMerchantEmail: boolean }
  | { ok: false; code: "wallet_identity_conflict" | "wallet_identity_unavailable" }

function email(value: unknown) {
  return String(value || "").trim().toLowerCase() || null
}

export function resolveWalletIdentity(input: {
  merchantEmail?: unknown
  authEmail?: unknown
  bodyMerchantEmail?: unknown
  dynamicEmail?: unknown
}): WalletIdentityResolution {
  const merchantEmail = email(input.merchantEmail)
  const authEmail = email(input.authEmail)
  const bodyMerchantEmail = email(input.bodyMerchantEmail)
  const dynamicEmail = email(input.dynamicEmail)

  if (merchantEmail && authEmail && merchantEmail !== authEmail) {
    return { ok: false, code: "wallet_identity_conflict" }
  }

  const canonicalEmail = merchantEmail || authEmail
  if (!canonicalEmail) {
    return { ok: false, code: "wallet_identity_unavailable" }
  }
  if (bodyMerchantEmail && bodyMerchantEmail !== canonicalEmail) {
    return { ok: false, code: "wallet_identity_conflict" }
  }
  if (dynamicEmail && dynamicEmail !== canonicalEmail) {
    return { ok: false, code: "wallet_identity_conflict" }
  }

  return {
    ok: true,
    canonicalEmail,
    shouldBackfillMerchantEmail: !merchantEmail && Boolean(authEmail),
  }
}
