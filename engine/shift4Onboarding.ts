import { markMerchantShift4ApplicationPendingByEmail } from "@/database/merchantAdmin"

export async function applyShift4OnboardingEngine(input: { email: string }) {
  const email = String(input.email || "").trim().toLowerCase()
  if (!email) {
    throw new Error("Email is required")
  }

  await markMerchantShift4ApplicationPendingByEmail(email)

  return {
    url: "https://www.shift4.com/"
  }
}
