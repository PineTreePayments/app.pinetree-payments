import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8").replace(/\r\n/g, "\n")

describe("withdrawal module layout alignment", () => {
  const page = source("app/dashboard/wallet-setup/page.tsx")
  const cards = source("components/withdrawals/WithdrawalCards.tsx")
  const form = page.slice(page.indexOf("function WithdrawalFormShell("), page.indexOf("function formatUsd("))
  const result = page.slice(page.indexOf("function WithdrawalResultCard("), page.indexOf("function WithdrawalFormShell("))

  it("hides only the page title while the withdrawal workspace is mounted", () => {
    expect(page).toContain('data-withdrawal-module-active="true"')
    expect(page).toContain("[&:has([data-withdrawal-module-active])>h1]:hidden")
    expect(page).toContain('<h1 className={dashboardPageTitleClass}>PineTree Wallet</h1>')
    expect(page).toContain('<WalletFloatingWorkspace title="Withdraw"')
  })

  it("defines one shared action size and safe-area container", () => {
    expect(cards).toContain('const withdrawalActionBaseClass = "inline-flex h-11 w-full')
    expect(cards).toContain("rounded-xl px-5 text-sm font-semibold")
    expect(cards).toContain("mx-auto flex w-full max-w-sm flex-col gap-2")
    expect(cards).toContain("pb-[calc(1rem+env(safe-area-inset-bottom))]")
    expect(cards).toContain("function WithdrawalPrimaryButton")
    expect(cards).toContain("function WithdrawalSecondaryButton")
  })

  it("uses equal shared actions for form, review, failure, and completion", () => {
    expect(form).toContain("<WithdrawalPrimaryButton")
    expect(form).toContain("<WithdrawalSecondaryButton onClick={onCancel}")
    expect(cards).toContain("<WithdrawalPrimaryButton onClick={onConfirm}")
    expect(cards).toContain("<WithdrawalSecondaryButton onClick={onEdit}")
    expect(result).toContain("<WithdrawalPrimaryButton onClick={onDone}>Done</WithdrawalPrimaryButton>")
    expect(result).toContain("<WithdrawalSecondaryButton onClick={onDone}>Done</WithdrawalSecondaryButton>")
  })

  it("has no detached review edit link or independently-sized form cancel", () => {
    expect(form).not.toContain('onClick={onEdit} className="text-sm')
    expect(form).not.toContain("min-w-[12rem]")
    expect(form).not.toContain('className="inline-flex h-11 items-center justify-center rounded-lg border')
    expect(cards).not.toContain("Ready to authorize withdrawal.")
  })

  it("keeps every rail on the same form and action components", () => {
    expect(page.match(/<WithdrawalFormShell/g)).toHaveLength(1)
    expect(page).toContain("rail={withdrawalRail}")
    const formActions = form.slice(form.lastIndexOf("<WithdrawalActionStack>"), form.indexOf('{process.env.NODE_ENV !== "production" ? ('))
    expect(formActions).not.toContain('rail === "base"')
    expect(formActions).not.toContain('rail === "solana"')
    expect(formActions).not.toContain('rail === "bitcoin"')
  })

  it("keeps long canonical amounts intact with responsive non-splitting typography", () => {
    expect(cards).toContain("amount.length > 22")
    expect(cards).toContain("amount.length > 16")
    expect(cards).toContain("text-[clamp(1.75rem,8vw,2.25rem)]")
    expect(cards).toContain("whitespace-nowrap font-semibold tabular-nums")
    expect(cards).toContain("flex max-w-full flex-wrap")
  })

  it("uses one outer width and top rhythm for review, progress, and results", () => {
    expect(cards).toContain('return <div className="mx-auto w-full max-w-xl space-y-3 pt-1">')
    expect(cards).toContain("export function WithdrawalProgressCard")
    expect(cards).toContain("export function WithdrawalResultCard")
    expect(cards.match(/<WithdrawalShell>/g)?.length).toBeGreaterThanOrEqual(3)
    expect(page).toContain('className="mx-auto w-full max-w-xl"')
  })
})
