import { createConfig, http } from "wagmi"
import { base } from "wagmi/chains"
import { walletConnect } from "wagmi/connectors"

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || ""
const appUrl = process.env.NEXT_PUBLIC_APP_URL || ""

const connectors = [
  ...(projectId
    ? [
        walletConnect({
          projectId,
          metadata: {
            name: "PineTree Payments",
            description: "PineTree Payments Checkout",
            url: appUrl,
            icons: [],
            redirect: {
              // Tells mobile wallets where to send the user after session approval.
              // Using the app URL so wallets can auto-return to the browser via
              // universal link rather than requiring a manual tap.
              universal: appUrl,
            },
          },
        }),
      ]
    : []),
]

export const wagmiConfig = createConfig({
  chains: [base],
  connectors,
  transports: {
    [base.id]: http("https://mainnet.base.org"),
  },
  ssr: false,
})
