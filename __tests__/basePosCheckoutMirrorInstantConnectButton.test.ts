import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Regression coverage for restoring the instant "Choose Wallet" button
 * (renamed from "Connect with WalletConnect" for consistency with the
 * primary wallet-selection button label used across SOL, USDC on Solana,
 * ETH on Base, USDC on Base, and Bitcoin Lightning). The intended UX: tap a
 * Base asset -> the card expands -> the Connect button appears
 * immediately -> WalletConnect pairing/session prep
 * continues invisibly in the background -> once pairingUri arrives, the
 * button either opens the wallet chooser right away, or (if the customer
 * already tapped it while still preparing) auto-opens it without a second
 * tap.
 *
 * The regression this restores: two large "Preparing secure WalletConnect
 * session..." spinner panels — one gating the whole card on
 * paymentReady/session, one gating just the button on pairingUri — used to
 * delay the button's first appearance by several seconds. Both are removed;
 * the card (title + button + Cancel) now renders unconditionally the moment
 * step is undefined or "awaiting_wallet", and the button itself carries the
 * "not ready yet" state instead of blocking the whole card.
 *
 * Follows this file's existing structural-assertion convention (no
 * @testing-library/react or jsdom is configured in this project — see
 * vitest.config.ts's environment: "node" — so these are string-level proofs
 * against the component's source, consistent with every other
 * POSLayout/BasePosCheckoutMirror test in this suite).
 */

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

