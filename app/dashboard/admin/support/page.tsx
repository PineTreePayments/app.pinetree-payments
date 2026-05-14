import { redirect } from "next/navigation"

export default function AdminSupportRedirect() {
  redirect("/dashboard/admin")
}
