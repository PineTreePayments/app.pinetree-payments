export {}

declare global {
  type Eip1193RequestArgs = {
    method: string
    params?: unknown[] | Record<string, unknown>
  }

  interface Eip1193Provider {
    request: (args: Eip1193RequestArgs) => Promise<unknown>
    isCoinbaseWallet?: boolean
    isBaseWallet?: boolean
    isMetaMask?: boolean
    isTrust?: boolean
    isTrustWallet?: boolean
    providers?: Eip1193Provider[]
  }

  interface SolanaConnectResponse {
    publicKey: {
      toString: () => string
    }
  }

  interface SolanaProvider {
    isPhantom?: boolean
    isSolflare?: boolean
    connect: () => Promise<SolanaConnectResponse>
  }

  interface Window {
    ethereum?: Eip1193Provider
    solana?: SolanaProvider
  }
}