describe("BasePosCheckoutMirror — instant Connect button", () => {
  const src = read("components/payment/BasePosCheckoutMirror.tsx")

  it("1+2. renders the awaiting-wallet card (title + Connect button) for both ETH and USDC — the guard never branches on selectedAsset", () => {
    const guardIndex = src.indexOf('if (!session || !step || step === "awaiting_wallet")')
    expect(guardIndex).toBeGreaterThan(-1)
    const cardBlock = src.slice(guardIndex, src.indexOf("From here on step is one of the later", guardIndex))
    expect(cardBlock).toContain("Connect your wallet")
    expect(cardBlock).toContain("Choose Wallet")
    // The card's own rendering condition and body never reference
    // selectedAsset or an ETH/USDC-specific branch — it is identical for
    // both assets, so there's no code path where one asset gets the
    // instant button and the other doesn't.
    expect(cardBlock).not.toContain("selectedAsset")
    expect(cardBlock).not.toContain("isUsdc")
  })

  it("3. the button is present in JSX unconditionally on pairingUri — only buttonPreparing (which starts false) can disable it", () => {
    const buttonIndex = src.lastIndexOf("Choose Wallet")
    expect(buttonIndex).toBeGreaterThan(-1)
    const precedingButtonTag = src.lastIndexOf("<Button", buttonIndex)
    const buttonOpenTag = src.slice(precedingButtonTag, src.indexOf(">", precedingButtonTag) + 1)
    expect(buttonOpenTag).toContain("disabled={buttonPreparing}")
    expect(buttonOpenTag).not.toContain("pairingReady")
    expect(buttonOpenTag).not.toContain("pairingUri")

    expect(src).toContain("const [buttonPreparing, setButtonPreparing] = useState(false)")
  })

  it("4. an early tap (pairingReady false) is remembered via pendingConnectRef and auto-opens the chooser once pairingReady flips true — no second tap required", () => {
    const tapFnStart = src.indexOf("function handleConnectTapped()")
    const tapFnEnd = src.indexOf("\n  }\n\n", tapFnStart)
    const tapFnBlock = src.slice(tapFnStart, tapFnEnd)
    expect(tapFnBlock).toContain("if (!pairingReady) {")
    expect(tapFnBlock).toContain("pendingConnectRef.current = true")
    expect(tapFnBlock).toContain("setButtonPreparing(true)")
    // The early-tap branch returns without opening the chooser directly —
    // opening only happens once pairingReady is true.
    expect(tapFnBlock).toContain("return")

    const autoOpenEffectStart = src.indexOf("if (!pairingReady || !pendingConnectRef.current) return")
    expect(autoOpenEffectStart).toBeGreaterThan(-1)
    const autoOpenBlock = src.slice(autoOpenEffectStart, autoOpenEffectStart + 250)
    expect(autoOpenBlock).toContain("pendingConnectRef.current = false")
    expect(autoOpenBlock).toContain("setButtonPreparing(false)")
    expect(autoOpenBlock).toContain("openWalletChooser()")
  })

  it("5. only one chooser can ever open — openWalletChooser guards with the functional setState form, both the tap path and the auto-open path funnel through it", () => {
    const openFnStart = src.indexOf("const openWalletChooser = useCallback(")
    const openFnEnd = src.indexOf("}, [intentId, paymentId, pollSession])", openFnStart)
    expect(openFnStart).toBeGreaterThan(-1)
    expect(openFnEnd).toBeGreaterThan(openFnStart)
    const block = src.slice(openFnStart, openFnEnd)
    expect(block).toContain("setShowLauncher((alreadyOpen) => {")
    expect(block).toContain("if (alreadyOpen) return alreadyOpen")
    expect(block).toContain('markBaseCheckoutLatency("wallet_chooser_opened"')

    // Exactly two call sites: the direct tap (ready) path, and the
    // auto-open-on-ready effect. No other place opens the chooser.
    const callSites = src.split("openWalletChooser()").length - 1
    expect(callSites).toBe(2)
  })

  it("6. this component never creates a second WalletConnect proposal — select-network (payment creation) is called at most once, gated by selectCalledRef, and tapping Connect never calls it again", () => {
    expect(src).toContain("if (selectCalledRef.current) return")
    expect(src).toContain("selectCalledRef.current = true")

    const tapFnStart = src.indexOf("function handleConnectTapped()")
    const tapFnEnd = src.indexOf("\n  }\n\n", tapFnStart)
    const tapFnBlock = src.slice(tapFnStart, tapFnEnd)
    expect(tapFnBlock).not.toContain("select-network")

    const openFnStart = src.indexOf("const openWalletChooser = useCallback(")
    const openFnEnd = src.indexOf("}, [intentId, paymentId, pollSession])", openFnStart)
    const openFnBlock = src.slice(openFnStart, openFnEnd)
    expect(openFnBlock).not.toContain("select-network")
    // The only network call openWalletChooser triggers is the existing
    // read-only session poll, not a new payment/proposal-creating request.
    expect(openFnBlock).toContain("void pollSession()")
  })

  it("7. the large blocking preparation panels are gone entirely", () => {
    expect(src).not.toContain("Preparing secure WalletConnect session")
    expect(src).not.toContain("The payment terminal is getting your wallet connection ready.")
    // The old hard gates that produced those panels are also gone.
    expect(src).not.toContain("if (!paymentReady || !session) {")
    expect(src).not.toContain("if (!pairingUri || !isValidPairingUri(pairingUri)) {")
  })

  it("8. Cancel still works from the awaiting-wallet card, and the pre-existing error/terminal cancel paths are untouched", () => {
    const guardIndex = src.indexOf('if (!session || !step || step === "awaiting_wallet")')
    const cardBlock = src.slice(guardIndex, src.indexOf("From here on step is one of the later", guardIndex))
    expect(cardBlock).toContain('<Button variant="danger" fullWidth onClick={onCancel}>')
    expect(cardBlock).toContain("Cancel")

    // Unrelated cancel/back paths still exist: error state keeps a danger
    // button, while terminal statuses use the shared hosted-checkout
    // PaymentStatusVisual treatment plus the existing Back action.
    expect(src).toContain("if (selectNetworkError) {")
    expect(src).toContain("<PaymentStatusVisual")
    expect(src).toContain("onClick={onCancel}")
  })

  it("preserves and adds the requested timing milestones, each carrying intentId and paymentId", () => {
    const requiredCalls: Array<[string, string]> = [
      ["asset_selected", 'markBaseCheckoutLatency("asset_selected"'],
      ["walletconnect_button_rendered", 'markBaseCheckoutLatency("walletconnect_button_rendered"'],
      ["walletconnect_button_tapped", 'markBaseCheckoutLatency("walletconnect_button_tapped"'],
      ["pairing_uri_received", 'markBaseCheckoutLatency("pairing_uri_received"'],
      ["wallet_chooser_opened", 'markBaseCheckoutLatency("wallet_chooser_opened"'],
      // Preserved from the prior session.
      ["customer_pairing_uri_received", 'markBaseCheckoutLatency("customer_pairing_uri_received"'],
      ["base_option_tapped", 'markBaseCheckoutLatency("base_option_tapped"'],
    ]
    for (const [name, needle] of requiredCalls) {
      const callIndex = src.indexOf(needle)
      expect(callIndex, `${name} call site not found`).toBeGreaterThan(-1)
      const call = src.slice(callIndex, src.indexOf(")", src.indexOf("{", callIndex)) + 1)
      expect(call, `${name} must log intentId`).toContain("intentId")
      expect(call, `${name} must log paymentId`).toContain("paymentId")
    }
  })

  it("walletconnect_button_rendered fires once per mount, guarded by a ref, independent of the select-network network round trip", () => {
    const effectStart = src.indexOf("const buttonRenderedLoggedRef = useRef(false)")
    const effectEnd = src.indexOf("}, [intentId, paymentId])", effectStart)
    expect(effectStart).toBeGreaterThan(-1)
    const block = src.slice(effectStart, effectEnd)
    expect(block).toContain("if (buttonRenderedLoggedRef.current) return")
    expect(block).toContain("buttonRenderedLoggedRef.current = true")
    expect(block).not.toContain("await")
    expect(block).not.toContain("fetch(")
  })
})
