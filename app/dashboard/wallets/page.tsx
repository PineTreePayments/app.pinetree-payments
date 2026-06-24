import { redirect } from "next/navigation"

export default function WalletsRedirectPage() {
  redirect("/dashboard/wallet-setup")
}
