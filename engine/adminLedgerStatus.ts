export function canonicalAdminPaymentStatus(paymentStatus: string): string {
  return String(paymentStatus || "").toUpperCase()
}
