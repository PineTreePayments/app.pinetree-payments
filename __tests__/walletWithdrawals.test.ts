import { beforeEach, describe, expect, it, vi } from "vitest"
import { Keypair } from "@solana/web3.js"
import { address as btcAddress, Psbt, networks } from "bitcoinjs-lib"

const mocks = vi.hoisted(() => ({
    getPineTreeWalletProfile: vi.fn(),
    createWalletWithdrawalRequest: vi.fn(),
    getWalletWithdrawalRequest: vi.fn(),
    updateWalletWithdrawalRequest: vi.fn(),
    fetch: vi.fn(),
  }))

vi.mock("@/database/pineTreeWalletProfiles", () => ({
  getPineTreeWalletProfile: mocks.getPineTreeWalletProfile,
}))

vi.mock("@/database/walletWithdrawalRequests", () => ({
  createWalletWithdrawalRequest: mocks.createWalletWithdrawalRequest,
  getWalletWithdrawalRequest: mocks.getWalletWithdrawalRequest,
  updateWalletWithdrawalRequest: mocks.updateWalletWithdrawalRequest,
}))

import {
  completeDynamicWalletWithdrawal,
  createWalletWithdrawalReview,
  prepareDynamicWalletWithdrawal,
  submitWalletWithdrawalRequest,
  validateWalletWithdrawalInput,
  WALLET_WITHDRAWAL_VALIDATION_PATHS,
} from "@/engine/withdrawals/walletWithdrawals"
import { createDefaultWithdrawalSigner } from "@/providers/wallets/withdrawalSigner"
import * as bitcoinNetworkProvider from "@/providers/wallets/bitcoinNetworkProvider"
import type { WithdrawalSigner } from "@/providers/wallets/withdrawalSigner"

function makeSigner(canSign: boolean): WithdrawalSigner & {
  submitWithdrawal: ReturnType<typeof vi.fn>
} {
  return {
    canSignWithdrawal: vi.fn(async () => canSign),
    createWithdrawalReview: vi.fn(async (input) => {
      const estimatedStatus = canSign
        ? "Withdrawal review available" as const
        : "Pending review" as const
      return {
        rail: input.rail,
        asset: input.asset,
        destinationAddress: input.destinationAddress,
        amountDecimal: input.amountDecimal,
        signerEnabled: canSign,
        estimatedStatus,
        message: canSign
          ? "Withdrawal review available"
          : "Withdrawal review available. Signing not enabled yet.",
      }
    }),
    submitWithdrawal: vi.fn(async () => ({
      provider: "test_provider",
      providerReference: "provider_ref_1",
      txHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    })),
  }
}

function makeWithdrawal(overrides: Record<string, unknown> = {}) {
  return {
    id: "withdrawal_1",
    merchant_id: "merchant_1",
    wallet_profile_id: "wallet_profile_1",
    rail: "base",
    asset: "USDC",
    destination_address: "0x1234567890abcdef1234567890abcdef12345678",
    amount_decimal: "12.50",
    status: "review_required",
    provider: null,
    provider_reference: null,
    tx_hash: null,
    unsigned_transaction_payload: null,
    signed_payload: null,
    approval_method: null,
    chain_id: null,
    token_contract: null,
    token_mint: null,
    review_payload: {},
    error_message: null,
    created_at: "2026-06-25T00:00:00.000Z",
    updated_at: "2026-06-25T00:00:00.000Z",
    ...overrides,
  }
}

const BTC_SOURCE = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"
const BTC_DESTINATION = "bc1qw5g6nan4y0p57nrmv69pyqk2xdgtghtm4uuta6"
const BTC_TXID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

function configureBtcExecution() {
  vi.stubEnv("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID", "dynamic_env_1")
  vi.stubEnv("BITCOIN_NETWORK", "mainnet")
  vi.stubEnv("BITCOIN_UTXO_PROVIDER", "esplora")
  vi.stubEnv("BITCOIN_ESPLORA_BASE_URL", "https://mempool.test/api")
  vi.stubEnv("BITCOIN_BROADCAST_ENABLED", "true")
}

