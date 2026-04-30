import { createConfig, http } from "wagmi"
import { base } from "wagmi/chains"
import { walletConnect } from "wagmi/connectors"

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || ""

const connectors = [
  ...(projectId ? [walletConnect({ projectId })] : []),
]

export const wagmiConfig = createConfig({
  chains: [base],
  connectors,
  transports: {
    [base.id]: http("https://mainnet.base.org"),
  },
  ssr: false,
})
