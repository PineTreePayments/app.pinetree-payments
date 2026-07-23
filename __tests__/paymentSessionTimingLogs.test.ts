import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

function read(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8")
}

const lightning = read("components/payment/LightningPayment.tsx")
const base = read("components/payment/BaseWalletPayment.tsx")
const solana = read("components/payment/SolanaWalletPayment.tsx")
const payClient = read("app/pay/PayClient.tsx")
const sessionLog = read("lib/payment/paymentSessionLog.ts")

describe("Bitcoin Lightning never initializes WalletConnect or a blockchain wallet adapter", () => {
  it("imports none of the EVM/Solana wallet libraries", () => {
    for (const forbidden of [
      "wagmi",
      "@walletconnect",
      "ethers",
      "@solana/web3.js",
      "@/lib/wallets/solana",
      "@/lib/pos/posBaseWalletConnect",
    ]) {
      expect(lightning).not.toContain(forbidden)
    }
  })

  it("never calls connector.getProvider(), EthereumProvider.init, or a Solana wallet's connect()", () => {
    expect(lightning).not.toContain("EthereumProvider")
    expect(lightning).not.toContain(".getProvider()")
    expect(lightning).not.toContain("signAndSendTransaction")
  })
})

describe("Structured payment-session timing log — shared helper", () => {
  it("exposes a session-attempt id generator and a rail-tagged stage logger", () => {
    expect(sessionLog).toContain("export function createSessionAttemptId")
    expect(sessionLog).toContain("export function logPaymentSession")
    expect(sessionLog).toContain("sessionAttemptId")
    expect(sessionLog).toContain("paymentId")
  })

  it("covers the required checkpoint vocabulary", () => {
    for (const stage of [
      "checkout_loaded",
      "wallet_library_preload_started",
      "wallet_library_preload_completed",
      "wallet_list_ready",
      "pairing_started",
      "session_approved",
      "wallet_opened",
      "signature_requested",
      "transaction_submitted",
      "transaction_hash_stored",
      "provider_detected",
      "confirmed",
      "watcher_stopped",
    ]) {
      expect(sessionLog).toContain(stage)
    }
  })
})

describe("Each rail emits its applicable timing checkpoints with a sessionAttemptId", () => {
  it("PayClient logs checkout_loaded and the WalletConnect preload pair, each with sessionAttemptId", () => {
    expect(payClient).toContain('logPaymentSession("checkout", "checkout_loaded"')
    expect(payClient).toContain('"wallet_library_preload_started"')
    expect(payClient).toContain('"wallet_library_preload_completed"')
    expect(payClient).toContain("sessionAttemptIdRef.current")
  })

  it("Base logs pairing, session approval, wallet-opened, signature, and submission checkpoints", () => {
    expect(base).toContain('"pairing_started"')
    expect(base).toContain('"session_approved"')
    expect(base).toContain('"wallet_opened"')
    expect(base).toContain('"signature_requested"')
    expect(base).toContain('"transaction_submitted"')
    expect(base).toContain("sessionAttemptIdRef.current")
  })

  it("Solana logs wallet-list-ready, wallet-opened, signature, submission, and hash-stored checkpoints", () => {
    expect(solana).toContain('"wallet_list_ready"')
    expect(solana).toContain('"wallet_opened"')
    expect(solana).toContain('"signature_requested"')
    expect(solana).toContain('"transaction_submitted"')
    expect(solana).toContain('"transaction_hash_stored"')
    expect(solana).toContain("sessionAttemptIdRef.current")
  })

  it("Lightning logs wallet-list-ready, wallet-opened, provider-detected, and watcher-stopped checkpoints", () => {
    expect(lightning).toContain('"wallet_list_ready"')
    expect(lightning).toContain('"wallet_opened"')
    expect(lightning).toContain('"provider_detected"')
    expect(lightning).toContain('"watcher_stopped"')
    expect(lightning).toContain("sessionAttemptIdRef.current")
  })

  it("PayClient logs confirmed/watcher_stopped exactly once per terminal transition (guarded by a ref)", () => {
    const section = payClient.slice(
      payClient.indexOf("const terminalSessionLoggedRef"),
      payClient.indexOf("const terminalSessionLoggedRef") + 900
    )
    expect(section).toContain("if (terminalSessionLoggedRef.current) return")
    expect(section).toContain("terminalSessionLoggedRef.current = true")
  })
})
