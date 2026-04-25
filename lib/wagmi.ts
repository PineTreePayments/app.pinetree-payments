import { createConfig, http } from "wagmi"
import { base } from "wagmi/chains"
import { metaMask, coinbaseWallet, walletConnect } from "wagmi/connectors"

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || ""

const connectors = [
  metaMask(),
  coinbaseWallet({ appName: "PineTree Payments" }),
  ...(projectId ? [walletConnect({ projectId })] : []),
]

export const wagmiConfig = createConfig({
  chains: [base],
  connectors,
  transports: {
    [base.id]: http("https://mainnet.base.org"),
  },
  ssr: true,
})
