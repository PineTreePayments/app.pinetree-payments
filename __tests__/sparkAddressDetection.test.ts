import { describe, expect, it } from "vitest"
import { extractDynamicWalletAddresses, networkForWallet } from "@/lib/wallets/sparkDetection"

describe("Spark/Lightning address detection", () => {
  it("detects Spark when wallet metadata contains spark", () => {
    expect(networkForWallet("BTC", "spark_wallet", "SparkWalletConnector")).toBe("lightning")
    expect(networkForWallet("BTC", "spark_key", "spark")).toBe("lightning")
    expect(networkForWallet("SPARK", "key", "SomeConnector")).toBe("lightning")
    expect(networkForWallet("BTC", "spark-embedded", "BitcoinConnector")).toBe("lightning")
  })

  it("detects Spark when metadata contains lightspark", () => {
    expect(networkForWallet("BTC", "key", "LightsparkConnector")).toBe("lightning")
    expect(networkForWallet("BTC", "key", "lightspark")).toBe("lightning")
    expect(networkForWallet("BTC", "lightspark_key", "SomeConnector")).toBe("lightning")
  })

  it("detects Lightning under alternative identifiers", () => {
    expect(networkForWallet("BTC", "key", "lightning")).toBe("lightning")
    expect(networkForWallet("BTC", "key", "bitcoin-lightning")).toBe("lightning")
    expect(networkForWallet("BTC", "key", "btc-lightning")).toBe("lightning")
    expect(networkForWallet("BTC", "key", "btc_lightning")).toBe("lightning")
    expect(networkForWallet("BTC", "key", "LightningWalletConnector")).toBe("lightning")
  })

  it("syncs Spark wallet.address to bitcoin_lightning_address", () => {
    const groups = extractDynamicWalletAddresses([
      {
        id: "spark-wallet",
        chain: "SPARK",
        key: "spark",
        address: "spark1merchantlightningaddress",
        connector: { name: "SparkWalletConnector", key: "spark" },
      },
    ])

    expect(groups.lightning).toEqual([
      { id: "spark-wallet", address: "spark1merchantlightningaddress" },
    ])
    expect(groups.bitcoin).toEqual([])
  })

  it("syncs Spark found in additionalAddresses to bitcoin_lightning_address", () => {
    const groups = extractDynamicWalletAddresses([
      {
        id: "btc-wallet",
        chain: "BTC",
        key: "bitcoin",
        address: "bc1plainbitcoinonchain",
        connector: { name: "BitcoinWalletConnector", key: "bitcoin" },
        additionalAddresses: [
          {
            address: "spark1additionalmerchantaddress",
            addressType: "spark",
            chain: "bitcoin-lightning",
            label: "Spark receive address",
          },
        ],
      },
    ])

    expect(groups.lightning).toEqual([
      {
        id: "btc-wallet-additional-0",
        address: "spark1additionalmerchantaddress",
        detail: "spark",
      },
    ])
    expect(groups.bitcoin).toEqual([
      { id: "btc-wallet", address: "bc1plainbitcoinonchain" },
    ])
  })

  it("detects lightspark, lightning, and btc-lightning labels in additionalAddresses", () => {
    const groups = extractDynamicWalletAddresses([
      {
        id: "wallet-1",
        chain: "BTC",
        key: "bitcoin",
        connector: { name: "BitcoinWalletConnector", key: "bitcoin" },
        additionalAddresses: [
          { address: "ls1", label: "lightspark" },
          { address: "ln1", type: "lightning" },
          { address: "bl1", network: "btc-lightning" },
        ],
      },
    ])

    expect(groups.lightning.map((entry) => entry.address)).toEqual(["ls1", "ln1", "bl1"])
    expect(groups.bitcoin).toEqual([])
  })

  it("does not treat plain Bitcoin on-chain as Lightning/Spark", () => {
    expect(networkForWallet("BTC", "btc_wallet", "BitcoinWalletConnector")).toBe("bitcoin")
    expect(networkForWallet("BTC", "btc_wallet", "Bitcoin")).toBe("bitcoin")
    expect(networkForWallet("BTC", "key", "BitcoinConnector")).toBe("bitcoin")
    expect(networkForWallet("BTC", "key", "NativeSegWit")).toBe("bitcoin")
  })

  it("saves plain Bitcoin on-chain only to bitcoin_onchain_address", () => {
    const groups = extractDynamicWalletAddresses([
      {
        id: "btc-wallet",
        chain: "BTC",
        key: "btc_wallet",
        address: "bc1merchantonchain",
        connector: { name: "BitcoinWalletConnector", key: "bitcoin" },
        additionalAddresses: [
          { address: "bc1secondaryonchain", type: "native_segwit", network: "bitcoin" },
        ],
      },
    ])

    expect(groups.lightning).toEqual([])
    expect(groups.bitcoin.map((entry) => entry.address)).toEqual([
      "bc1merchantonchain",
      "bc1secondaryonchain",
    ])
  })

  it("detects Dynamic WaaS Base and Solana wallets from connector hints and address shape", () => {
    const groups = extractDynamicWalletAddresses([
      {
        id: "waas-base",
        key: "dynamicwaas",
        address: "0x1111111111111111111111111111111111111111",
        connector: { name: "Dynamic WaaS", key: "dynamicwaas", connectedChain: "EVM" },
      },
      {
        id: "waas-sol",
        key: "dynamicwaas",
        address: "So11111111111111111111111111111111111111112",
        connector: { name: "Dynamic WaaS", key: "dynamicwaas", connectedChain: "SOL" },
      },
    ])

    expect(groups.base.map((entry) => entry.address)).toEqual([
      "0x1111111111111111111111111111111111111111",
    ])
    expect(groups.solana.map((entry) => entry.address)).toEqual([
      "So11111111111111111111111111111111111111112",
    ])
  })

  it("detects Dynamic WaaS Base and Solana addresses from verified credentials", () => {
    const groups = extractDynamicWalletAddresses([
      {
        id: "evm-credential",
        walletName: "dynamicwaas",
        walletProvider: "embeddedWallet",
        chain: "EVM",
        address: "0x2222222222222222222222222222222222222222",
      },
      {
        id: "sol-credential",
        walletName: "dynamicwaas",
        walletProvider: "embeddedWallet",
        chain: "SOL",
        address: "So22222222222222222222222222222222222222222",
      },
    ])

    expect(groups.base.map((entry) => entry.address)).toEqual([
      "0x2222222222222222222222222222222222222222",
    ])
    expect(groups.solana.map((entry) => entry.address)).toEqual([
      "So22222222222222222222222222222222222222222",
    ])
    expect(groups.lightning).toEqual([])
  })

  it("detects Dynamic account and connector address fields", () => {
    const groups = extractDynamicWalletAddresses([
      {
        id: "waas-base-account",
        key: "dynamicwaas",
        chain: "EVM",
        accountAddress: "0x3333333333333333333333333333333333333333",
        connector: {
          name: "Dynamic WaaS",
          key: "dynamicwaas",
          connectedChain: "EVM",
        },
      },
      {
        id: "waas-sol-account",
        key: "dynamicwaas",
        chain: "SOL",
        accounts: [{ address: "So33333333333333333333333333333333333333333" }],
        connector: {
          name: "Dynamic WaaS",
          key: "dynamicwaas",
          connectedChain: "SOL",
          activeAccount: { address: "So33333333333333333333333333333333333333333" },
        },
      },
    ])

    expect(groups.base.map((entry) => entry.address)).toEqual([
      "0x3333333333333333333333333333333333333333",
    ])
    expect(groups.solana.map((entry) => entry.address)).toEqual([
      "So33333333333333333333333333333333333333333",
    ])
  })

  it("wallet remains Needs attention if Spark/Lightning is missing", () => {
    const groups = extractDynamicWalletAddresses([
      { id: "base", chain: "EVM", key: "evm", address: "0xbase", connector: { name: "Ethereum" } },
      { id: "sol", chain: "SOL", key: "sol", address: "solana-address", connector: { name: "Solana" } },
      { id: "btc", chain: "BTC", key: "bitcoin", address: "bc1onchain", connector: { name: "Bitcoin" } },
    ])

    const status =
      groups.base.length > 0 && groups.solana.length > 0 && groups.lightning.length > 0
        ? "Ready"
        : "Needs attention"
    expect(status).toBe("Needs attention")
  })

  it("wallet becomes Ready when Base, Solana, and Spark are present", () => {
    const groups = extractDynamicWalletAddresses([
      { id: "base", chain: "EVM", key: "evm", address: "0xbase", connector: { name: "Ethereum" } },
      { id: "sol", chain: "SOL", key: "sol", address: "solana-address", connector: { name: "Solana" } },
      { id: "spark", chain: "SPARK", key: "spark", address: "spark-address", connector: { name: "Spark" } },
    ])

    const status =
      groups.base.length > 0 && groups.solana.length > 0 && groups.lightning.length > 0
        ? "Ready"
        : "Needs attention"
    expect(status).toBe("Ready")
  })
})
