import { describe, expect, it } from "vitest"
import { networkForWallet } from "@/lib/wallets/sparkDetection"

describe("Spark/Lightning address detection", () => {
  it("detects Spark when wallet metadata contains 'spark'", () => {
    // connector.name from Dynamic SparkWalletConnectors
    expect(networkForWallet("BTC", "spark_wallet", "SparkWalletConnector")).toBe("lightning")
    expect(networkForWallet("BTC", "spark_key", "spark")).toBe("lightning")
    // chain itself named spark
    expect(networkForWallet("SPARK", "key", "SomeConnector")).toBe("lightning")
    // key contains spark
    expect(networkForWallet("BTC", "spark-embedded", "BitcoinConnector")).toBe("lightning")
  })

  it("detects Spark when metadata contains 'lightspark'", () => {
    expect(networkForWallet("BTC", "key", "LightsparkConnector")).toBe("lightning")
    expect(networkForWallet("BTC", "key", "lightspark")).toBe("lightning")
    expect(networkForWallet("BTC", "lightspark_key", "SomeConnector")).toBe("lightning")
  })

  it("detects Lightning under alternative identifiers: lightning, bitcoin-lightning, btc-lightning", () => {
    expect(networkForWallet("BTC", "key", "lightning")).toBe("lightning")
    expect(networkForWallet("BTC", "key", "bitcoin-lightning")).toBe("lightning")
    expect(networkForWallet("BTC", "key", "btc-lightning")).toBe("lightning")
    expect(networkForWallet("BTC", "key", "LightningWalletConnector")).toBe("lightning")
  })

  it("does not treat plain Bitcoin on-chain as Lightning/Spark", () => {
    expect(networkForWallet("BTC", "btc_wallet", "BitcoinWalletConnector")).toBe("bitcoin")
    expect(networkForWallet("BTC", "btc_wallet", "Bitcoin")).toBe("bitcoin")
    expect(networkForWallet("BTC", "key", "BitcoinConnector")).toBe("bitcoin")
    // chain BTC with no spark/lightning tokens → bitcoin, not lightning
    expect(networkForWallet("BTC", "key", "NativeSegWit")).toBe("bitcoin")
  })

  it("missing Spark/Lightning wallet means lightning rail is not ready (wallet stays Needs attention)", () => {
    // Simulate Base + Solana + plain Bitcoin wallets — no Spark/Lightning
    const walletInputs = [
      { chain: "EVM", key: "evm_wallet", connectorName: "EthereumWalletConnector" },
      { chain: "SOL", key: "sol_wallet", connectorName: "SolanaWalletConnector" },
      { chain: "BTC", key: "btc_wallet", connectorName: "BitcoinWalletConnector" },
    ]
    const networks = walletInputs.map(({ chain, key, connectorName }) =>
      networkForWallet(chain, key, connectorName)
    )
    // None of these should be classified as lightning
    expect(networks).not.toContain("lightning")
    // Base and Solana are correctly detected
    expect(networks).toContain("base")
    expect(networks).toContain("solana")
    // Without a lightning entry, lightningReady = false → wallet status = "Needs attention"
  })
})
