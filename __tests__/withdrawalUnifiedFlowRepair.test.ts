import fs from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

function readNormalized(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8").replace(/\r\n/g, "\n")
}

const page = readNormalized("app/dashboard/wallet-setup/page.tsx")
const dynamicSubmitRoute = readNormalized("app/api/wallets/pinetree-wallet/withdrawals/[id]/submit/route.ts")
const bitcoinWithdrawalsRoute = readNormalized("app/api/wallets/withdrawals/route.ts")

function sliceBetween(src: string, start: string, end: string) {
  const startIndex = src.indexOf(start)
  return src.slice(startIndex, src.indexOf(end, startIndex))
}

describe("Withdrawal approval/result flow unification repair", () => {
  describe("root cause 1: stale-closure wallet snapshot behind the first-attempt Dynamic authorization timeout", () => {
    it("collectDynamicRuntimeWalletSnapshot reads the always-current refs, not the closed-over hook values", () => {
      const fn = sliceBetween(
        page,
        "const collectDynamicRuntimeWalletSnapshot = useCallback(",
        "const buildDynamicWalletRuntimeSnapshot = useCallback("
      )
      expect(fn).toContain("walletsRef.current")
      expect(fn).toContain("primaryWalletRef.current")
      expect(fn).not.toMatch(/getDynamicWalletSearchList\(\s*\[\.\.\.\(wallets as unknown\[\]\)/)
    })

    it("buildDynamicWalletRuntimeSnapshot resolves primaryWallet from the ref too, not the stale render value", () => {
      const fn = sliceBetween(
        page,
        "const buildDynamicWalletRuntimeSnapshot = useCallback(",
        "const emitDynamicRuntimeStage = useCallback("
      )
      expect(fn).toContain("const currentPrimaryWallet = primaryWalletRef.current")
      expect(fn).toContain('findDynamicApprovalWalletForSource(snapshotWallets, currentPrimaryWallet, "base", profile.base_address)')
      expect(fn).toContain('findDynamicApprovalWalletForSource(snapshotWallets, currentPrimaryWallet, "solana", profile.solana_address)')
      expect(fn).toContain("primaryWallet: currentPrimaryWallet,")
    })

    it("ensureDynamicWalletRuntimeReady's bounded hydration retry still exists and calls the ref-safe snapshot builder", () => {
      const fn = sliceBetween(
        page,
        "const ensureDynamicWalletRuntimeReady = useCallback(async (",
        "useEffect(() => {\n    if (!sdkHasLoaded || !user || profileState.kind !== \"loaded\") return"
      )
      expect(fn).toContain("const MAX_WALLET_HYDRATION_ATTEMPTS = 3")
      expect(fn).toContain("collectDynamicRuntimeWalletSnapshot()")
      expect(fn).toContain('emitDynamicRuntimeStage("dynamic_wallet_readiness_started"')
      expect(fn).toContain('emitDynamicRuntimeStage("dynamic_wallet_ready"')
    })
  })

  describe("root cause 2: stuck 'Approving withdrawal' from a blocking balance resync in the submit routes", () => {
    it("the Dynamic submit route fires the balance resync in the background instead of awaiting it before responding", () => {
      expect(dynamicSubmitRoute).toContain("void syncPineTreeWalletBalances(merchantId).catch(")
      expect(dynamicSubmitRoute).not.toMatch(/await syncPineTreeWalletBalances\(merchantId\)/)
    })

    it("the Bitcoin instant-send route fires all three of its balance resync call sites in the background", () => {
      const refreshCalls = bitcoinWithdrawalsRoute.match(/refreshBalancesAfterWithdrawal\(merchantId, \{/g) ?? []
      expect(refreshCalls.length).toBe(3)
      expect(bitcoinWithdrawalsRoute).not.toMatch(/await refreshBalancesAfterWithdrawal\(/)
      expect(bitcoinWithdrawalsRoute.match(/void refreshBalancesAfterWithdrawal\(/g)?.length).toBe(3)
    })

    it("both submit routes log a transaction_hash_persisted diagnostic once a tx hash is available", () => {
      expect(dynamicSubmitRoute).toContain("transaction_hash_persisted")
      expect(dynamicSubmitRoute).toContain("txHashSuffix: result.request.tx_hash.slice(-8)")
      expect(bitcoinWithdrawalsRoute).toContain("transaction_hash_persisted")
      expect(bitcoinWithdrawalsRoute).toContain("txHashSuffix: result.operation.txHash.slice(-8)")
    })

    it("the generic Bitcoin withdrawals route still never names a specific provider (architecture boundary)", () => {
      expect(bitcoinWithdrawalsRoute).not.toMatch(/\bSpeed\b/)
    })
  })

  describe("bounded provider-submission timeout (distinct from the in-modal Dynamic signing wait)", () => {
    it("fetchWithTimeout wraps the PineTree API round trip and classifies an abort as a recoverable status-unknown case", () => {
      expect(page).toContain("async function fetchWithTimeout(")
      expect(page).toContain("const WITHDRAWAL_PROVIDER_SUBMISSION_TIMEOUT_MS = 20_000")
      expect(page).toContain('code: "PROVIDER_SUBMISSION_TIMEOUT"')
      expect(page).toContain('fetchWithTimeout(`/api/wallets/pinetree-wallet/withdrawals/${encodeURIComponent(withdrawalId)}/prepare`')
      expect(page).toContain('fetchWithTimeout(`/api/wallets/pinetree-wallet/withdrawals/${encodeURIComponent(withdrawalId)}/submit`')
      expect(page).toContain('fetchWithTimeout("/api/wallets/withdrawals"')
    })

    it("a submit-stage timeout after Dynamic already signed is treated as status-unknown, not authorization failure", () => {
      const handleSubmit = sliceBetween(page, "async function handleSubmitWithdrawal(context", "\n  // Early returns")
      expect(handleSubmit).toContain("let signedBeforeSubmitCall = false")
      expect(handleSubmit).toContain("signedBeforeSubmitCall = Boolean(dynamicSubmission.txHash || dynamicSubmission.signedPsbtBase64)")
      expect(handleSubmit).toContain('const isPostSignSubmissionTimeout = signedBeforeSubmitCall && errorCode === "PROVIDER_SUBMISSION_TIMEOUT"')
      expect(handleSubmit).toContain("isPostSignSubmissionTimeout")
      expect(handleSubmit).toContain("withdrawalStatusUnknownMessage")
      expect(handleSubmit).toContain("if (!isAmbiguousOutcome && withdrawalReview?.review.approvalMethod")
    })
  })

  describe("one shared, provider-agnostic withdrawal result component", () => {
    function resultCardSrc() {
      return sliceBetween(page, "function WithdrawalResultCard(", "function WithdrawalFormShell(")
    }

    it("WithdrawalFormShell renders every non-form/review state through the single shared card", () => {
      const formShell = sliceBetween(page, "function WithdrawalFormShell(", "function AssetSelectDropdown(")
      expect(formShell).toContain('if (screen === "approving" || screen === "failed" || (screen === "submitted" && submitResult))')
      expect(formShell).toContain("<WithdrawalResultCard")
      // No per-rail branch left in the form shell that would render a different
      // layout/title for one asset (the old isSolanaSolWithdrawal special case).
      expect(formShell).not.toContain("isSolanaSolWithdrawal")
    })

    it("the shared card never renders a provider name (Speed/Dynamic) in merchant-facing copy", () => {
      const src = resultCardSrc()
      expect(src).not.toMatch(/>[^<]*\bSpeed\b[^<]*</)
      expect(src).not.toMatch(/>[^<]*\bDynamic\b[^<]*</)
    })

    it("covers authorizing, submitted, confirmed, and failed states with the required copy", () => {
      const src = resultCardSrc()
      expect(src).toContain("Authorizing withdrawal")
      expect(src).toContain("Confirm this withdrawal in PineTree Wallet.")
      expect(src).toContain('"Withdrawal complete"')
      expect(src).toContain("Your withdrawal has been completed.")
      expect(src).toContain('"Withdrawal submitted"')
      expect(src).toContain("Your withdrawal is still being processed. You can safely leave this screen.")
      expect(src).toContain("Withdrawal failed")
      expect(src).toContain("View transaction")
      expect(src).toContain(">\n            Done\n          </button>")
      expect(src).toContain("Try again")
    })

    it("shows a compact Asset/Network/Amount/Status/Destination summary in the submitted/confirmed state", () => {
      const src = resultCardSrc()
      expect(src).toContain(">Asset<")
      expect(src).toContain(">Network<")
      expect(src).toContain(">Amount<")
      expect(src).toContain(">Status<")
      expect(src).toContain(">Destination<")
    })

    it("the requires-action recovery dialog uses the standardized copy, not a raw retry prompt", () => {
      expect(page).toContain("Withdrawal needs your authorization")
      expect(page).toContain("Confirm this withdrawal in PineTree Wallet to continue.")
      expect(page).toContain("Authorize withdrawal")
      expect(page).not.toContain("We couldn't authorize this withdrawal")
    })
  })

  describe("mobile presentation fixes", () => {
    it("destination addresses wrap with overflow-wrap instead of character-count break-all", () => {
      expect(page).not.toContain("break-all")
      expect(page.match(/\[overflow-wrap:anywhere\]/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    })

    it("review and result screens reserve bottom safe-area space and clear the sticky header on scroll-into-view", () => {
      expect(page.match(/env\(safe-area-inset-bottom\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
      expect(page.match(/scroll-mt-24/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
    })
  })

  describe("active-withdrawal recovery across refresh", () => {
    it("defines merchant-scoped marker persist/read/clear helpers", () => {
      expect(page).toContain("function activeWithdrawalStorageKey(merchantId: string)")
      expect(page).toContain("function persistActiveWithdrawalMarker(")
      expect(page).toContain("function readActiveWithdrawalMarker(")
      expect(page).toContain("function clearActiveWithdrawalMarker(")
      expect(page).toContain("`pinetree-wallet-active-withdrawal:${merchantId}`")
    })

    it("persists the marker once a real operation exists for both Dynamic and Bitcoin, and clears it on draft reset", () => {
      expect(page).toContain('kind: "dynamic",\n        id: withdrawalId,')
      expect(page).toContain('kind: "bitcoin",\n          id: result.data.operation.id,')
      const resetFn = sliceBetween(page, "function resetWithdrawalDraft() {", "function handleCancelWithdrawal()")
      expect(resetFn).toContain("clearActiveWithdrawalMarker(merchantId)")
    })

    it("clears the marker once a polled status reaches a terminal state (confirmed/failed) for both rails", () => {
      const dynamicPoll = sliceBetween(page, "async function pollWithdrawalRequest(", "async function pollBitcoinWithdrawalOperation(")
      expect(dynamicPoll).toContain('json.request.status === "confirmed" || json.request.status === "failed"')
      expect(dynamicPoll).toContain("clearActiveWithdrawalMarker(merchantId)")
      const bitcoinPoll = sliceBetween(page, "async function pollBitcoinWithdrawalOperation(", "async function handleSubmitWithdrawal(")
      expect(bitcoinPoll).toContain('nextStatus === "Confirmed" || nextStatus === "Withdrawal failed"')
      expect(bitcoinPoll).toContain("clearActiveWithdrawalMarker(merchantId)")
    })

    it("runs a one-time recovery effect that resumes an active Dynamic or Bitcoin operation and reopens the withdraw tab", () => {
      const recoveryEffect = sliceBetween(
        page,
        "// Recover an in-flight withdrawal after a page refresh",
        "}, [merchantId, profileState.kind])"
      )
      expect(recoveryEffect).toContain("withdrawalRecoveryAttemptedRef.current = true")
      expect(recoveryEffect).toContain("readActiveWithdrawalMarker(merchantId)")
      expect(recoveryEffect).toContain('setActiveView("withdraw")')
      expect(recoveryEffect).toContain("void pollWithdrawalRequest(marker.id, recoveredResult)")
      expect(recoveryEffect).toContain("void pollBitcoinWithdrawalOperation(marker.id, recoveredResult)")
    })
  })

  describe("standardized diagnostics vocabulary", () => {
    const requiredEvents = [
      "withdrawal_operation_created",
      "dynamic_wallet_readiness_started",
      "dynamic_wallet_ready",
      "dynamic_authorization_requested",
      "dynamic_authorization_opened",
      "dynamic_authorization_confirmed",
      "dynamic_authorization_cancelled",
      "provider_submission_started",
      "provider_submission_succeeded",
      "provider_submission_failed",
      "withdrawal_result_transition",
      "withdrawal_reconciliation_started",
      "withdrawal_confirmed",
      "withdrawal_failed",
      "withdrawal_requires_action",
    ]

    it("every standardized event name is both emitted somewhere and whitelisted for production delivery", () => {
      const whitelist = sliceBetween(page, "const PRODUCTION_WALLET_WITHDRAWAL_DEBUG_EVENTS = new Set([", "])")
      for (const event of requiredEvents) {
        expect(page).toContain(`"${event}"`)
        expect(whitelist).toContain(`"${event}"`)
      }
    })

    it("transaction_hash_persisted is logged server-side (not client-gated) with only a masked tx hash suffix", () => {
      expect(dynamicSubmitRoute).not.toContain("tx_hash.slice(0")
      expect(dynamicSubmitRoute).toContain("txHashSuffix: result.request.tx_hash.slice(-8)")
    })
  })
})
