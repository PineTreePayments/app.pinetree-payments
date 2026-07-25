import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Regression coverage for standardizing the primary wallet-selection button
 * label to "Choose Wallet" across every customer crypto checkout surface
 * (SOL, USDC on Solana, ETH on Base, USDC on Base, Bitcoin Lightning), and
 * renaming the Lightning-only installed-wallet shortcut to "Open Installed
 * Wallet". This step is wallet *selection*, not final payment submission —
 * the old per-rail labels ("Pay with SOL on Solana", "Connect with
 * WalletConnect", "Choose Lightning Wallet") implied otherwise.
 *
 * Also removes the Base-only "Preparing secure connection…" helper line
 * entirely (not just before the tap — it must never render).
 *
 * Structural/string-level proofs against each component's source, matching
 * this repo's existing convention for these components (no
 * @testing-library/react or jsdom configured — see vitest.config.ts's
 * environment: "node").
 */

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

const solanaSrc = read("components/payment/SolanaWalletPayment.tsx")
const baseWalletSrc = read("components/payment/BaseWalletPayment.tsx")
const basePosMirrorSrc = read("components/payment/BasePosCheckoutMirror.tsx")
const lightningSrc = read("components/payment/LightningPayment.tsx")

describe("Checkout — \"Choose Wallet\" primary button label", () => {
  it("1. SOL / 2. USDC on Solana — primary button says Choose Wallet, not the old dynamic 'Pay with {asset} on Solana'", () => {
    const btnStart = lastNonRecoveryButtonStart(solanaSrc, "setWalletPickerOpen(true)")
    const block = solanaSrc.slice(btnStart, btnStart + 250)
    expect(block).toContain("Choose Wallet")
    expect(solanaSrc).not.toMatch(/Pay with \{selectedAsset\} on Solana/)
    expect(solanaSrc).not.toContain("Pay with SOL on Solana")
    expect(solanaSrc).not.toContain("Pay with USDC on Solana")
  })

  it("3. ETH on Base / 4. USDC on Base (customer-owned WalletConnect flow) — primary button says Choose Wallet", () => {
    // startWalletConnectPayment() is also called by an earlier "Try Again"
    // error-recovery button — the primary selection button is the last
    // occurrence in the file.
    const btnIndex = baseWalletSrc.lastIndexOf("startWalletConnectPayment()")
    expect(btnIndex).toBeGreaterThan(-1)
    const block = baseWalletSrc.slice(btnIndex, btnIndex + 150)
    expect(block).toContain("Choose Wallet")
    expect(baseWalletSrc).not.toMatch(/Pay with \{selectedAsset\} on Base/)
    expect(baseWalletSrc).not.toContain("Pay with ETH on Base")
    expect(baseWalletSrc).not.toContain("Pay with USDC on Base")
  })

  it("3. ETH on Base / 4. USDC on Base (POS-owned WalletConnect flow) — primary button says Choose Wallet", () => {
    const guardIndex = basePosMirrorSrc.indexOf(
      'if (!session || !step || step === "awaiting_wallet")'
    )
    expect(guardIndex).toBeGreaterThan(-1)
    const cardBlock = basePosMirrorSrc.slice(
      guardIndex,
      basePosMirrorSrc.indexOf("From here on step is one of the later", guardIndex)
    )
    expect(cardBlock).toContain("Choose Wallet")
  })

  it("5. Bitcoin Lightning — primary button says Choose Wallet, not 'Choose Lightning Wallet'", () => {
    const btnStart = lastNonRecoveryButtonStart(lightningSrc, "setWalletPickerOpen(true)")
    const block = lightningSrc.slice(btnStart, btnStart + 200)
    expect(block).toContain("Choose Wallet")
  })

  it("6. Bitcoin Lightning secondary button says 'Open Installed Wallet', not 'Pay with installed Lightning wallet'", () => {
    const btnStart = lightningSrc.indexOf("window.location.href = invoiceUri")
    expect(btnStart).toBeGreaterThan(-1)
    const block = lightningSrc.slice(btnStart, btnStart + 150)
    expect(block).toContain("Open Installed Wallet")
  })

  it("7. no 'Connect with WalletConnect' label remains anywhere in the customer checkout components", () => {
    for (const [name, src] of [
      ["SolanaWalletPayment.tsx", solanaSrc],
      ["BaseWalletPayment.tsx", baseWalletSrc],
      ["BasePosCheckoutMirror.tsx", basePosMirrorSrc],
      ["LightningPayment.tsx", lightningSrc],
    ] as const) {
      expect(src, `${name} must not contain the old label`).not.toContain("Connect with WalletConnect")
    }
  })

  it("8. no 'Pay with SOL on Solana' (or the dynamic USDC equivalent) label remains", () => {
    expect(solanaSrc).not.toContain("Pay with SOL on Solana")
    expect(solanaSrc).not.toContain("Pay with USDC on Solana")
    expect(solanaSrc).not.toMatch(/Pay with \{selectedAsset\} on Solana/)
  })

  it("9. no 'Choose Lightning Wallet' label remains", () => {
    expect(lightningSrc).not.toContain("Choose Lightning Wallet")
  })

  it("10. no 'Preparing secure connection…' text remains, before or after the tap", () => {
    expect(basePosMirrorSrc).not.toContain("Preparing secure connection")
    // The conditional hint block itself (keyed off !pairingReady &&
    // !buttonPreparing) is gone, not just hidden behind a different
    // condition.
    expect(basePosMirrorSrc).not.toContain("!pairingReady && !buttonPreparing")
  })

  it("11a. Solana Choose Wallet button behavior is unchanged — still opens the wallet picker via the same handler body", () => {
    const btnStart = lastNonRecoveryButtonStart(solanaSrc, "setWalletPickerOpen(true)")
    const block = solanaSrc.slice(btnStart - 120, btnStart + 250)
    expect(block).toContain("refreshWallets()")
    expect(block).toContain('setWalletSearch("")')
    expect(block).toContain("setWalletPickerOpen(true)")
  })

  it("11b. Base (customer-owned) Choose Wallet button behavior is unchanged — still calls startWalletConnectPayment()", () => {
    expect(baseWalletSrc).toContain(
      "<Button fullWidth onClick={() => startWalletConnectPayment()}>"
    )
  })

  it("11c. Base POS-mirror Choose Wallet button behavior is unchanged — still onClick={handleConnectTapped}, disabled={buttonPreparing}, with the Connecting… pending state preserved", () => {
    expect(basePosMirrorSrc).toContain(
      "<Button fullWidth onClick={handleConnectTapped} disabled={buttonPreparing}>"
    )
    expect(basePosMirrorSrc).toContain("Connecting…")
    expect(basePosMirrorSrc).toContain("pendingConnectRef.current = true")
    expect(basePosMirrorSrc).toContain("openWalletChooser()")
  })

  it("11d. Lightning buttons' behavior is unchanged — Choose Wallet still opens the picker, Open Installed Wallet still navigates via the same deep link", () => {
    const primaryStart = lastNonRecoveryButtonStart(lightningSrc, "setWalletPickerOpen(true)")
    const primaryBlock = lightningSrc.slice(primaryStart, primaryStart + 250)
    expect(primaryBlock).toContain("setWalletPickerOpen(true)")
    expect(primaryBlock).toContain("Choose Wallet")

    const secondaryStart = lightningSrc.indexOf("window.location.href = invoiceUri")
    const secondaryBlock = lightningSrc.slice(secondaryStart - 200, secondaryStart + 150)
    expect(secondaryBlock).toContain("walletLaunchedRef.current = true")
    expect(secondaryBlock).toContain("setWalletLaunched(true)")
    expect(secondaryBlock).toContain("onExecutionStarted?.()")
    expect(secondaryBlock).toContain("Open Installed Wallet")
  })
})

/**
 * SolanaWalletPayment.tsx has two buttons whose onClick body contains
 * "setWalletPickerOpen(true)" — a recovery/retry button ("Try again [with
 * X]") and the primary selection button ("Choose Wallet"). This returns the
 * start index of the LAST one (the primary, non-recovery button), which is
 * always the final occurrence in the file.
 */
function lastNonRecoveryButtonStart(src: string, needle: string): number {
  const lastIndex = src.lastIndexOf(needle)
  return src.lastIndexOf("<Button", lastIndex)
}
