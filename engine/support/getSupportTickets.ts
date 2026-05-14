import { getSupportTicketsForMerchant, type SupportTicketRecord } from "@/database/supportTickets"

export async function getSupportTickets(input: { merchantId: string }): Promise<SupportTicketRecord[]> {
  const merchantId = String(input.merchantId || "").trim()
  if (!merchantId) {
    throw new Error("merchantId is required")
  }

  return getSupportTicketsForMerchant(merchantId)
}
