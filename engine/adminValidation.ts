import { createValidationMerchantRecord } from "@/database/merchantAdmin"

export async function runValidationMerchantInsertEngine() {
  const created = await createValidationMerchantRecord({
    email: "test@demo.com",
    businessName: "Test Business",
    provider: "Shift4"
  })

  return {
    merchant: created
  }
}
