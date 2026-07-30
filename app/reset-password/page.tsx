import { cookies } from "next/headers"
import ResetPasswordClient from "./ResetPasswordClient"
import { RECOVERY_COOKIE_NAME } from "@/lib/auth/recovery"

export const dynamic = "force-dynamic"

type ResetPasswordPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const [params, cookieStore] = await Promise.all([searchParams, cookies()])
  const recoveryParam = typeof params.recovery === "string" ? params.recovery : ""
  const recoveryCookie = cookieStore.get(RECOVERY_COOKIE_NAME)?.value ?? ""
  const recoveryAuthorized =
    recoveryParam.length > 0 && recoveryCookie.length > 0 && recoveryParam === recoveryCookie

  return <ResetPasswordClient recoveryAuthorized={recoveryAuthorized} />
}
