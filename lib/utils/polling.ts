/**
 * Client-side auto polling switch (default OFF)
 *
 * Set NEXT_PUBLIC_ENABLE_AUTO_POLLING=true to re-enable recurring polling.
 */
export const AUTO_POLLING_ENABLED =
  String(process.env.NEXT_PUBLIC_ENABLE_AUTO_POLLING || "").toLowerCase().trim() === "true"