function mockBtcProviderFetch(utxoValue = 100_000) {
  mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const target = String(url)
    if (target.endsWith(`/address/${BTC_SOURCE}/utxo`)) {
      return {
        ok: true,
        json: async () => ([{
          txid: BTC_TXID,
          vout: 0,
          value: utxoValue,
          status: { confirmed: true },
        }]),
      } as Response
    }
    if (target.endsWith("/fee-estimates")) {
      return {
        ok: true,
        json: async () => ({ "1": 5, "3": 2, "6": 1, "144": 1, "504": 1 }),
      } as Response
    }
    if (target.endsWith("/tx") && init?.method === "POST") {
      return {
        ok: true,
        text: async () => "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      } as Response
    }
    throw new Error(`Unexpected fetch ${target}`)
  })
}

describe("PineTree Wallet withdrawals", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPineTreeWalletProfile.mockResolvedValue({
      id: "wallet_profile_1",
      merchant_id: "merchant_1",
    })
    mocks.createWalletWithdrawalRequest.mockImplementation(async (input) => ({
      id: "withdrawal_1",
      merchant_id: input.merchantId,
      wallet_profile_id: input.walletProfileId,
      rail: input.rail,
      asset: input.asset,
      destination_address: input.destinationAddress,
      amount_decimal: input.amountDecimal,
      status: input.status,
      provider: input.provider,
      provider_reference: null,
      tx_hash: null,
      unsigned_transaction_payload: input.unsignedTransactionPayload || null,
      signed_payload: input.signedPayload || null,
      approval_method: input.approvalMethod || null,
      chain_id: input.chainId || null,
      token_contract: input.tokenContract || null,
      token_mint: input.tokenMint || null,
      review_payload: input.reviewPayload,
      error_message: input.errorMessage,
      created_at: "2026-06-25T00:00:00.000Z",
      updated_at: "2026-06-25T00:00:00.000Z",
    }))
    mocks.getWalletWithdrawalRequest.mockResolvedValue(makeWithdrawal())
    mocks.updateWalletWithdrawalRequest.mockImplementation(async (_merchantId, _id, input) => ({
      ...makeWithdrawal(),
      ...("status" in input ? { status: input.status } : {}),
      ...("provider" in input ? { provider: input.provider } : {}),
      ...("providerReference" in input ? { provider_reference: input.providerReference } : {}),
      ...("txHash" in input ? { tx_hash: input.txHash } : {}),
      ...("unsignedTransactionPayload" in input ? { unsigned_transaction_payload: input.unsignedTransactionPayload } : {}),
      ...("signedPayload" in input ? { signed_payload: input.signedPayload } : {}),
      ...("approvalMethod" in input ? { approval_method: input.approvalMethod } : {}),
      ...("chainId" in input ? { chain_id: input.chainId } : {}),
      ...("tokenContract" in input ? { token_contract: input.tokenContract } : {}),
      ...("tokenMint" in input ? { token_mint: input.tokenMint } : {}),
      ...("errorMessage" in input ? { error_message: input.errorMessage } : {}),
      ...("reviewPayload" in input ? { review_payload: input.reviewPayload } : {}),
    }))
    vi.unstubAllEnvs()
    global.fetch = mocks.fetch
    mocks.fetch.mockReset()
  })

  it("blocks invalid amount before review", () => {
    expect(() => validateWalletWithdrawalInput({
      rail: "base",
      asset: "ETH",
      destinationAddress: "0x1234567890abcdef1234567890abcdef12345678",
      amountDecimal: "0",
    })).toThrow("Withdrawal amount must be positive.")
  })

  it("blocks empty destination before review", () => {
    expect(() => validateWalletWithdrawalInput({
      rail: "solana",
      asset: "SOL",
      destinationAddress: " ",
      amountDecimal: "1",
    })).toThrow("Destination address is required.")
  })

  it("blocks unsupported rail and asset combinations", () => {
    expect(() => validateWalletWithdrawalInput({
      rail: "bitcoin",
      asset: "USDC",
      destinationAddress: "bc1qdestination",
      amountDecimal: "1",
    })).toThrow("Unsupported rail/asset combination.")
  })

  it("creates a pending review request and never submits when signer is disabled", async () => {
    const signer = makeSigner(false)

    const result = await createWalletWithdrawalReview("merchant_1", {
      rail: "base",
      asset: "USDC",
      destinationAddress: "0x1234567890abcdef1234567890abcdef12345678",
      amountDecimal: "12.50",
    }, signer)

    expect(result.canSubmit).toBe(false)
    expect(result.request.status).toBe("review_required")
    expect(mocks.createWalletWithdrawalRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: "merchant_1",
        walletProfileId: "wallet_profile_1",
        rail: "base",
        asset: "USDC",
        destinationAddress: "0x1234567890abcdef1234567890abcdef12345678",
        amountDecimal: "12.50",
        status: "review_required",
        errorMessage: null,
      })
    )
    expect(signer.submitWithdrawal).not.toHaveBeenCalled()
  })

  it("creates only a review_required request when signer reports enabled", async () => {
    const signer = makeSigner(true)

    const result = await createWalletWithdrawalReview("merchant_1", {
      rail: "solana",
      asset: "SOL",
      destinationAddress: "11111111111111111111111111111111",
      amountDecimal: "1.2",
    }, signer)

    expect(result.canSubmit).toBe(true)
    expect(result.request.status).toBe("review_required")
    expect(signer.submitWithdrawal).not.toHaveBeenCalled()
  })

  it("submit with disabled signer keeps request pending review and never broadcasts", async () => {
    const signer = makeSigner(false)

    const result = await submitWalletWithdrawalRequest("merchant_1", "withdrawal_1", signer)

    expect(result.merchantStatus).toBe("Pending review")
    expect(result.request.status).toBe("review_required")
    expect(result.message).toContain("Withdrawal request submitted")
    expect(signer.submitWithdrawal).not.toHaveBeenCalled()
  })

  it("enabled signer path calls submitWithdrawal exactly once and stores provider reference and tx hash", async () => {
    const signer = makeSigner(true)

    const result = await submitWalletWithdrawalRequest("merchant_1", "withdrawal_1", signer)

    expect(result.merchantStatus).toBe("Processing")
    expect(signer.submitWithdrawal).toHaveBeenCalledTimes(1)
    expect(mocks.updateWalletWithdrawalRequest).toHaveBeenCalledWith(
      "merchant_1",
      "withdrawal_1",
      expect.objectContaining({ status: "pending" })
    )
    expect(mocks.updateWalletWithdrawalRequest).toHaveBeenCalledWith(
      "merchant_1",
      "withdrawal_1",
      expect.objectContaining({
        status: "processing",
        provider: "test_provider",
        providerReference: "provider_ref_1",
        txHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      })
    )
  })

  it("failed provider response sets failed status with a merchant-safe error", async () => {
    const signer = makeSigner(true)
    signer.submitWithdrawal.mockRejectedValueOnce(new Error("private key provider rejected request"))

    const result = await submitWalletWithdrawalRequest("merchant_1", "withdrawal_1", signer)

    expect(result.merchantStatus).toBe("Withdrawal failed")
    expect(result.request.status).toBe("failed")
    expect(result.request.error_message).toBe("provider provider rejected request")
  })

  it("merchant cannot submit another merchant's withdrawal", async () => {
    mocks.getWalletWithdrawalRequest.mockResolvedValueOnce(null)

    await expect(
      submitWalletWithdrawalRequest("merchant_2", "withdrawal_1", makeSigner(true))
    ).rejects.toThrow("Withdrawal request not found.")
  })

  it("validation paths exist for Base ETH, Base USDC, Solana SOL, Solana USDC, and Bitcoin BTC", () => {
    expect(WALLET_WITHDRAWAL_VALIDATION_PATHS.baseEth).toMatchObject({ rail: "base", asset: "ETH" })
    expect(WALLET_WITHDRAWAL_VALIDATION_PATHS.baseUsdc).toMatchObject({
      rail: "base",
      asset: "USDC",
      tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
    })
    expect(WALLET_WITHDRAWAL_VALIDATION_PATHS.solanaSol).toMatchObject({ rail: "solana", asset: "SOL" })
    expect(WALLET_WITHDRAWAL_VALIDATION_PATHS.solanaUsdc).toMatchObject({
      rail: "solana",
      asset: "USDC",
      mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      decimals: 6,
    })
    expect(WALLET_WITHDRAWAL_VALIDATION_PATHS.bitcoinBtc).toMatchObject({ rail: "bitcoin", asset: "BTC" })
  })

  it("prefers Dynamic browser approval when Dynamic is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID", "dynamic_env_1")

    const result = await createWalletWithdrawalReview("merchant_1", {
      rail: "base",
      asset: "ETH",
      destinationAddress: "0x1234567890abcdef1234567890abcdef12345678",
      amountDecimal: "0.01",
    }, createDefaultWithdrawalSigner())

    expect(result.canSubmit).toBe(true)
    expect(result.review.approvalMethod).toBe("dynamic_browser")
    expect(result.review.message).toContain("Approve with PineTree Wallet")
    expect(mocks.createWalletWithdrawalRequest).toHaveBeenCalledWith(expect.objectContaining({
      provider: "dynamic",
      approvalMethod: "dynamic_browser",
    }))
  })

  it("missing Dynamic config keeps withdrawals pending review", async () => {
    vi.stubEnv("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID", "")

    const result = await createWalletWithdrawalReview("merchant_1", {
      rail: "base",
      asset: "ETH",
      destinationAddress: "0x1234567890abcdef1234567890abcdef12345678",
      amountDecimal: "0.01",
    }, createDefaultWithdrawalSigner())

    expect(result.canSubmit).toBe(false)
    expect(result.review.approvalMethod).toBe("manual_review")
    expect(mocks.createWalletWithdrawalRequest).toHaveBeenCalledWith(expect.objectContaining({
      provider: null,
      approvalMethod: "manual_review",
    }))
  })

  it("Bitcoin remains pending review with Dynamic configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID", "dynamic_env_1")

    const result = await createWalletWithdrawalReview("merchant_1", {
      rail: "bitcoin",
      asset: "BTC",
      destinationAddress: BTC_DESTINATION,
      amountDecimal: "0.001",
    }, createDefaultWithdrawalSigner())

    expect(result.canSubmit).toBe(false)
    expect(result.review.approvalMethod).toBe("manual_review")
  })

  it("Bitcoin remains pending review if BTC provider env is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID", "dynamic_env_1")

    const result = await createWalletWithdrawalReview("merchant_1", {
      rail: "bitcoin",
      asset: "BTC",
      destinationAddress: BTC_DESTINATION,
      amountDecimal: "0.0001",
    }, createDefaultWithdrawalSigner())

    expect(result.canSubmit).toBe(false)
    expect(result.review.approvalMethod).toBe("manual_review")
  })

  it("Bitcoin remains pending review when BTC broadcast is not enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID", "dynamic_env_1")
    vi.stubEnv("BITCOIN_NETWORK", "mainnet")
    vi.stubEnv("BITCOIN_UTXO_PROVIDER", "esplora")
    vi.stubEnv("BITCOIN_ESPLORA_BASE_URL", "https://mempool.test/api")
    vi.stubEnv("BITCOIN_BROADCAST_ENABLED", "false")

    const result = await createWalletWithdrawalReview("merchant_1", {
      rail: "bitcoin",
      asset: "BTC",
      destinationAddress: BTC_DESTINATION,
      amountDecimal: "0.0001",
    }, createDefaultWithdrawalSigner())

    expect(result.canSubmit).toBe(false)
    expect(result.review.approvalMethod).toBe("manual_review")
  })

  it("rejects invalid and wrong-network BTC destination addresses", () => {
    vi.stubEnv("BITCOIN_NETWORK", "mainnet")
    expect(() => validateWalletWithdrawalInput({
      rail: "bitcoin",
      asset: "BTC",
      destinationAddress: "not-a-btc-address",
      amountDecimal: "0.001",
    })).toThrow("Destination address is invalid")
    expect(() => validateWalletWithdrawalInput({
      rail: "bitcoin",
      asset: "BTC",
      destinationAddress: "tb1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjaq5ayy",
      amountDecimal: "0.001",
    })).toThrow("Destination address is invalid")
  })

  it("validates the source wallet belongs to the merchant profile before preparing", async () => {
    mocks.getWalletWithdrawalRequest.mockResolvedValueOnce(makeWithdrawal({
      approval_method: "dynamic_browser",
      provider: "dynamic",
      wallet_profile_id: "wallet_profile_other",
    }))

    await expect(
      prepareDynamicWalletWithdrawal("merchant_1", "withdrawal_1")
    ).rejects.toThrow("PineTree Wallet profile not found.")
  })

  it("prepares a Base ETH Dynamic transaction payload from the saved source wallet", async () => {
    mocks.getPineTreeWalletProfile.mockResolvedValueOnce({
      id: "wallet_profile_1",
      merchant_id: "merchant_1",
      base_address: "0x9999999999999999999999999999999999999999",
      solana_address: null,
    })
    mocks.getWalletWithdrawalRequest.mockResolvedValueOnce(makeWithdrawal({
      rail: "base",
      asset: "ETH",
      approval_method: "dynamic_browser",
      provider: "dynamic",
      amount_decimal: "0.5",
    }))

    const result = await prepareDynamicWalletWithdrawal("merchant_1", "withdrawal_1")

    expect(result.payload).toMatchObject({
      kind: "evm_transaction",
      chainId: 8453,
      from: "0x9999999999999999999999999999999999999999",
      to: "0x1234567890abcdef1234567890abcdef12345678",
      value: "0x6f05b59d3b20000",
      data: "0x",
    })
    expect(mocks.updateWalletWithdrawalRequest).toHaveBeenCalledWith(
      "merchant_1",
      "withdrawal_1",
      expect.objectContaining({ chainId: "8453", approvalMethod: "dynamic_browser" })
    )
  })

  it("prepares a Base USDC Dynamic transaction payload with the Base token contract", async () => {
    mocks.getPineTreeWalletProfile.mockResolvedValueOnce({
      id: "wallet_profile_1",
      merchant_id: "merchant_1",
      base_address: "0x9999999999999999999999999999999999999999",
      solana_address: null,
    })
    mocks.getWalletWithdrawalRequest.mockResolvedValueOnce(makeWithdrawal({
      rail: "base",
      asset: "USDC",
      approval_method: "dynamic_browser",
      provider: "dynamic",
      amount_decimal: "12.5",
    }))

    const result = await prepareDynamicWalletWithdrawal("merchant_1", "withdrawal_1")

    expect(result.payload).toMatchObject({
      kind: "evm_transaction",
      chainId: 8453,
      from: "0x9999999999999999999999999999999999999999",
      to: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      value: "0x0",
    })
    expect("data" in result.payload ? result.payload.data : "").toMatch(/^0xa9059cbb/)
    expect(mocks.updateWalletWithdrawalRequest).toHaveBeenCalledWith(
      "merchant_1",
      "withdrawal_1",
      expect.objectContaining({
        tokenContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      })
    )
  })

  it("prepares a Solana SOL Dynamic transaction payload", async () => {
    const source = Keypair.generate().publicKey.toBase58()
    const destination = Keypair.generate().publicKey.toBase58()
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: "1",
        result: {
          context: { slot: 1 },
          value: {
            blockhash: "11111111111111111111111111111111",
            lastValidBlockHeight: 123,
          },
        },
      }),
    } as Response)
    mocks.getPineTreeWalletProfile.mockResolvedValueOnce({
      id: "wallet_profile_1",
      merchant_id: "merchant_1",
      base_address: null,
      solana_address: source,
    })
    mocks.getWalletWithdrawalRequest.mockResolvedValueOnce(makeWithdrawal({
      rail: "solana",
      asset: "SOL",
      destination_address: destination,
      amount_decimal: "0.25",
      approval_method: "dynamic_browser",
      provider: "dynamic",
    }))

    const result = await prepareDynamicWalletWithdrawal("merchant_1", "withdrawal_1")

    expect(result.payload).toMatchObject({
      kind: "solana_transaction",
      from: source,
    })
    expect("transactionBase64" in result.payload ? result.payload.transactionBase64 : "").toMatch(/^[A-Za-z0-9+/=]+$/)
  })

  it("prepares a Solana USDC Dynamic transaction payload with the USDC mint", async () => {
    const source = Keypair.generate().publicKey.toBase58()
    const destination = Keypair.generate().publicKey.toBase58()
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: "1",
        result: {
          context: { slot: 1 },
          value: {
            blockhash: "11111111111111111111111111111111",
            lastValidBlockHeight: 123,
          },
        },
      }),
    } as Response).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: "2",
        result: { context: { slot: 1 }, value: null },
      }),
    } as Response)
    mocks.getPineTreeWalletProfile.mockResolvedValueOnce({
      id: "wallet_profile_1",
      merchant_id: "merchant_1",
      base_address: null,
      solana_address: source,
    })
    mocks.getWalletWithdrawalRequest.mockResolvedValueOnce(makeWithdrawal({
      rail: "solana",
      asset: "USDC",
      destination_address: destination,
      amount_decimal: "1.25",
      approval_method: "dynamic_browser",
      provider: "dynamic",
    }))

    const result = await prepareDynamicWalletWithdrawal("merchant_1", "withdrawal_1")

    expect(result.payload).toMatchObject({
      kind: "solana_transaction",
      from: source,
    })
    expect(mocks.updateWalletWithdrawalRequest).toHaveBeenCalledWith(
      "merchant_1",
      "withdrawal_1",
      expect.objectContaining({
        tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      })
    )
  })

  it("prepares a Bitcoin PSBT using server-fetched UTXOs and returns change to the merchant BTC address", async () => {
    configureBtcExecution()
    mockBtcProviderFetch(100_000)
    mocks.getPineTreeWalletProfile.mockResolvedValueOnce({
      id: "wallet_profile_1",
      merchant_id: "merchant_1",
      btc_address: BTC_SOURCE,
      bitcoin_onchain_address: null,
      btc_address_type: "native_segwit",
    })
    mocks.getWalletWithdrawalRequest.mockResolvedValueOnce(makeWithdrawal({
      rail: "bitcoin",
      asset: "BTC",
      destination_address: BTC_DESTINATION,
      amount_decimal: "0.0005",
      approval_method: "dynamic_browser",
      provider: "dynamic",
    }))

    const result = await prepareDynamicWalletWithdrawal("merchant_1", "withdrawal_1")

    expect(result.payload).toMatchObject({
      kind: "bitcoin_psbt",
      network: "mainnet",
      from: BTC_SOURCE,
      signInputs: [{ address: BTC_SOURCE, index: 0 }],
    })
    const psbt = Psbt.fromBase64(result.payload.kind === "bitcoin_psbt" ? result.payload.psbtBase64 : "", { network: networks.bitcoin })
    const outputAddresses = psbt.txOutputs.map((output) => btcAddress.fromOutputScript(output.script, networks.bitcoin))
    expect(outputAddresses).toContain(BTC_DESTINATION)
    expect(outputAddresses).toContain(BTC_SOURCE)
    expect(mocks.updateWalletWithdrawalRequest).toHaveBeenCalledWith(
      "merchant_1",
      "withdrawal_1",
      expect.objectContaining({
        chainId: "bitcoin-mainnet",
        unsignedTransactionPayload: expect.objectContaining({
          kind: "bitcoin_psbt",
          psbtBase64: expect.any(String),
          sourceAddress: BTC_SOURCE,
          destinationAddress: BTC_DESTINATION,
          utxoCount: 1,
        }),
      })
    )
  })

  it("rejects BTC amount greater than spendable balance after fees", async () => {
    configureBtcExecution()
    mockBtcProviderFetch(10_000)
    mocks.getPineTreeWalletProfile.mockResolvedValueOnce({
      id: "wallet_profile_1",
      merchant_id: "merchant_1",
      btc_address: BTC_SOURCE,
      bitcoin_onchain_address: null,
      btc_address_type: "native_segwit",
    })
    mocks.getWalletWithdrawalRequest.mockResolvedValueOnce(makeWithdrawal({
      rail: "bitcoin",
      asset: "BTC",
      destination_address: BTC_DESTINATION,
      amount_decimal: "0.0005",
      approval_method: "dynamic_browser",
      provider: "dynamic",
    }))

    await expect(
      prepareDynamicWalletWithdrawal("merchant_1", "withdrawal_1")
    ).rejects.toThrow("Withdrawal amount exceeds spendable Bitcoin balance")
  })

  it("browser cannot choose BTC source address or provide UTXOs", async () => {
    configureBtcExecution()
    mockBtcProviderFetch(100_000)
    mocks.getPineTreeWalletProfile.mockResolvedValueOnce({
      id: "wallet_profile_1",
      merchant_id: "merchant_1",
      btc_address: BTC_SOURCE,
      bitcoin_onchain_address: null,
      btc_address_type: "native_segwit",
    })
    mocks.getWalletWithdrawalRequest.mockResolvedValueOnce(makeWithdrawal({
      rail: "bitcoin",
      asset: "BTC",
      destination_address: BTC_DESTINATION,
      amount_decimal: "0.0005",
      approval_method: "dynamic_browser",
      provider: "dynamic",
      review_payload: {
        sourceAddress: "bc1qattacker0000000000000000000000000000000",
        utxos: [{ txid: "bad", vout: 0, value: 999999 }],
      },
    }))

    const result = await prepareDynamicWalletWithdrawal("merchant_1", "withdrawal_1")

    expect(result.sourceAddress).toBe(BTC_SOURCE)
    expect(mocks.fetch).toHaveBeenCalledWith(
      `https://mempool.test/api/address/${BTC_SOURCE}/utxo`,
      expect.any(Object)
    )
  })

  it("stores Dynamic provider reference and tx hash after browser approval", async () => {
    mocks.getWalletWithdrawalRequest.mockResolvedValueOnce(makeWithdrawal({
      approval_method: "dynamic_browser",
      provider: "dynamic",
      status: "pending",
      unsigned_transaction_payload: { kind: "evm_transaction" },
    }))

    const result = await completeDynamicWalletWithdrawal("merchant_1", "withdrawal_1", {
      txHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      providerReference: "dynamic_ref_1",
      signedPayload: { dynamic_wallet_address: "0x9999999999999999999999999999999999999999" },
    })

    expect(result.merchantStatus).toBe("Processing")
    expect(mocks.updateWalletWithdrawalRequest).toHaveBeenCalledWith(
      "merchant_1",
      "withdrawal_1",
      expect.objectContaining({
        status: "processing",
        provider: "dynamic",
        providerReference: "dynamic_ref_1",
        txHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        signedPayload: { dynamic_wallet_address: "0x9999999999999999999999999999999999999999" },
      })
    )
  })

  it("does not confirm a Dynamic withdrawal without a valid tx hash", async () => {
    mocks.getWalletWithdrawalRequest.mockResolvedValueOnce(makeWithdrawal({
      approval_method: "dynamic_browser",
      provider: "dynamic",
      status: "pending",
      unsigned_transaction_payload: { kind: "evm_transaction" },
    }))

    await expect(
      completeDynamicWalletWithdrawal("merchant_1", "withdrawal_1", { txHash: "" })
    ).rejects.toThrow("Transaction reference is invalid")

    expect(mocks.updateWalletWithdrawalRequest).not.toHaveBeenCalledWith(
      "merchant_1",
      "withdrawal_1",
      expect.objectContaining({ status: "confirmed" })
    )
  })

  it("stores BTC txid after Dynamic signed PSBT broadcast without confirming immediately", async () => {
    const finalizeSpy = vi.spyOn(bitcoinNetworkProvider, "finalizeAndBroadcastBitcoinPsbt").mockResolvedValueOnce({
      txid: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      rawTxHex: "020000000001",
    })
    mocks.getWalletWithdrawalRequest.mockResolvedValueOnce(makeWithdrawal({
      rail: "bitcoin",
      asset: "BTC",
      approval_method: "dynamic_browser",
      provider: "dynamic",
      status: "pending",
      unsigned_transaction_payload: {
        kind: "bitcoin_psbt",
        psbtBase64: "cHNidP8BAAo=",
        sourceAddress: BTC_SOURCE,
        destinationAddress: BTC_DESTINATION,
        amountSats: 50_000,
      },
    }))

    const result = await completeDynamicWalletWithdrawal("merchant_1", "withdrawal_1", {
      txHash: "",
      signedPsbtBase64: "signed-psbt-base64",
      providerReference: "dynamic:bitcoin-psbt",
    })

    expect(finalizeSpy).toHaveBeenCalledWith(expect.objectContaining({
      signedPsbtBase64: "signed-psbt-base64",
      preparedPayload: expect.objectContaining({ kind: "bitcoin_psbt" }),
    }))
    expect(result.merchantStatus).toBe("Processing")
    expect(mocks.updateWalletWithdrawalRequest).toHaveBeenCalledWith(
      "merchant_1",
      "withdrawal_1",
      expect.objectContaining({
        status: "processing",
        provider: "dynamic",
        providerReference: "dynamic:bitcoin-psbt",
        txHash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      })
    )
    expect(mocks.updateWalletWithdrawalRequest).not.toHaveBeenCalledWith(
      "merchant_1",
      "withdrawal_1",
      expect.objectContaining({ status: "confirmed" })
    )
  })
})
