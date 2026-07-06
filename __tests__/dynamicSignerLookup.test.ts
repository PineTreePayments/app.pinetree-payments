import { describe, expect, it, vi } from "vitest"
import {
  DYNAMIC_SOLANA_SIGN_TIMEOUT_MESSAGE,
  DYNAMIC_SOLANA_SIGN_TIMEOUT_MS,
  assertDynamicWalletChain,
  classifyDynamicWalletChain,
  dynamicWalletSupportsRail,
  findDynamicApprovalWalletForSource,
  findDynamicApprovalWalletForSourceAsync,
  findDynamicWalletForSource,
  getDynamicWalletSearchList,
  inferredSignerRailForWallet,
  normalizeDynamicSolanaSignature,
  railForDynamicWalletChain,
  signDynamicSolanaTransactionWithActiveAccount,
} from "@/lib/wallets/dynamicSignerLookup"

describe("Dynamic signer lookup", () => {
  it("searches primaryWallet before all Dynamic wallets", () => {
    const primary = { address: "primary", getWalletClient: vi.fn() }
    const secondary = { address: "secondary", getWalletClient: vi.fn() }

    expect(getDynamicWalletSearchList([secondary, primary], primary)).toEqual([primary, secondary])
  })

  it("matches Solana wallets by exact address after reconnect", () => {
    const solanaWallet = {
      address: "SoLExact111111111111111111111111111111111",
      chain: "solana",
      signAndSendTransaction: vi.fn(),
    }

    expect(findDynamicApprovalWalletForSource(
      [],
      solanaWallet,
      "solana",
      "SoLExact111111111111111111111111111111111"
    )).toBe(solanaWallet)
    expect(findDynamicWalletForSource(
      [solanaWallet],
      null,
      "solexact111111111111111111111111111111111",
      "solana"
    )).toBeNull()
  })

  it("matches Base/EVM wallets case-insensitively after reconnect", () => {
    const baseWallet = {
      address: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
      chain: "evm",
      getWalletClient: vi.fn(),
    }

    expect(findDynamicApprovalWalletForSource(
      [baseWallet],
      null,
      "base",
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
    )).toBe(baseWallet)
  })

  it("searches embedded additional addresses for Solana and Base signers", () => {
    const solanaEmbeddedWallet = {
      address: "0xprimary000000000000000000000000000000000",
      chain: "solana",
      additionalAddresses: [
        { address: "SolanaEmbedded1111111111111111111111111111" },
      ],
      signAndSendTransaction: vi.fn(),
    }
    const baseEmbeddedWallet = {
      address: "0xprimary000000000000000000000000000000000",
      chain: "evm",
      additionalAddresses: [
        { address: "0x9999999999999999999999999999999999999999" },
      ],
      getWalletClient: vi.fn(),
    }

    expect(findDynamicApprovalWalletForSource(
      [],
      solanaEmbeddedWallet,
      "solana",
      "SolanaEmbedded1111111111111111111111111111"
    )).toBe(solanaEmbeddedWallet)
    expect(findDynamicApprovalWalletForSource(
      [],
      baseEmbeddedWallet,
      "base",
      "0x9999999999999999999999999999999999999999"
    )).toBe(baseEmbeddedWallet)
  })

  it("requires the matching wallet to expose the rail signer method", () => {
    const addressOnly = { address: "0x1234567890abcdef1234567890abcdef12345678" }

    expect(dynamicWalletSupportsRail(addressOnly, "base")).toBe(false)
    expect(findDynamicApprovalWalletForSource(
      [addressOnly],
      null,
      "base",
      "0x1234567890abcdef1234567890abcdef12345678"
    )).toBeNull()
  })

  it("signs with a Solana wallet address and passes the active account", async () => {
    const signAndSendTransaction = vi.fn().mockResolvedValue({ signature: "sig-address" })
    const wallet = {
      address: "SolanaAddress111111111111111111111111111111",
      chain: "solana",
      signAndSendTransaction,
    }

    await expect(signDynamicSolanaTransactionWithActiveAccount(
      wallet,
      "tx",
      "SolanaAddress111111111111111111111111111111"
    )).resolves.toMatchObject({ txHash: "sig-address" })
    expect(signAndSendTransaction).toHaveBeenCalledWith(
      "tx",
      expect.objectContaining({ accountAddress: "SolanaAddress111111111111111111111111111111" })
    )
  })

  it("signs with a Solana wallet publicKey", async () => {
    const signAndSendTransaction = vi.fn().mockResolvedValue({ signature: "sig-public-key" })
    const wallet = {
      chain: "solana",
      publicKey: { toBase58: () => "SolanaPublicKey111111111111111111111111111" },
      signAndSendTransaction,
    }

    await expect(signDynamicSolanaTransactionWithActiveAccount(
      wallet,
      "tx",
      "SolanaPublicKey111111111111111111111111111"
    )).resolves.toMatchObject({ txHash: "sig-public-key" })
  })

  it("signs with a Solana connector activeAccount", async () => {
    const signAndSendTransaction = vi.fn().mockResolvedValue("sig-active-account")
    const wallet = {
      chain: "solana",
      connector: {
        activeAccount: { address: "SolanaActive11111111111111111111111111111" },
        signAndSendTransaction,
      },
    }

    await expect(signDynamicSolanaTransactionWithActiveAccount(
      wallet,
      "tx",
      "SolanaActive11111111111111111111111111111"
    )).resolves.toMatchObject({ txHash: "sig-active-account" })
    expect(signAndSendTransaction).toHaveBeenCalledWith(
      "tx",
      expect.objectContaining({ accountAddress: "SolanaActive11111111111111111111111111111" })
    )
  })

  it("signs with a Solana connector getPublicKey", async () => {
    const signAndSendTransaction = vi.fn().mockResolvedValue({ signature: "sig-get-public-key" })
    const wallet = {
      chain: "solana",
      connector: {
        getPublicKey: vi.fn().mockResolvedValue({ toBase58: () => "SolanaGetPublicKey11111111111111111111111" }),
        signAndSendTransaction,
      },
    }

    await expect(signDynamicSolanaTransactionWithActiveAccount(
      wallet,
      "tx",
      "SolanaGetPublicKey11111111111111111111111"
    )).resolves.toMatchObject({ txHash: "sig-get-public-key" })
  })

  it("blocks Solana signing when the active account does not match the prepared source", async () => {
    const signAndSendTransaction = vi.fn().mockResolvedValue({ signature: "sig" })
    const wallet = {
      address: "SolanaActual111111111111111111111111111111",
      chain: "solana",
      signAndSendTransaction,
    }

    await expect(signDynamicSolanaTransactionWithActiveAccount(
      wallet,
      "tx",
      "SolanaSource111111111111111111111111111111"
    )).rejects.toThrow("Dynamic Solana wallet active account does not match the PineTree Wallet source address.")
    expect(signAndSendTransaction).not.toHaveBeenCalled()
  })

  it("returns a clear error when no Solana active account address is available", async () => {
    const signAndSendTransaction = vi.fn().mockResolvedValue({ signature: "sig" })

    await expect(signDynamicSolanaTransactionWithActiveAccount(
      { chain: "solana", signAndSendTransaction },
      "tx",
      "SolanaSource111111111111111111111111111111"
    )).rejects.toThrow("Dynamic Solana wallet is connected, but no active Solana account address was available.")
    expect(signAndSendTransaction).not.toHaveBeenCalled()
  })

  it("activates Dynamic WaaS SVM by account address before signing", async () => {
    const getWalletClientByAddress = vi.fn()
    const signAndSendTransaction = vi.fn().mockResolvedValue("sig-waas")
    const wallet = {
      address: "SolanaWaas11111111111111111111111111111111",
      chain: "solana",
      connector: {
        getWalletClientByAddress,
        signAndSendTransaction,
      },
    }

    await expect(signDynamicSolanaTransactionWithActiveAccount(
      wallet,
      "tx",
      "SolanaWaas11111111111111111111111111111111"
    )).resolves.toMatchObject({ txHash: "sig-waas" })
    expect(getWalletClientByAddress).toHaveBeenCalledWith({
      accountAddress: "SolanaWaas11111111111111111111111111111111",
    })
  })

  it("runs the pre-modal callback immediately before Solana signAndSendTransaction", async () => {
    const calls: string[] = []
    const signAndSendTransaction = vi.fn().mockImplementation(async () => {
      calls.push("sign")
      return "sig-solana"
    })
    const wallet = {
      address: "SolanaModal111111111111111111111111111111",
      chain: "solana",
      signAndSendTransaction,
    }

    await expect(signDynamicSolanaTransactionWithActiveAccount(
      wallet,
      "tx",
      "SolanaModal111111111111111111111111111111",
      undefined,
      () => calls.push("before-modal")
    )).resolves.toMatchObject({ txHash: "sig-solana" })

    expect(calls).toEqual(["before-modal", "sign"])
  })

  it("normalizes Dynamic Solana sign results into a tx hash/provider reference", () => {
    expect(normalizeDynamicSolanaSignature("sig-string")).toBe("sig-string")
    expect(normalizeDynamicSolanaSignature({ signature: "sig-object" })).toBe("sig-object")
    expect(normalizeDynamicSolanaSignature({ txHash: "sig-hash" })).toBe("sig-hash")
    expect(normalizeDynamicSolanaSignature({ transactionSignature: "sig-transaction" })).toBe("sig-transaction")
    expect(normalizeDynamicSolanaSignature({ result: { signature: "sig-nested" } })).toBe("sig-nested")
    expect(normalizeDynamicSolanaSignature({ signatures: ["sig-array"] })).toBe("sig-array")
  })

  it("times out a Solana Dynamic signing promise that never resolves", async () => {
    vi.useFakeTimers()
    const signAndSendTransaction = vi.fn().mockReturnValue(new Promise(() => undefined))
    const wallet = {
      address: "SolanaTimeout1111111111111111111111111111",
      chain: "solana",
      signAndSendTransaction,
    }

    const pending = signDynamicSolanaTransactionWithActiveAccount(
      wallet,
      "tx",
      "SolanaTimeout1111111111111111111111111111"
    )

    const assertion = expect(pending).rejects.toThrow(DYNAMIC_SOLANA_SIGN_TIMEOUT_MESSAGE)
    await vi.advanceTimersByTimeAsync(DYNAMIC_SOLANA_SIGN_TIMEOUT_MS)
    await assertion
    vi.useRealTimers()
  })

  it("classifies Dynamic wallet chains from wallet and connector metadata", () => {
    expect(classifyDynamicWalletChain({ chain: "solana" })).toBe("solana")
    expect(classifyDynamicWalletChain({ connector: { connectedChain: "base" } })).toBe("evm")
    expect(classifyDynamicWalletChain({ walletConnector: { key: "bitcoin" } })).toBe("bitcoin")
    expect(classifyDynamicWalletChain({ connector: { key: "dynamicwaas", chainName: "SVM" } })).toBe("solana")
    expect(classifyDynamicWalletChain({ connector: { key: "dynamicwaas", chainName: "EVM" } })).toBe("evm")
    expect(classifyDynamicWalletChain({})).toBe("unknown")
  })

  it("Solana withdrawal ignores Bitcoin primaryWallet", () => {
    const bitcoinPrimary = {
      address: "SolanaSource111111111111111111111111111111",
      chain: "bitcoin",
      connector: { key: "bitcoin" },
      signAndSendTransaction: vi.fn(),
    }
    const solanaWallet = {
      address: "SolanaSource111111111111111111111111111111",
      chain: "solana",
      signAndSendTransaction: vi.fn(),
    }

    expect(findDynamicApprovalWalletForSource(
      [solanaWallet],
      bitcoinPrimary,
      "solana",
      "SolanaSource111111111111111111111111111111"
    )).toBe(solanaWallet)
  })

  it("Solana withdrawal ignores EVM wallet", () => {
    const evmWallet = {
      address: "SolanaSource111111111111111111111111111111",
      chain: "evm",
      signAndSendTransaction: vi.fn(),
    }
    const solanaWallet = {
      address: "SolanaSource111111111111111111111111111111",
      chain: "solana",
      signAndSendTransaction: vi.fn(),
    }

    expect(findDynamicApprovalWalletForSource(
      [evmWallet, solanaWallet],
      null,
      "solana",
      "SolanaSource111111111111111111111111111111"
    )).toBe(solanaWallet)
  })

  it("Solana withdrawal selects Solana wallet from useUserWallets", () => {
    const solanaWallet = {
      address: "SolanaRuntime1111111111111111111111111111",
      chain: "solana",
      connector: { key: "dynamicwaas-svm" },
      signAndSendTransaction: vi.fn(),
    }

    expect(findDynamicApprovalWalletForSource(
      [solanaWallet],
      null,
      "solana",
      "SolanaRuntime1111111111111111111111111111"
    )).toBe(solanaWallet)
  })

  it("Solana signing throws clear mismatch if only Bitcoin wallet exists", async () => {
    const bitcoinWallet = {
      address: "SolanaSource111111111111111111111111111111",
      chain: "bitcoin",
      signAndSendTransaction: vi.fn(),
    }

    await expect(signDynamicSolanaTransactionWithActiveAccount(
      bitcoinWallet,
      "tx",
      "SolanaSource111111111111111111111111111111"
    )).rejects.toThrow("Dynamic signer chain mismatch: expected Solana signer.")
  })

  it("Base withdrawal ignores Bitcoin primaryWallet", () => {
    const bitcoinPrimary = {
      address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      chain: "bitcoin",
      getWalletClient: vi.fn(),
    }
    const evmWallet = {
      address: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
      chain: "evm",
      getWalletClient: vi.fn(),
    }

    expect(findDynamicApprovalWalletForSource(
      [evmWallet],
      bitcoinPrimary,
      "base",
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
    )).toBe(evmWallet)
  })

  it("Base withdrawal ignores Solana wallet", () => {
    const solanaWallet = {
      address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      chain: "solana",
      getWalletClient: vi.fn(),
    }
    const evmWallet = {
      address: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
      chain: "evm",
      getWalletClient: vi.fn(),
    }

    expect(findDynamicApprovalWalletForSource(
      [solanaWallet, evmWallet],
      null,
      "base",
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
    )).toBe(evmWallet)
  })

  it("Base selects EVM wallet", () => {
    const evmWallet = {
      address: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
      chain: "evm",
      connector: { connectedChain: "base" },
      getWalletClient: vi.fn(),
    }

    expect(findDynamicApprovalWalletForSource(
      [evmWallet],
      null,
      "base",
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
    )).toBe(evmWallet)
  })

  it("async profile sync signer lookup matches Dynamic WaaS active account address", async () => {
    const baseWallet = {
      chain: "EVM",
      connector: {
        connectedChain: "EVM",
        getActiveAccountAddress: vi.fn().mockResolvedValue("0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD"),
        getWalletClient: vi.fn(),
      },
    }
    const solanaWallet = {
      chain: "SOL",
      connector: {
        connectedChain: "SOL",
        getActiveAccountAddress: vi.fn().mockResolvedValue("SolanaAsync11111111111111111111111111111"),
        signAndSendTransaction: vi.fn(),
      },
    }

    await expect(findDynamicApprovalWalletForSourceAsync(
      [baseWallet],
      null,
      "base",
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
    )).resolves.toBe(baseWallet)
    await expect(findDynamicApprovalWalletForSourceAsync(
      [solanaWallet],
      null,
      "solana",
      "SolanaAsync11111111111111111111111111111"
    )).resolves.toBe(solanaWallet)
  })

  it("async profile sync signer lookup matches Dynamic connected accounts", async () => {
    const solanaWallet = {
      chain: "SOL",
      connector: {
        connectedChain: "SOL",
        getConnectedAccounts: vi.fn().mockResolvedValue(["SolanaConnected111111111111111111111111111"]),
        signAndSendTransaction: vi.fn(),
      },
    }

    await expect(findDynamicApprovalWalletForSourceAsync(
      [solanaWallet],
      null,
      "solana",
      "SolanaConnected111111111111111111111111111"
    )).resolves.toBe(solanaWallet)
  })

  it("primaryWallet does not override requested rail", () => {
    const bitcoinPrimary = {
      address: "SharedSource11111111111111111111111111111",
      chain: "bitcoin",
      signAndSendTransaction: vi.fn(),
    }
    const solanaWallet = {
      address: "SharedSource11111111111111111111111111111",
      chain: "solana",
      signAndSendTransaction: vi.fn(),
    }

    expect(findDynamicApprovalWalletForSource(
      [solanaWallet],
      bitcoinPrimary,
      "solana",
      "SharedSource11111111111111111111111111111"
    )).toBe(solanaWallet)
  })

  it("sourceAddress match cannot override wrong chain", () => {
    const bitcoinWallet = {
      address: "SharedSource11111111111111111111111111111",
      chain: "bitcoin",
      signAndSendTransaction: vi.fn(),
    }

    expect(findDynamicApprovalWalletForSource(
      [bitcoinWallet],
      null,
      "solana",
      "SharedSource11111111111111111111111111111"
    )).toBeNull()
  })

  it("never selects a Bitcoin signer for Solana or Base assets", () => {
    const bitcoinWallet = {
      address: "SharedSource11111111111111111111111111111",
      chain: "bitcoin",
      signPsbt: vi.fn(),
    }

    expect(findDynamicApprovalWalletForSource(
      [bitcoinWallet],
      bitcoinWallet,
      "solana",
      "SharedSource11111111111111111111111111111"
    )).toBeNull()
    expect(findDynamicApprovalWalletForSource(
      [bitcoinWallet],
      bitcoinWallet,
      "base",
      "SharedSource11111111111111111111111111111"
    )).toBeNull()
    expect(dynamicWalletSupportsRail(bitcoinWallet, "solana")).toBe(false)
    expect(dynamicWalletSupportsRail(bitcoinWallet, "base")).toBe(false)
  })

  it("blocks mismatched signer rails before calling a Dynamic approval method", () => {
    const bitcoinWallet = {
      address: "SharedSource11111111111111111111111111111",
      chain: "bitcoin",
      signPsbt: vi.fn(),
    }

    expect(() => assertDynamicWalletChain(bitcoinWallet, "solana"))
      .toThrow("Dynamic signer chain mismatch: expected Solana signer.")
    expect(() => assertDynamicWalletChain(bitcoinWallet, "base"))
      .toThrow("Dynamic signer chain mismatch: expected EVM signer.")
    expect(bitcoinWallet.signPsbt).not.toHaveBeenCalled()
  })

  it("railForDynamicWalletChain maps each classified chain back to its withdrawal rail", () => {
    expect(railForDynamicWalletChain("solana")).toBe("solana")
    expect(railForDynamicWalletChain("evm")).toBe("base")
    expect(railForDynamicWalletChain("bitcoin")).toBe("bitcoin")
    expect(railForDynamicWalletChain("unknown")).toBe("unknown")
  })

  it("inferredSignerRailForWallet reports bitcoin for a Bitcoin-classified wallet, never solana", () => {
    const bitcoinWallet = {
      address: "SharedSource11111111111111111111111111111",
      chain: "bitcoin",
      signPsbt: vi.fn(),
    }
    expect(inferredSignerRailForWallet(bitcoinWallet)).toBe("bitcoin")
    expect(inferredSignerRailForWallet(bitcoinWallet)).not.toBe("solana")
  })

  it("inferredSignerRailForWallet reports solana for a Solana-classified wallet", () => {
    const solanaWallet = {
      address: "SolanaSource111111111111111111111111111111",
      chain: "solana",
      signAndSendTransaction: vi.fn(),
    }
    expect(inferredSignerRailForWallet(solanaWallet)).toBe("solana")
  })

  it("end-to-end: a Solana withdrawal request never resolves to the Bitcoin primaryWallet, even when it is the only wallet available", () => {
    // Simulates the exact live scenario reported: PineTree prepares a solana_transaction
    // payload for a SOL withdrawal, but the only connected Dynamic wallet is Bitcoin.
    const bitcoinPrimary = {
      address: "SolanaSource111111111111111111111111111111",
      chain: "bitcoin",
      connector: { key: "bitcoin", name: "Bitcoin Wallet" },
      signPsbt: vi.fn(),
    }
    const preparedRail = "solana" as const
    const preparedSourceAddress = "SolanaSource111111111111111111111111111111"

    const selectedWallet = findDynamicApprovalWalletForSource(
      [],
      bitcoinPrimary,
      preparedRail,
      preparedSourceAddress
    )

    // No Solana-classified wallet exists, so selection must fail closed - never fall
    // back to the Bitcoin primaryWallet just because its address happens to match.
    expect(selectedWallet).toBeNull()

    // If selection had (incorrectly) returned the Bitcoin wallet, the chain assertion
    // must still hard-fail before any Dynamic signing method is invoked.
    expect(() => assertDynamicWalletChain(bitcoinPrimary, preparedRail)).toThrow(
      "Dynamic signer chain mismatch: expected Solana signer."
    )
    expect(bitcoinPrimary.signPsbt).not.toHaveBeenCalled()
  })
})
